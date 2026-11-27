/**
 * Achievements domain logic — port of the legacy AchievementsController
 * unlock/claim checks (mobile compat). Shared by the generic /api/charity
 * router and the donation settlement side effects.
 */
import type { Achievement } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { ApiError } from "@/infrastructure/auth/session";
import { sendPush, feedEvent } from "@/domains/community/push";
import { LEVEL_COLORS } from "@/domains/charity/card";

/** camelCase achievement wire (the Dart Achievement model reads these keys). */
export function achievementWire(a: Achievement) {
  const requirement = a.pointsRequired || a.amountRequired || a.countRequired;
  const requirementType =
    a.amountRequired > 0 ? "donation_amount" : a.countRequired > 0 ? "count" : a.pointsRequired > 0 ? "points" : "donation_amount";
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description,
    icon: a.iconUrl ?? "🏆",
    iconUrl: a.iconUrl,
    category: a.category,
    tier: a.tier,
    tierColor: LEVEL_COLORS[a.tier] ?? LEVEL_COLORS.bronze,
    rewardPoints: a.rewardPoints,
    requirement,
    requirementType,
    pointsRequired: a.pointsRequired,
    amountRequired: a.amountRequired,
    countRequired: a.countRequired,
    isActive: a.isActive,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export const ACHIEVEMENT_CATEGORIES = ["donation", "engagement", "impact", "milestone", "special"] as const;
export const ACHIEVEMENT_TIERS = ["bronze", "silver", "gold", "platinum", "diamond"] as const;

/**
 * Achievements evaluation — mirrors the legacy unlock checks: an achievement
 * unlocks when amount_required (lifetime donated), count_required (success
 * donation count) or points_required (total points) is reached.
 */
export async function evaluateAchievements(userId: string): Promise<void> {
  const achievements = await db.achievement.findMany({ where: { isActive: true } });
  if (!achievements.length) return;

  const [donationAgg, existing] = await Promise.all([
    db.donation.aggregate({
      _sum: { amount: true },
      _count: { _all: true },
      where: { donorId: userId, paymentStatus: "COMPLETED" },
    }),
    db.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
  ]);
  const have = new Set(existing.map((e) => e.achievementId));
  const totalDonated = donationAgg._sum.amount ?? 0;
  const donationCount = donationAgg._count._all;
  const user = await db.user.findUnique({ where: { id: userId }, select: { totalPoints: true } });
  const points = user?.totalPoints ?? 0;

  for (const a of achievements) {
    if (have.has(a.id)) continue;
    let progress = 0;
    if (a.amountRequired > 0) progress = Math.trunc(totalDonated);
    else if (a.countRequired > 0) progress = donationCount;
    else if (a.pointsRequired > 0) progress = points;

    const requirement = a.amountRequired || a.countRequired || a.pointsRequired;
    const unlocked = requirement > 0 && progress >= requirement;
    // NOTE: UserAchievement.unlockedAt is NOT NULL, so in-progress rows are
    // not persisted — a row exists only once unlocked (progress readers
    // compute live values from the same aggregates).
    if (!unlocked) continue;
    await db.userAchievement.upsert({
      where: { userId_achievementId: { userId, achievementId: a.id } },
      update: { progress },
      create: { userId, achievementId: a.id, progress, unlockedAt: new Date() },
    });
    await sendPush({
      userId,
      title: "Achievement unlocked!",
      body: `Congratulations — you unlocked "${a.name}"!`,
      type: "ACHIEVEMENT",
      data: { achievementId: String(a.id), type: "achievement" },
    });
    feedEvent("achievement.unlocked", { userId, achievementId: a.id, name: a.name });
  }
}

/** All active achievements with the signed-in user's unlock state applied. */
export async function myAchievements(userId: string, status: string) {
  const [rows, userRows] = await Promise.all([
    db.achievement.findMany({ where: { isActive: true }, orderBy: [{ tier: "asc" }, { pointsRequired: "asc" }] }),
    db.userAchievement.findMany({ where: { userId } }),
  ]);
  const byId = new Map(userRows.map((u) => [u.achievementId, u]));

  let list = rows.map((a) => {
    const ua = byId.get(a.id);
    const isUnlocked = !!ua?.unlockedAt;
    return {
      ...achievementWire(a),
      isUnlocked,
      isClaimed: ua?.isClaimed ?? false,
      progress: ua?.progress ?? 0,
      unlockedAt: ua?.unlockedAt ? ua.unlockedAt.toISOString() : null,
      claimedAt: ua?.claimedAt ? ua.claimedAt.toISOString() : null,
    };
  });

  if (status === "unlocked") list = list.filter((a) => a.isUnlocked);
  else if (status === "claimed") list = list.filter((a) => a.isClaimed);
  else if (status === "unclaimed") list = list.filter((a) => a.isUnlocked && !a.isClaimed);
  else if (status === "in_progress") list = list.filter((a) => !a.isUnlocked);

  return list;
}

/** GET /achievements/:id/progress — live progress for one achievement. */
export async function achievementProgress(userId: string, achievementId: number) {
  const achievement = await db.achievement.findUnique({ where: { id: achievementId } });
  if (!achievement) throw new ApiError("Achievement not found", 404);

  const ua = await db.userAchievement.findUnique({
    where: { userId_achievementId: { userId, achievementId } },
  });
  const progress = ua?.progress ?? 0;
  const requirement = achievement.pointsRequired || achievement.amountRequired || achievement.countRequired;
  const percentage = requirement > 0 ? Math.min(100, (progress / requirement) * 100) : 0;

  return {
    achievement: achievementWire(achievement),
    progress,
    requirement,
    percentage: Math.round(percentage * 100) / 100,
    isUnlocked: !!ua?.unlockedAt,
    isClaimed: ua?.isClaimed ?? false,
  };
}

/** POST /achievements/:id/claim — mark claimed + award the bonus points. */
export async function claimAchievement(userId: string, achievementId: number) {
  const ua = await db.userAchievement.findUnique({
    where: { userId_achievementId: { userId, achievementId } },
    include: { achievement: true },
  });
  if (!ua) throw new ApiError("Achievement not found", 404);
  if (!ua.unlockedAt) throw new ApiError("Achievement not unlocked yet", 400);
  if (ua.isClaimed) throw new ApiError("Achievement already claimed", 400);

  const claimed = await db.userAchievement.update({
    where: { id: ua.id },
    data: { isClaimed: true, claimedAt: new Date() },
    include: { achievement: true },
  });

  // UserAchievement::claim — award the bonus points row + mirror to card/user.
  if (ua.achievement.rewardPoints > 0) {
    await db.donationPoint.create({
      data: {
        userId,
        donationId: null,
        points: ua.achievement.rewardPoints,
        type: "bonus",
        description: `Bonus points for achievement: ${ua.achievement.name}`,
      },
    });
    await db.charityCard.update({
      where: { userId },
      data: { donationPoints: { increment: ua.achievement.rewardPoints } },
    }).catch(() => undefined);
    await db.user.update({
      where: { id: userId },
      data: { totalPoints: { increment: ua.achievement.rewardPoints } },
    });
  }

  return {
    achievement: {
      ...achievementWire(claimed.achievement),
      isUnlocked: true,
      isClaimed: claimed.isClaimed,
      progress: claimed.progress,
      unlockedAt: claimed.unlockedAt.toISOString(),
      claimedAt: claimed.claimedAt ? claimed.claimedAt.toISOString() : null,
    },
    rewardPoints: ua.achievement.rewardPoints,
  };
}

/** GET /achievements/summary — counts + recent unlocks. */
export async function achievementsSummary(userId: string) {
  const [total, unlocked, claimed, recent] = await Promise.all([
    db.achievement.count({ where: { isActive: true } }),
    db.userAchievement.count({ where: { userId } }),
    db.userAchievement.count({ where: { userId, isClaimed: true } }),
    db.userAchievement.findMany({
      where: { userId },
      orderBy: { unlockedAt: "desc" },
      take: 5,
      include: { achievement: true },
    }),
  ]);
  return {
    totalAchievements: total,
    unlockedCount: unlocked,
    claimedCount: claimed,
    unclaimedCount: unlocked - claimed,
    completionPercentage: total > 0 ? Math.round((unlocked / total) * 10000) / 100 : 0,
    recentAchievements: recent.map((ua) => ({
      ...achievementWire(ua.achievement),
      isUnlocked: true,
      isClaimed: ua.isClaimed,
      progress: ua.progress,
      unlockedAt: ua.unlockedAt.toISOString(),
      claimedAt: ua.claimedAt ? ua.claimedAt.toISOString() : null,
    })),
  };
}
