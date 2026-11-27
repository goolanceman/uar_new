/**
 * Charity repository implementation — the four legacy in-route Prisma reads
 * live here; every other operation delegates to the shared domain modules
 * @/lib/charity/*, which own all remaining Prisma access, so the wire shapes
 * are produced by exactly the legacy code path.
 */
import { db } from "@/infrastructure/database/prisma";
import type { Achievement } from "@prisma/client";
import {
  buildImpactMetrics as buildImpactMetricsFn,
  syncCardStats as syncCardStatsFn,
} from "@/lib/charity/card";
import {
  achievementsSummary as achievementsSummaryFn,
  achievementProgress as achievementProgressFn,
  claimAchievement as claimAchievementFn,
  myAchievements as myAchievementsFn,
} from "@/lib/charity/achievements";
import {
  pointsExpiring as pointsExpiringFn,
  pointsHistory as pointsHistoryFn,
  pointsOverview as pointsOverviewFn,
  redeemPoints as redeemPointsFn,
} from "@/lib/charity/points";
import {
  completeGoal as completeGoalFn,
  createGoal as createGoalFn,
  deleteGoal as deleteGoalFn,
  getGoal as getGoalFn,
  goalsSummary as goalsSummaryFn,
  listGoals as listGoalsFn,
  updateGoal as updateGoalFn,
} from "@/lib/charity/goals";
import {
  cancelRegistration as cancelRegistrationFn,
  checkIn as checkInFn,
  eventDetails as eventDetailsFn,
  listEvents as listEventsFn,
  myEvents as myEventsFn,
  registerForEvent as registerForEventFn,
} from "@/lib/charity/events";
import type {
  AchievementFilter,
  CharityRepository,
} from "./charity.repository.interface";

export class PrismaCharityRepository implements CharityRepository {
  findCardByUserId(userId: string) {
    return db.charityCard.findUnique({ where: { userId } });
  }

  findCardByNumberWithUser(cardNumber: string) {
    return db.charityCard.findUnique({ where: { cardNumber }, include: { user: true } });
  }

  findUserById(id: string) {
    return db.user.findUnique({ where: { id } });
  }

  /** Catalogue page — both queries run in parallel (legacy Promise.all). */
  async listAchievements(
    filter: AchievementFilter,
    skip: number,
    limit: number
  ): Promise<{ rows: Achievement[]; total: number }> {
    const where = {
      isActive: true,
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.tier ? { tier: filter.tier } : {}),
    };
    const [rows, total] = await Promise.all([
      db.achievement.findMany({
        where,
        orderBy: [{ tier: "asc" }, { pointsRequired: "asc" }],
        skip,
        take: limit,
      }),
      db.achievement.count({ where }),
    ]);
    return { rows, total };
  }

  syncCardStats(userId: string): ReturnType<typeof syncCardStatsFn> {
    return syncCardStatsFn(userId);
  }

  buildImpactMetrics(userId: string): ReturnType<typeof buildImpactMetricsFn> {
    return buildImpactMetricsFn(userId);
  }

  pointsOverview(userId: string): ReturnType<typeof pointsOverviewFn> {
    return pointsOverviewFn(userId);
  }

  pointsHistory(
    userId: string,
    opts: { type?: string | null; skip: number; limit: number }
  ): ReturnType<typeof pointsHistoryFn> {
    return pointsHistoryFn(userId, opts);
  }

  pointsExpiring(
    userId: string,
    days: number,
    skip: number,
    limit: number
  ): ReturnType<typeof pointsExpiringFn> {
    return pointsExpiringFn(userId, days, skip, limit);
  }

  redeemPoints(
    userId: string,
    input: { points: number; redemptionType: string; description?: string | null }
  ): ReturnType<typeof redeemPointsFn> {
    return redeemPointsFn(userId, input);
  }

  myAchievements(userId: string, status: string): ReturnType<typeof myAchievementsFn> {
    return myAchievementsFn(userId, status);
  }

  achievementProgress(userId: string, achievementId: number): ReturnType<typeof achievementProgressFn> {
    return achievementProgressFn(userId, achievementId);
  }

  claimAchievement(userId: string, achievementId: number): ReturnType<typeof claimAchievementFn> {
    return claimAchievementFn(userId, achievementId);
  }

  achievementsSummary(userId: string): ReturnType<typeof achievementsSummaryFn> {
    return achievementsSummaryFn(userId);
  }

  listGoals(userId: string, status: string): ReturnType<typeof listGoalsFn> {
    return listGoalsFn(userId, status);
  }

  getGoal(userId: string, goalId: string): ReturnType<typeof getGoalFn> {
    return getGoalFn(userId, goalId);
  }

  createGoal(userId: string, input: Parameters<typeof createGoalFn>[1]): ReturnType<typeof createGoalFn> {
    return createGoalFn(userId, input);
  }

  updateGoal(
    userId: string,
    goalId: string,
    input: Parameters<typeof updateGoalFn>[2]
  ): ReturnType<typeof updateGoalFn> {
    return updateGoalFn(userId, goalId, input);
  }

  deleteGoal(userId: string, goalId: string): ReturnType<typeof deleteGoalFn> {
    return deleteGoalFn(userId, goalId);
  }

  completeGoal(userId: string, goalId: string): ReturnType<typeof completeGoalFn> {
    return completeGoalFn(userId, goalId);
  }

  goalsSummary(userId: string): ReturnType<typeof goalsSummaryFn> {
    return goalsSummaryFn(userId);
  }

  listEvents(
    userId: string | null,
    filters: { type?: string | null; status?: string | null }
  ): ReturnType<typeof listEventsFn> {
    return listEventsFn(userId, filters);
  }

  myEvents(userId: string, status: string): ReturnType<typeof myEventsFn> {
    return myEventsFn(userId, status);
  }

  eventDetails(eventId: string, userId: string | null): ReturnType<typeof eventDetailsFn> {
    return eventDetailsFn(eventId, userId);
  }

  registerForEvent(
    userId: string,
    eventId: string,
    notes?: string | null
  ): ReturnType<typeof registerForEventFn> {
    return registerForEventFn(userId, eventId, notes);
  }

  cancelRegistration(userId: string, eventId: string): ReturnType<typeof cancelRegistrationFn> {
    return cancelRegistrationFn(userId, eventId);
  }

  checkIn(userId: string, eventId: string, qrCode?: string | null): ReturnType<typeof checkInFn> {
    return checkInFn(userId, eventId, qrCode);
  }
}
