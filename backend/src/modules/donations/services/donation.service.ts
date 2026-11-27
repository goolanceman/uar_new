/**
 * Donation service — all business rules for /api/donations: the multi-mode
 * list (mine / donor wall / public wall / admin), guest + session donation
 * creation with the receipt/donor-CRM transaction, recurring commitment
 * management, and the admin edit/delete with refund + notification workflows.
 * Depends on the repository contract, throws application errors, never
 * touches HTTP (the raw query params and the optional session are extracted
 * by the controller and passed in).
 *
 * PUBLIC endpoints by capability: POST / accepts guest gifts (the session, if
 * any, only enriches the donor identity); GET / public wall exposes the
 * masked/anonymised projection only. Admin branches gate on the verified
 * session role exactly like the legacy handlers did.
 */
import { logger } from "@/lib/logger";
import type { Session } from "@/lib/session";
import { logActivity } from "@/lib/session";
import { ApiError } from "@/shared/errors";
import { nextDonorCode } from "@/lib/codes";
import { CURRENCY_CODES } from "@/lib/settings-core";
import { assertTransition } from "@/lib/workflow";
import { loadSettings, notifyDonation, emailShell, sendEmail } from "@/lib/notify";
import { broadcastEvent } from "@/lib/events";
import { invalidateCampaigns, invalidateStats } from "@/lib/cache";
import { paged, pageParams } from "@/lib/community/serializers";
import {
  VALID_FREQUENCIES,
  RECURRING_STATUSES,
  RECURRING_STATUS_TRANSITIONS,
  nextChargeAfter,
  settleDonationCommitments,
} from "@/lib/recurring";
import { withTransaction } from "@/infrastructure/database/transactions/transaction.manager";
import type {
  CreateDonationData,
  DonationDetailRow,
  DonationListFilters,
  DonationRepository,
  DonationRow,
  DonationWallRow,
  DonationWithCampaignAccent,
  DonationWithCampaignTitle,
  RecurringParentRow,
} from "../repositories/donation.repository.interface";

const log = logger.child("donations");

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const PHONE_RE = /^(\+91[\-\s]?)?[6-9]\d{9}$/;

/** Methods that settle through the online gateway (hosted checkout). */
const GATEWAY_METHODS = ["RAZORPAY", "STRIPE", "CASHFREE"];
/** Offline/manual methods — verified by staff before completion. */
const OFFLINE_METHODS = ["CASH", "BANK_TRANSFER", "CHEQUE"];

const VALID_STATUSES = ["PENDING", "COMPLETED", "FAILED", "REFUNDED", "CANCELLED"];
// Payment machine: PENDING settles/fails/cancels; REFUNDED is reachable from
// any money-moved state (PENDING/COMPLETED/FAILED — the refund workflow below
// auto-sets it); CANCELLED and REFUNDED are terminal. Blocks the corrupting
// COMPLETED → PENDING move that would break campaign totals + receipts.
const PAYMENT_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["COMPLETED", "FAILED", "CANCELLED", "REFUNDED"],
  COMPLETED: ["REFUNDED"],
  FAILED: ["REFUNDED"],
  REFUNDED: [],
  CANCELLED: [],
};
const VALID_METHODS = ["UPI", "RAZORPAY", "CARD", "CASH", "BANK_TRANSFER", "CHEQUE"];
const VALID_TYPES = ["ONE_TIME", "RECURRING"];
const VALID_CATEGORIES = [
  "GENERAL", "MEDICAL", "FOOD_DISTRIBUTION", "SANITARY_PADS",
  "EDUCATION_SUPPORT", "EMERGENCY", "ANIMAL_WELFARE", "MOBILITY", "AWARENESS",
];
const VALID_RECEIPT_STATUS = ["PENDING", "ISSUED", "CANCELLED", "REISSUED"];

/** Public-safe projection — never expose contact/financial PII. */
function publicDonation(d: {
  id: string;
  donorName: string;
  isAnonymous: boolean;
  amount: number;
  currency: string;
  type: string;
  category: string;
  message: string | null;
  createdAt: Date;
  campaign?: { title: string; accent: string } | null;
}) {
  return {
    id: d.id,
    donorName: d.isAnonymous ? "Anonymous" : maskName(d.donorName),
    amount: d.amount,
    currency: d.currency,
    type: d.type,
    category: d.category,
    message: d.message,
    createdAt: d.createdAt,
    campaign: d.campaign ?? null,
  };
}

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const initial = parts[1]?.[0] ? ` ${parts[1][0]}.` : "";
  return `${first}${initial}`;
}

/** Legacy date parsing: undefined = not provided (field untouched), null/"" =
 *  null (cleared), unparseable = null. */
function parseDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined; // not provided
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export class DonationService {
  constructor(private readonly donationRepository: DonationRepository) {}

  /**
   * GET /api/donations — public feed | wall=1 donor wall | signed-in
   * (admin/staff) filtered list. The mine=1 branch lives in the controller
   * because its legacy requireAuth gate runs mid-handler; the session here is
   * the optional validateSession result (null for guests).
   */
  async list(
    sp: URLSearchParams,
    rawQuery: Record<string, unknown>,
    session: Session | null
  ): Promise<unknown> {
    // Donor wall (moved from the mobile-only fetchCauseDonations) — the
    // public-safe donor list of one campaign: masked/anonymised names, no
    // contact PII. Same projection the public wall uses, paginated.
    if (sp.get("wall") === "1") {
      const campaignId = sp.get("campaignId");
      if (!campaignId) throw new ApiError("campaignId is required for the donor wall", 400);
      const { page, limit, skip } = pageParams(rawQuery);
      let sortBy = sp.get("sortBy") ?? "createdAt";
      if (!(["createdAt", "amount"].includes(sortBy))) sortBy = "createdAt";
      const sortDirection = sp.get("sortDirection") === "asc" ? "asc" : "desc";

      const { rows, total, totalRaised } = await this.donationRepository.listDonorWall(
        campaignId,
        sortBy,
        sortDirection,
        skip,
        limit
      );
      const items = rows.map((d) => ({
        id: d.id,
        donorName: d.isAnonymous ? "Anonymous" : maskName(d.donorName),
        amount: d.amount,
        currency: d.currency,
        type: d.type,
        category: d.category,
        message: d.message,
        createdAt: d.createdAt,
        campaign: d.campaign,
        // donor id only for the app's "my donations" highlight; hidden for
        // anonymous gifts (the UI then shows the Anonymous placeholder)
        userId: d.isAnonymous ? null : d.donorId,
        user: d.isAnonymous || !d.donor
          ? null
          : {
              id: d.donor.id,
              full_name: maskName(d.donor.name),
              username: d.donor.username ?? "",
              profile: d.donor.avatar,
            },
      }));
      return { ...paged(items, page, limit, total), totalRaised };
    }

    if (sp.get("public") === "1" || !session) {
      // Public wall — latest 12 completed, minimal safe fields only
      const donations = await this.donationRepository.listPublicWall();
      return donations.map(publicDonation);
    }

    // Signed-in (admin/staff) view — filterable, paginated
    const filters: DonationListFilters = {
      campaignId: sp.get("campaignId"),
      status: sp.get("status") ?? sp.get("paymentStatus"),
      type: sp.get("type"),
      category: sp.get("category"),
      method: sp.get("method"),
      from: sp.get("from"),
      to: sp.get("to"),
      q: sp.get("q")?.trim() ?? null,
    };
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const take = Math.min(500, Math.max(1, parseInt(sp.get("limit") ?? "50", 10) || 50));

    const { rows, total, completedSum } = await this.donationRepository.listAdmin(
      filters,
      (page - 1) * take,
      take
    );

    return {
      items: rows,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / take)),
      completedSum,
    };
  }

  /** GET /api/donations?mine=1 — the signed-in donor's own donations. */
  async listMine(donorId: string, limit?: number): Promise<DonationWithCampaignAccent[]> {
    return this.donationRepository.listMine(donorId, limit);
  }

  /**
   * POST /api/donations — public or logged-in donor. Validates in the exact
   * legacy order (amount → campaign → food event → donor identity → phone →
   * PAN → recurring fields → parent/pledge ownership → currency), creates the
   * Donor CRM record + donation atomically, then runs the settlement side
   * effects in the legacy order.
   */
  async create(
    body: Record<string, unknown>,
    session: Session | null
  ): Promise<{ donation: DonationWithCampaignTitle; checkoutPending: boolean }> {
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new ApiError("Amount must be greater than zero", 400);

    const campaignId = body?.campaignId ? String(body.campaignId) : null;
    if (campaignId) {
      const campaign = await this.donationRepository.findCampaignById(campaignId);
      if (!campaign) throw new ApiError("Selected campaign was not found", 400);
    }

    // Sponsor-a-distribution — links the donation to a public food event.
    const foodEventId = body?.foodEventId ? String(body.foodEventId) : null;
    if (foodEventId) {
      const foodEvent = await this.donationRepository.findFoodEventById(foodEventId);
      if (!foodEvent || !foodEvent.publicVisible)
        throw new ApiError("Selected food distribution was not found", 400);
    }

    const donorName = (body?.donorName ? String(body.donorName).trim() : session?.name ?? "").trim();
    const donorEmail = (body?.donorEmail ? String(body.donorEmail).trim() : session?.email ?? "").trim().toLowerCase();
    if (!donorName || !donorEmail)
      throw new ApiError("Donor name and email are required", 400);
    if (!/^\S+@\S+\.\S+$/.test(donorEmail))
      throw new ApiError("Please enter a valid email address", 400);

    const donorPhone = body?.donorPhone ? String(body.donorPhone).trim() : null;
    if (donorPhone && !PHONE_RE.test(donorPhone.replace(/[\s-]/g, "")))
      throw new ApiError("Please enter a valid Indian mobile number", 400);

    const pan = body?.pan ? String(body.pan).trim().toUpperCase() : null;
    if (pan && !PAN_RE.test(pan))
      throw new ApiError("PAN must look like ABCDE1234F", 400);

    let type = body?.type === "RECURRING" ? "RECURRING" : "ONE_TIME";
    const freqRaw = body?.recurringFrequency ? String(body.recurringFrequency).trim().toUpperCase() : null;
    if (type === "RECURRING" && freqRaw && !(VALID_FREQUENCIES as readonly string[]).includes(freqRaw))
      throw new ApiError("recurringFrequency must be WEEKLY, MONTHLY, QUARTERLY or YEARLY", 400);
    let recurringFrequency = type === "RECURRING" ? (freqRaw ?? "MONTHLY") : null;

    // Link this donation to an existing recurring commitment (pay the current
    // installment of my monthly giving) and/or a medicine pledge (pay the next
    // pledge installment). Both run through the normal payment flow — there
    // is no auto-debit anywhere.
    const recurringParentId = body?.recurringParentId ? String(body.recurringParentId) : null;
    const pledgeId = body?.pledgeId ? String(body.pledgeId) : null;
    if (recurringParentId && pledgeId)
      throw new ApiError("A donation cannot pay a recurring commitment and a pledge at the same time", 400);

    let recurringParent: { id: string; campaignId: string | null; recurringFrequency: string | null } | null = null;
    if (recurringParentId) {
      const parent = await this.donationRepository.findDonationById(recurringParentId);
      if (!parent || parent.type !== "RECURRING" || parent.recurringStatus === "CANCELLED") {
        log.warn("donation_recurring_parent_invalid", {
          recurringParentId,
          actor: session?.userId ?? null,
        });
        throw new ApiError("That recurring commitment was not found or is cancelled", 400);
      }
      const owns = session && parent.donorId === session.userId;
      if (!owns && session?.role !== "ADMIN") {
        log.warn("donation_recurring_parent_forbidden", {
          recurringParentId,
          actor: session?.userId ?? null,
        });
        throw new ApiError("You can only pay installments on your own recurring commitments", 403);
      }
      recurringParent = {
        id: parent.id,
        campaignId: parent.campaignId,
        recurringFrequency: parent.recurringFrequency,
      };
      // The installment belongs to the parent's series — inherit cadence.
      type = "RECURRING";
      recurringFrequency = recurringParent.recurringFrequency ?? recurringFrequency;
    }

    let pledgeLink: { id: string } | null = null;
    if (pledgeId) {
      const pledge = await this.donationRepository.findPledgeById(pledgeId);
      if (!pledge) {
        log.warn("donation_pledge_not_found", { pledgeId, actor: session?.userId ?? null });
        throw new ApiError("That pledge was not found", 400);
      }
      if (pledge.status === "CANCELLED") {
        log.warn("donation_pledge_cancelled", {
          pledgeId,
          actor: session?.userId ?? null,
        });
        throw new ApiError("This pledge has been cancelled — start a new one instead", 400);
      }
      const owns = session && pledge.donorId === session.userId;
      if (!owns && session?.role !== "ADMIN") {
        log.warn("donation_pledge_forbidden", { pledgeId, actor: session?.userId ?? null });
        throw new ApiError("You can only pay installments on your own pledges", 403);
      }
      pledgeLink = { id: pledge.id };
    }

    // Display currency for the gift (defaults to INR for legacy donors).
    const currency = body?.currency ? String(body.currency).trim().toUpperCase() : "INR";
    if (!CURRENCY_CODES.includes(currency))
      throw new ApiError("Unsupported currency", 400);

    const paymentMethod = body?.paymentMethod ? String(body.paymentMethod) : "UPI";
    // Gateway checkouts (Razorpay/Stripe/Cashfree) settle asynchronously: the
    // donation enters as PENDING and only the verified gateway callback
    // (POST /api/payments/verify) marks it COMPLETED. Offline/manual payments
    // (cash, cheque, bank transfer) also enter as PENDING until staff verify
    // them; UPI records the promise-to-pay and completes immediately.
    const gatewayMethod = GATEWAY_METHODS.includes(paymentMethod);
    const offline = OFFLINE_METHODS.includes(paymentMethod);
    const paymentStatus = gatewayMethod || offline ? "PENDING" : "COMPLETED";
    const paymentProvider = gatewayMethod
      ? paymentMethod
      : offline
        ? "MANUAL"
        : body?.paymentProvider
          ? String(body.paymentProvider)
          : null;

    const receiptNumber = await this.donationRepository.nextReceiptNumber();
    const now = new Date();

    // 80G: cash donations above ₹2,000 are NOT eligible (Income Tax Act) —
    // the ₹2,000 cash rule is INR-specific, other currencies stay eligible.
    const taxEligible = !(paymentMethod === "CASH" && amount > 2000 && currency === "INR");
    void taxEligible; // reserved for receipt rendering

    // Computed up front (not inside the transaction) so a brand-new donor
    // gets a code — mirrors how nextReceiptNumber is resolved above.
    const donorExists = await this.donationRepository.findDonorByEmail(donorEmail);
    const donorCode = donorExists ? undefined : await nextDonorCode();
    void donorCode;

    const donation = await withTransaction(async (tx) => {
      // Upsert the Donor CRM record by email — find+create instead of upsert
      // because Prisma validates the create branch eagerly and a repeat
      // donor (code intentionally skipped) would fail that validation.
      const donorExists = await this.donationRepository.findDonorByEmail(donorEmail, tx);
      const donorRecord = donorExists
        ? await this.donationRepository.updateDonorById(
            donorExists.id,
            { name: donorName, phone: donorPhone ?? undefined, pan: pan ?? undefined },
            tx
          )
        : await this.donationRepository.createDonor(
            {
              code: await nextDonorCode(),
              name: donorName,
              email: donorEmail,
              phone: donorPhone,
              pan: pan ?? null,
              source: "WEB",
              category: type === "RECURRING" ? "MONTHLY" : "ONE_TIME",
            },
            tx
          );

      const data: CreateDonationData = {
        donorId: session?.userId ?? null,
        donorRefId: donorRecord.id,
        donorName,
        donorEmail,
        donorPhone,
        amount,
        currency,
        type,
        recurringFrequency,
        recurringStatus: type === "RECURRING" && !recurringParent ? "ACTIVE" : null,
        nextChargeAt:
          type === "RECURRING" && recurringFrequency && !recurringParent
            ? nextChargeAfter(now, recurringFrequency)
            : null,
        recurringParentId: recurringParent?.id ?? null,
        pledgeId: pledgeLink?.id ?? null,
        category: body?.category ? String(body.category) : "GENERAL",
        paymentMethod,
        paymentProvider,
        paymentStatus,
        transactionId: body?.transactionId ? String(body.transactionId) : null,
        gatewayOrderId: body?.gatewayOrderId ? String(body.gatewayOrderId) : null,
        receiptNumber,
        receiptStatus: paymentStatus === "COMPLETED" ? "ISSUED" : "PENDING",
        receiptIssuedAt: paymentStatus === "COMPLETED" ? now : null,
        campaignId: campaignId ?? recurringParent?.campaignId ?? null,
        foodEventId,
        message: body?.message ? String(body.message) : null,
        isAnonymous: Boolean(body?.isAnonymous),
        pan,
      };
      return this.donationRepository.createDonation(data, tx);
    });

    log.info("donation_created", {
      donationId: donation.id,
      amount,
      paymentStatus,
      campaignId: donation.campaignId,
      receiptNumber: donation.receiptNumber,
      actor: session?.userId ?? null,
    });

    if (campaignId && paymentStatus === "COMPLETED") {
      await this.donationRepository.incrementCampaignRaised(campaignId, amount);
      await invalidateCampaigns();
      await invalidateStats();
    }

    // Instant (non-gateway) settlement of a linked donation — advance the
    // recurring parent's nextChargeAt / fold the payment into the pledge.
    if (paymentStatus === "COMPLETED" && (recurringParent || pledgeLink)) {
      await settleDonationCommitments(donation.id);
    }

    // Persist PAN on the donor profile for 80G receipts
    if (pan && session) {
      await this.donationRepository.updateUserPan(session.userId, pan);
    }

    await logActivity(
      donorName,
      "DONATION",
      "DONATION",
      `₹${amount} → ${donation.campaign?.title ?? "General Fund"} (${paymentStatus})`,
      session?.userId
    );

    // Live broadcast — every connected visitor sees a toast for instant
    // (non-gateway) completions. Name is masked/anonymised exactly like the
    // public donations wall. Gateway checkouts broadcast on verification
    // (POST /api/payments/verify) when the money is actually confirmed.
    if (paymentStatus === "COMPLETED") {
      broadcastEvent("donation", {
        donorName: donation.isAnonymous ? "Someone" : maskName(donation.donorName),
        amount: donation.amount,
        currency: donation.currency,
        campaignTitle: donation.campaign?.title ?? null,
        receiptNumber: donation.receiptNumber,
        at: donation.createdAt,
      });
    }

    return { donation, checkoutPending: gatewayMethod };
  }

  /**
   * GET /api/donations/recurring/mine — the signed-in donor's monthly-giving
   * commitments (RECURRING parents they own), each with status, frequency,
   * amount, campaign, next due date and the installment payments made so far.
   * Owner-scoped: other donors' commitments never leak (admins use GET / with
   * type=RECURRING).
   */
  async listMyRecurring(donorId: string) {
    const parents = await this.donationRepository.listRecurringParents(donorId);
    const ids = parents.map((p) => p.id);
    const allInstallments = ids.length
      ? await this.donationRepository.listInstallments(ids)
      : [];

    return parents.map((p) => {
      const installments = allInstallments.filter((i) => i.recurringParentId === p.id);
      const paid = installments.filter((i) => i.paymentStatus === "COMPLETED");
      return {
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        recurringFrequency: p.recurringFrequency,
        recurringStatus: p.recurringStatus ?? "ACTIVE",
        nextChargeAt: p.nextChargeAt,
        createdAt: p.createdAt,
        category: p.category,
        campaign: p.campaign ?? null,
        installmentCount: paid.length,
        paidTotal: Math.round(paid.reduce((sum, i) => sum + i.amount, 0) * 100) / 100,
        installments: installments.slice(0, 24).map((i) => ({
          id: i.id,
          receiptNumber: i.receiptNumber,
          amount: i.amount,
          currency: i.currency,
          paymentStatus: i.paymentStatus,
          createdAt: i.createdAt,
        })),
      };
    });
  }

  /**
   * PATCH /api/donations/recurring/:id — the owner (or an admin) manages
   * their recurring commitment: pause/resume/cancel via recurringStatus, and
   * adjust amount / recurringFrequency. Cancelled is terminal.
   */
  async updateRecurringCommitment(id: string, body: Record<string, unknown>, actor: Session) {
    const commitment = await this.donationRepository.findDonationById(id);
    if (!commitment || commitment.type !== "RECURRING" || commitment.recurringParentId) {
      log.warn("recurring_commitment_not_found", { donationId: id, actor: actor.userId });
      throw new ApiError("Recurring commitment not found", 404);
    }
    if (commitment.donorId !== actor.userId && actor.role !== "ADMIN") {
      log.warn("recurring_commitment_forbidden", { donationId: id, actor: actor.userId });
      throw new ApiError("You can only manage your own recurring commitments", 403);
    }

    const currentStatus = commitment.recurringStatus ?? "ACTIVE";
    const data: Record<string, unknown> = {};

    if (body.recurringStatus !== undefined) {
      const next = String(body.recurringStatus).trim().toUpperCase();
      if (!(RECURRING_STATUSES as readonly string[]).includes(next))
        throw new ApiError("recurringStatus must be ACTIVE, PAUSED or CANCELLED", 400);
      assertTransition(
        RECURRING_STATUS_TRANSITIONS,
        currentStatus,
        next,
        "recurring commitment",
        400
      );
      data.recurringStatus = next;
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new ApiError("Amount must be greater than zero", 400);
      data.amount = amount;
    }
    if (body.recurringFrequency !== undefined) {
      const freq = String(body.recurringFrequency).trim().toUpperCase();
      if (!(VALID_FREQUENCIES as readonly string[]).includes(freq))
        throw new ApiError("recurringFrequency must be WEEKLY, MONTHLY, QUARTERLY or YEARLY", 400);
      data.recurringFrequency = freq;
    }
    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const updated = await this.donationRepository.updateDonation(id, data);
    log.info("recurring_commitment_updated", {
      donationId: id,
      fields: Object.keys(data),
      ...(data.recurringStatus ? { newStatus: data.recurringStatus } : {}),
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "RECURRING_UPDATE",
      "DONATION",
      `${commitment.receiptNumber} → ${Object.keys(data).map((k) => `${k}=${String(data[k])}`).join(", ")}`,
      actor.userId
    );
    return {
      id: updated.id,
      amount: updated.amount,
      currency: updated.currency,
      recurringFrequency: updated.recurringFrequency,
      recurringStatus: updated.recurringStatus ?? "ACTIVE",
      nextChargeAt: updated.nextChargeAt,
    };
  }

  /** GET /api/donations/:id — single record with full detail. */
  async getDonation(id: string): Promise<DonationDetailRow> {
    const donation = await this.donationRepository.findDonationDetail(id);
    if (!donation) throw new ApiError("Donation not found", 404);
    return donation;
  }

  /**
   * PATCH /api/donations/:id — admin edits the full record (whitelisted).
   * Per-field checks with the exact legacy messages, then the status
   * transition machine, the Donor CRM sync, the campaign recompute and the
   * fire-and-forget donor notifications — in the legacy order.
   */
  async updateDonation(id: string, body: Record<string, unknown>, actor: Session): Promise<DonationRow> {
    const existing = await this.donationRepository.findDonationById(id);
    if (!existing) {
      log.warn("donation_update_not_found", { donationId: id, actor: actor.userId });
      throw new ApiError("Donation not found", 404);
    }

    const data: Record<string, unknown> = {};

    if (body?.donorName !== undefined) {
      const v = String(body.donorName).trim();
      if (!v) throw new ApiError("Donor name cannot be empty", 400);
      data.donorName = v;
    }
    if (body?.donorEmail !== undefined) {
      const v = String(body.donorEmail).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(v))
        throw new ApiError("Please enter a valid email address", 400);
      data.donorEmail = v;
    }
    if (body?.donorPhone !== undefined)
      data.donorPhone = body.donorPhone ? String(body.donorPhone).trim() : null;

    if (body?.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new ApiError("Amount must be greater than zero", 400);
      data.amount = amount;
    }
    if (body?.currency !== undefined) data.currency = String(body.currency) || "INR";
    if (body?.type !== undefined) {
      if (!VALID_TYPES.includes(String(body.type)))
        throw new ApiError("Invalid donation type", 400);
      data.type = String(body.type);
    }
    if (body?.recurringFrequency !== undefined)
      data.recurringFrequency = body.recurringFrequency ? String(body.recurringFrequency) : null;
    if (body?.nextChargeAt !== undefined) data.nextChargeAt = parseDate(body.nextChargeAt);

    if (body?.category !== undefined) {
      if (!VALID_CATEGORIES.includes(String(body.category)))
        throw new ApiError("Invalid category", 400);
      data.category = String(body.category);
    }
    if (body?.paymentMethod !== undefined) {
      if (!VALID_METHODS.includes(String(body.paymentMethod)))
        throw new ApiError("Invalid payment method", 400);
      data.paymentMethod = String(body.paymentMethod);
    }
    if (body?.paymentProvider !== undefined)
      data.paymentProvider = body.paymentProvider ? String(body.paymentProvider) : null;
    if (body?.paymentStatus !== undefined) {
      if (!VALID_STATUSES.includes(String(body.paymentStatus)))
        throw new ApiError("Invalid payment status", 400);
      assertTransition(
        PAYMENT_TRANSITIONS,
        existing.paymentStatus,
        String(body.paymentStatus),
        "donation paymentStatus",
        400
      );
      data.paymentStatus = String(body.paymentStatus);
    }
    if (body?.transactionId !== undefined)
      data.transactionId = body.transactionId ? String(body.transactionId).trim() : null;
    if (body?.gatewayOrderId !== undefined)
      data.gatewayOrderId = body.gatewayOrderId ? String(body.gatewayOrderId).trim() : null;
    if (body?.campaignId !== undefined)
      data.campaignId = body.campaignId ? String(body.campaignId) : null;
    if (body?.message !== undefined)
      data.message = body.message ? String(body.message) : null;
    if (body?.isAnonymous !== undefined) data.isAnonymous = Boolean(body.isAnonymous);
    if (body?.pan !== undefined) {
      const v = body.pan ? String(body.pan).trim().toUpperCase() : null;
      if (v && !PAN_RE.test(v))
        throw new ApiError("PAN must look like ABCDE1234F", 400);
      data.pan = v;
    }

    // Finance fields
    if (body?.fees !== undefined) {
      const fees = Number(body.fees);
      if (!Number.isFinite(fees) || fees < 0)
        throw new ApiError("Fees cannot be negative", 400);
      data.fees = fees;
      data.netAmount = fees >= 0 ? (data.amount !== undefined ? Number(data.amount) : existing.amount) - fees : null;
    }
    if (body?.settlementDate !== undefined) data.settlementDate = parseDate(body.settlementDate);
    if (body?.receiptStatus !== undefined) {
      if (!VALID_RECEIPT_STATUS.includes(String(body.receiptStatus)))
        throw new ApiError("Invalid receipt status", 400);
      data.receiptStatus = String(body.receiptStatus);
      if (data.receiptStatus === "ISSUED") data.receiptIssuedAt = new Date();
    }
    if (body?.internalNotes !== undefined)
      data.internalNotes = body.internalNotes ? String(body.internalNotes) : null;

    // Refund workflow
    if (body?.refundAmount !== undefined) {
      const ra = Number(body.refundAmount);
      if (!Number.isFinite(ra) || ra < 0)
        throw new ApiError("Refund amount cannot be negative", 400);
      data.refundAmount = ra;
      data.refundedAt = ra > 0 ? new Date() : null;
      if (ra > 0 && !body?.paymentStatus) {
        assertTransition(PAYMENT_TRANSITIONS, existing.paymentStatus, "REFUNDED", "donation paymentStatus", 400);
        log.debug("donation_refund_auto_transition", {
          donationId: id,
          from: existing.paymentStatus,
          refundAmount: ra,
          actor: actor.userId,
        });
        data.paymentStatus = "REFUNDED";
      }
    }
    if (body?.refundReason !== undefined)
      data.refundReason = body.refundReason ? String(body.refundReason) : null;

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const donation = await this.donationRepository.updateDonation(id, data);
    log.info("donation_updated", {
      donationId: id,
      receiptNumber: donation.receiptNumber,
      fields: Object.keys(data),
      ...(data.paymentStatus ? { newStatus: donation.paymentStatus } : {}),
      actor: actor.userId,
    });

    // Keep the Donor CRM record in sync when identity fields change
    if (data.donorEmail || data.donorName || data.donorPhone || data.pan) {
      const donorExists = await this.donationRepository.findDonorByEmail(donation.donorEmail);
      await this.donationRepository.upsertDonorRecord({
        email: donation.donorEmail,
        code: donorExists ? donorExists.code : await nextDonorCode(),
        name: donation.donorName,
        phone: donation.donorPhone,
        pan: donation.pan,
      });
    }

    // raisedAmount always reflects COMPLETED totals
    await this.recomputeCampaign(donation.campaignId);

    // Fire-and-forget donor notifications — only on a status *transition*,
    // never when the record is merely edited while already COMPLETED.
    const statusChanged = donation.paymentStatus !== existing.paymentStatus;
    if (statusChanged && donation.paymentStatus === "COMPLETED") {
      // Admin-confirmed settlement of a linked donation counts the same as a
      // gateway verify — advance the recurring parent / pledge tracking.
      await settleDonationCommitments(donation.id);
      void (async () => {
        try {
          const map = await loadSettings();
          const campaign = donation.campaignId
            ? await this.donationRepository.findCampaignTitle(donation.campaignId!)
            : null;
          await notifyDonation(
            map,
            {
              name: map["org.name"] || "United Angel Reach",
              footer: map["receipts.footer"] || undefined,
            },
            {
              donorName: donation.donorName,
              donorEmail: donation.donorEmail,
              donorPhone: donation.donorPhone,
              amount: donation.amount,
              currency: donation.currency,
              receiptNumber: donation.receiptNumber,
              campaign: campaign?.title ?? null,
            }
          );
        } catch (e) {
          log.error("donation_ack_failed", {
            error: e instanceof Error ? e : String(e),
            donationId: donation.id,
            receiptNumber: donation.receiptNumber,
          });
        }
      })();
    } else if (statusChanged && donation.paymentStatus === "FAILED") {
      void (async () => {
        try {
          const map = await loadSettings();
          const org = {
            name: map["org.name"] || "United Angel Reach",
            footer: map["receipts.footer"] || undefined,
          };
          const bodyHtml = `
            <p style="margin:0 0 8px;">Dear ${donation.donorName || "friend"},</p>
            <p style="margin:0 0 12px;">We are sorry — your payment attempt for receipt <strong>${donation.receiptNumber}</strong> could not be completed. If any amount was deducted, it will be automatically reversed by your bank within a few working days.</p>
            <p style="margin:0 0 12px;">If you would still like to give, please try again at your convenience — and if the trouble persists, just reply to this email and we will help.</p>
            <p style="margin:0;">With apologies,<br/>The ${org.name} Team</p>`;
          const out = await sendEmail(map, {
            to: donation.donorEmail,
            subject: `Payment could not be completed — ${donation.receiptNumber}`,
            html: emailShell("Payment attempt failed", bodyHtml, org),
          });
          if (out && !out.ok && !out.skipped)
            log.error("donation_failure_email_failed", {
              error: out.message,
              donationId: donation.id,
              receiptNumber: donation.receiptNumber,
            });
        } catch (e) {
          log.error("donation_failure_email_failed", {
            error: e instanceof Error ? e : String(e),
            donationId: donation.id,
            receiptNumber: donation.receiptNumber,
          });
        }
      })();
    }

    await logActivity(
      actor.name,
      "DONATION_UPDATE",
      "DONATION",
      `${donation.receiptNumber} → ${Object.keys(data).join(", ")}`,
      actor.userId
    );

    return donation;
  }

  /** DELETE /api/donations/:id — admin removes a donation. */
  async deleteDonation(id: string, actor: Session): Promise<{ ok: boolean }> {
    const existing = await this.donationRepository.findDonationById(id);
    if (!existing) {
      log.warn("donation_delete_not_found", { donationId: id, actor: actor.userId });
      throw new ApiError("Donation not found", 404);
    }

    await this.donationRepository.deleteDonation(id);
    log.info("donation_deleted", {
      donationId: id,
      receiptNumber: existing.receiptNumber,
      amount: existing.amount,
      actor: actor.userId,
    });
    await this.recomputeCampaign(existing.campaignId);

    await logActivity(
      actor.name,
      "DONATION_DELETE",
      "DONATION",
      `${existing.receiptNumber} · ₹${existing.amount}`,
      actor.userId
    );

    return { ok: true };
  }

  /** Recompute campaign.raisedAmount from COMPLETED donations (+ invalidation). */
  private async recomputeCampaign(campaignId: string | null | undefined) {
    if (!campaignId) return;
    await this.donationRepository.recomputeCampaignRaised(campaignId);
    await invalidateCampaigns();
    await invalidateStats();
  }
}