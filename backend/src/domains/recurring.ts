/**
 * Recurring commitments + pledges — shared maths, settlement hooks and
 * projections used by routes/donations.ts, routes/pledges.ts,
 * routes/causes.ts and routes/payments.ts.
 *
 * Honesty model: there is NO gateway auto-debit. A recurring donation is a
 * standing commitment the donor controls (pause/resume/cancel); the next
 * `nextChargeAt` is an "upcoming due" reminder, and every installment is a
 * normal donation payment the donor explicitly approves through the generic
 * POST /api/donations + POST /api/payments + /api/payments/verify flow.
 */
import { db } from "@/infrastructure/database/prisma";
import { logger } from "@/infrastructure/logging/logger";
import { recomputeCause } from "@/domains/causes";

const log = logger.child("recurring");

export const VALID_FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type RecurringFrequency = (typeof VALID_FREQUENCIES)[number];

export const RECURRING_STATUSES = ["ACTIVE", "PAUSED", "CANCELLED"] as const;

/** Lifecycle machine for a recurring commitment's recurringStatus. */
export const RECURRING_STATUS_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ["PAUSED", "CANCELLED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  CANCELLED: [], // terminal — a cancelled commitment stays cancelled
};

/** Calendar months helper (clamps day-of-month to the target month's length). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0); // clamped to last day of target month
  return d;
}

/** The next due date after `from` for the given frequency (calendar-accurate). */
export function nextChargeAfter(from: Date, frequency: string | null | undefined): Date {
  switch ((frequency ?? "MONTHLY").toUpperCase()) {
    case "WEEKLY":
      return new Date(from.getTime() + 7 * 86400000);
    case "QUARTERLY":
      return addMonths(from, 3);
    case "YEARLY":
      return addMonths(from, 12);
    default:
      return addMonths(from, 1);
  }
}

/**
 * Settlement side-effects for linked donations — called the moment a donation
 * actually settles (instant completion, gateway verify, webhook or an admin
 * confirming a PENDING row):
 *  · an installment (recurringParentId set) advances its parent's nextChargeAt
 *    (only while the parent is ACTIVE — paused/cancelled commitments are not
 *    rescheduled) and
 *  · a pledge installment (pledgeId set) is folded into the pledge's paid
 *    total, auto-completing the pledge once the full commitment is covered.
 * Idempotent by construction: the advance takes max(nextChargeAt, now) so a
 * replayed verify cannot push the date twice into the future.
 */
export async function settleDonationCommitments(donationId: string): Promise<void> {
  const donation = await db.donation.findUnique({ where: { id: donationId } });
  if (!donation || donation.paymentStatus !== "COMPLETED") return;

  if (donation.recurringParentId) {
    const parent = await db.donation.findUnique({ where: { id: donation.recurringParentId } });
    if (parent && (parent.recurringStatus ?? "ACTIVE") === "ACTIVE") {
      const base = parent.nextChargeAt && parent.nextChargeAt > donation.createdAt
        ? parent.nextChargeAt
        : donation.createdAt;
      const nextChargeAt = nextChargeAfter(base, parent.recurringFrequency);
      await db.donation.update({
        where: { id: parent.id },
        data: { nextChargeAt },
      });
      log.info("recurring_next_charge_advanced", {
        donationId,
        parentId: parent.id,
        frequency: parent.recurringFrequency,
        nextChargeAt,
      });
    }
  }

  if (donation.pledgeId) {
    await recomputePledge(donation.pledgeId);
  }
}

/**
 * Recompute a pledge's payment tracking from its linked donations and flip an
 * ACTIVE pledge to COMPLETED once the full commitment (amountPerMonth ×
 * months) is covered by COMPLETED payments. Keeps the cause's derived totals
 * in sync (an auto-completed pledge no longer counts towards `raised`).
 */
export async function recomputePledge(pledgeId: string): Promise<void> {
  const pledge = await db.pledge.findUnique({ where: { id: pledgeId } });
  if (!pledge) return;

  const total = pledge.amountPerMonth * pledge.months;
  if (pledge.status === "ACTIVE" && total > 0) {
    const agg = await db.donation.aggregate({
      _sum: { amount: true },
      where: { pledgeId: pledge.id, paymentStatus: "COMPLETED" },
    });
    if ((agg._sum.amount ?? 0) >= total - 1e-9) {
      await db.pledge.update({
        where: { id: pledge.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      log.info("recurring_pledge_completed", {
        pledgeId: pledge.id,
        totalCommitted: total,
        paid: agg._sum.amount ?? 0,
      });
      await recomputeCause(pledge.causeId);
    }
  }
}

/** Pledge installment payment view (linked donation rows, newest first). */
export function pledgeInstallments(donations: Array<{
  id: string;
  receiptNumber: string;
  amount: number;
  currency: string;
  paymentStatus: string;
  createdAt: Date;
}>) {
  return [...donations]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((d) => ({
      id: d.id,
      receiptNumber: d.receiptNumber,
      amount: d.amount,
      currency: d.currency,
      paymentStatus: d.paymentStatus,
      createdAt: d.createdAt,
    }));
}

export interface PledgeScheduleInput {
  amountPerMonth: number;
  months: number;
  startDate: Date;
  status: string;
}

/**
 * Full schedule projection for a pledge — month-by-month due dates (start
 * date + n-1 calendar months), the money math (committed vs paid vs
 * remaining) and the next unpaid due date. Covered slots are the first
 * `paymentCount` installments in schedule order.
 */
export function pledgeSchedule(
  pledge: PledgeScheduleInput,
  payments: Array<{ amount: number; paymentStatus: string; createdAt: Date }>
) {
  const completed = payments
    .filter((d) => d.paymentStatus === "COMPLETED")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const totalCommitted = Math.round(pledge.amountPerMonth * pledge.months * 100) / 100;
  const paymentsMade = Math.round(completed.reduce((s, d) => s + d.amount, 0) * 100) / 100;
  const paymentCount = completed.length;
  const remaining = Math.max(0, Math.round((totalCommitted - paymentsMade) * 100) / 100);

  const schedule = Array.from({ length: Math.max(0, pledge.months) }, (_, i) => {
    const dueDate = addMonths(pledge.startDate, i);
    return { n: i + 1, dueDate, amount: pledge.amountPerMonth, covered: i < paymentCount };
  });
  const nextDue = schedule.find((s) => !s.covered) ?? null;

  return {
    totalCommitted,
    paymentsMade,
    paymentCount,
    remaining,
    nextDueAt: nextDue ? nextDue.dueDate : null,
    schedule,
  };
}
