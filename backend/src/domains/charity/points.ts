/**
 * Donation points domain logic — port of the legacy DonationPointsController
 * (mobile compat): balance, history, expiring, redeem, summary.
 */
import type { Donation, DonationPoint } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { ApiError } from "@/infrastructure/auth/session";

export const POINT_TYPES = ["earned", "bonus", "redeemed", "expired", "adjustment"] as const;
export const REDEMPTION_TYPES = ["donation", "reward", "discount"] as const;

/** Total active points — isExpired false AND (expiresAt null OR > now). */
export function activeWhere(userId: string) {
  return {
    userId,
    isExpired: false,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
}

function dateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** camelCase point transaction wire (donation reduced to its light shape). */
export function serializePoint(t: DonationPoint & { donation?: Donation | null }) {
  const donation = t.donation ?? null;
  return {
    id: t.id,
    userId: t.userId,
    donationId: t.donationId,
    points: t.points,
    type: t.type,
    description: t.description,
    expiresAt: dateOnly(t.expiresAt),
    isExpired: t.isExpired,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    ...(donation
      ? {
          donation: {
            id: donation.id,
            amount: donation.amount,
            campaignId: donation.campaignId,
            causePostId: donation.causePostId,
          },
        }
      : {}),
  };
}

/** GET /points — balance + summary merged. */
export async function pointsOverview(userId: string) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [active, lifetime, expired, expiring, monthEarned, recent] = await Promise.all([
    db.donationPoint.aggregate({ _sum: { points: true }, where: activeWhere(userId) }),
    db.donationPoint.aggregate({ _sum: { points: true }, where: { userId } }),
    db.donationPoint.aggregate({ _sum: { points: true }, where: { userId, isExpired: true } }),
    db.donationPoint.aggregate({
      _sum: { points: true },
      where: { ...activeWhere(userId), expiresAt: { lte: new Date(Date.now() + 30 * 864e5), not: null } },
    }),
    db.donationPoint.aggregate({
      _sum: { points: true },
      where: { userId, type: "earned", createdAt: { gte: monthStart } },
    }),
    db.donationPoint.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { donation: true },
    }),
  ]);
  return {
    activePoints: active._sum.points ?? 0,
    lifetimePoints: lifetime._sum.points ?? 0,
    expiredPoints: expired._sum.points ?? 0,
    expiringSoon: expiring._sum.points ?? 0,
    earnedThisMonth: monthEarned._sum.points ?? 0,
    expiringIn30Days: expiring._sum.points ?? 0,
    recentTransactions: recent.map(serializePoint),
  };
}

/** GET /points/history — paged transaction list (optionally by type). */
export async function pointsHistory(userId: string, opts: { type?: string | null; skip: number; limit: number }) {
  const type = opts.type;
  if (type && !POINT_TYPES.includes(type as (typeof POINT_TYPES)[number])) {
    throw new ApiError("Invalid points type", 400);
  }
  const where = { userId, ...(type ? { type } : {}) };
  const [rows, total] = await Promise.all([
    db.donationPoint.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.limit,
      include: { donation: true },
    }),
    db.donationPoint.count({ where: { userId } }),
  ]);
  return { rows, total };
}

/** GET /points/expiring — active points expiring within ?days= (default 30). */
export async function pointsExpiring(userId: string, days: number, skip: number, limit: number) {
  const rows = await db.donationPoint.findMany({
    where: { ...activeWhere(userId), expiresAt: { lte: new Date(Date.now() + days * 864e5), not: null } },
    orderBy: { expiresAt: "asc" },
    skip,
    take: limit,
    include: { donation: true },
  });
  return rows;
}

/** POST /points/redeem — spend points; mirrors to card + user totals. */
export async function redeemPoints(
  userId: string,
  input: { points: number; redemptionType: string; description?: string | null }
) {
  if (!REDEMPTION_TYPES.includes(input.redemptionType as (typeof REDEMPTION_TYPES)[number])) {
    throw new ApiError("Invalid redemption type", 400);
  }
  const active = await db.donationPoint.aggregate({ _sum: { points: true }, where: activeWhere(userId) });
  const activePoints = active._sum.points ?? 0;
  if (activePoints < input.points) throw new ApiError("Insufficient points balance", 400);

  const redemption = await db.donationPoint.create({
    data: {
      userId,
      donationId: null,
      points: -input.points,
      type: "redeemed",
      description: input.description ?? `Points redeemed for ${input.redemptionType}`,
      expiresAt: null,
    },
  });
  await db.charityCard.update({
    where: { userId },
    data: { donationPoints: { decrement: input.points } },
  }).catch(() => undefined); // card may not exist yet
  await db.user.update({
    where: { id: userId },
    data: { totalPoints: { decrement: input.points } },
  });

  return { redemption: serializePoint({ ...redemption, donation: null }), remainingPoints: activePoints - input.points };
}
