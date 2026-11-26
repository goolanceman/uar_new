/**
 * Charity card domain logic — port of the legacy CharityCardService (mobile
 * compat) + CharityCard model accessors. Shared by the generic /api/charity
 * router and the donation settlement side effects.
 */
import { randomBytes } from "node:crypto";
import type { CharityCard, User } from "@prisma/client";
import { db } from "@/lib/db";

export const LEVEL_THRESHOLDS: Record<string, number> = { bronze: 0, silver: 500, gold: 2500, platinum: 10000 };
export const LEVEL_COLORS: Record<string, string> = {
  bronze: "#CD7F32",
  silver: "#C0C0C0",
  gold: "#FFD700",
  platinum: "#E5E4E2",
  diamond: "#B9F2FF",
};
export const LEVEL_BENEFITS: Record<string, string[]> = {
  bronze: ["Basic digital charity card", "Donation tracking", "Impact dashboard", "Monthly newsletter"],
  silver: [
    "All Bronze benefits", "10% bonus points on donations", "Priority customer support",
    "Quarterly impact reports", "Event invitations",
  ],
  gold: [
    "All Silver benefits", "20% bonus points on donations", "VIP event access",
    "Personal impact consultant", "Annual recognition award", "Tax benefit assistance",
  ],
  platinum: [
    "All Gold benefits", "30% bonus points on donations", "Executive roundtable access",
    "Naming opportunities", "Strategic partnership meetings", "Custom cause creation",
    "Legacy program enrollment",
  ],
};

/** The static tier ladder the /card/tiers endpoint serves. */
export const CHARITY_TIERS = [
  { name: "bronze", minPoints: 0, color: LEVEL_COLORS.bronze, benefits: LEVEL_BENEFITS.bronze, bonusPoints: 0 },
  { name: "silver", minPoints: 1000, color: LEVEL_COLORS.silver, benefits: LEVEL_BENEFITS.silver, bonusPoints: 10 },
  { name: "gold", minPoints: 5000, color: LEVEL_COLORS.gold, benefits: LEVEL_BENEFITS.gold, bonusPoints: 20 },
  { name: "platinum", minPoints: 20000, color: LEVEL_COLORS.platinum, benefits: LEVEL_BENEFITS.platinum, bonusPoints: 30 },
];

export function determineMembershipLevel(points: number): string {
  if (points >= 10000) return "platinum";
  if (points >= 2500) return "gold";
  if (points >= 500) return "silver";
  return "bronze";
}

/** Points % to next level (CharityCard::getPointsToNextLevelAttribute). */
export function pointsToNextTier(donationPoints: number, level: string): number {
  const levels = Object.keys(LEVEL_THRESHOLDS);
  const idx = levels.indexOf(level);
  if (idx === -1 || idx === levels.length - 1) return 0;
  return Math.max(0, LEVEL_THRESHOLDS[levels[idx + 1]] - donationPoints);
}

/** CharityCard::generateCardNumber — 'CHR-' + 16 uppercase hex. */
export function generateCardNumber(): string {
  return `CHR-${randomBytes(8).toString("hex").toUpperCase()}`;
}

/**
 * CharityCardService::syncCardStats — recompute card + User charity columns
 * from COMPLETED donations (web AND mobile — they share the Donation table).
 * 2 points per rupee; impact score gets a consistency multiplier by donation
 * count.
 */
export async function syncCardStats(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;

  const stats = await db.donation.aggregate({
    _sum: { amount: true },
    _count: { _all: true },
    where: { donorId: userId, paymentStatus: "COMPLETED" },
  });
  const totalDonated = stats._sum.amount ?? 0;
  const donationCount = stats._count._all;
  const donationPoints = Math.trunc(totalDonated * 2);
  const multiplier = donationCount >= 50 ? 2.0 : donationCount >= 25 ? 1.5 : donationCount >= 10 ? 1.25 : 1.0;
  const impactScore = Math.trunc(donationPoints * multiplier);
  const membershipLevel = determineMembershipLevel(donationPoints);

  const existing = await db.charityCard.findUnique({ where: { userId } });
  if (!existing) {
    await db.charityCard.create({
      data: {
        userId,
        cardNumber: generateCardNumber(),
        memberName: user.name || "Member",
        membershipLevel: membershipLevel,
        totalDonated,
        donationPoints,
        impactScore,
        memberSince: user.memberSince ?? user.createdAt,
        validUntil: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
      },
    });
  } else {
    await db.charityCard.update({
      where: { userId },
      data: { totalDonated, donationPoints, impactScore, membershipLevel },
    });
  }

  await db.user.update({
    where: { id: userId },
    data: {
      lifetimeDonated: totalDonated,
      totalPoints: donationPoints,
      impactScore,
      currentTier: membershipLevel,
      ...(user.memberSince ? {} : { memberSince: user.createdAt }),
    },
  });
}

/** camelCase card wire (legacy CharityCard accessors folded in). */
export function serializeCard(card: CharityCard, user?: User | null) {
  return {
    id: card.id,
    userId: card.userId,
    cardNumber: card.cardNumber,
    memberName: card.memberName,
    membershipLevel: card.membershipLevel,
    totalDonated: card.totalDonated,
    donationPoints: card.donationPoints,
    impactScore: card.impactScore,
    memberSince: card.memberSince ? card.memberSince.toISOString().slice(0, 10) : null,
    validUntil: card.validUntil ? card.validUntil.toISOString().slice(0, 10) : null,
    qrCode: card.qrCode,
    isActive: card.isActive,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    levelColor: LEVEL_COLORS[card.membershipLevel] ?? LEVEL_COLORS.bronze,
    levelBenefits: LEVEL_BENEFITS[card.membershipLevel] ?? LEVEL_BENEFITS.bronze,
    pointsToNextTier: pointsToNextTier(card.donationPoints, card.membershipLevel),
    isExpired: card.validUntil ? card.validUntil.getTime() < Date.now() : false,
    qrCodeUrl: `/api/charity/card/verify?cardNumber=${card.cardNumber}`,
    ...(user
      ? {
          user: {
            id: user.id,
            name: user.name,
            username: user.username ?? "",
            avatar: user.avatar,
          },
        }
      : {}),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Jun 2026" — member_since display format. */
function monthYear(d: Date | null | undefined): string | null {
  return d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : null;
}

/**
 * Merged impact metrics — the legacy GET /charity/impact (card stats) plus
 * the impact extras the Flutter ImpactMetrics model reads.
 */
export async function buildImpactMetrics(userId: string) {
  const card = await db.charityCard.findUnique({ where: { userId } });
  if (!card) return null;

  const [donationCount, activePoints, achievementsCount, causesAgg, eventsAttended, lastDonation] =
    await Promise.all([
      db.donation.count({ where: { donorId: userId, paymentStatus: "COMPLETED" } }),
      db.donationPoint.aggregate({
        _sum: { points: true },
        where: { userId, isExpired: false, type: "earned", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      }),
      db.userAchievement.count({ where: { userId } }),
      db.donation.groupBy({ by: ["causePostId"], where: { donorId: userId, paymentStatus: "COMPLETED", causePostId: { not: null } } }),
      db.eventParticipant.count({ where: { userId, status: "attended" } }),
      db.donation.findFirst({
        where: { donorId: userId, paymentStatus: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

  return {
    totalDonated: card.totalDonated,
    donationPoints: card.donationPoints,
    impactScore: card.impactScore,
    membershipLevel: card.membershipLevel,
    levelColor: LEVEL_COLORS[card.membershipLevel] ?? LEVEL_COLORS.bronze,
    pointsToNextTier: pointsToNextTier(card.donationPoints, card.membershipLevel),
    memberSince: monthYear(card.memberSince),
    validUntil: card.validUntil ? monthYear(card.validUntil) : "Lifetime",
    donationCount,
    activePoints: activePoints._sum.points ?? 0,
    achievementsCount,
    causesSupported: causesAgg.length,
    averageDonation: donationCount > 0 ? card.totalDonated / donationCount : 0,
    eventsAttended,
    lastDonationDate: lastDonation?.createdAt.toISOString() ?? null,
  };
}
