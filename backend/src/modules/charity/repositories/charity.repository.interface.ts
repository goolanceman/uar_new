/**
 * Charity repository contract — persistence gateway for /api/charity/*.
 * ALL Prisma access for charity points/achievements/goals/events/card
 * settlement lives in the shared domain modules @/domains/charity/* (read-only
 * shared code); this contract exposes exactly the operations the endpoints
 * use — the four legacy in-route Prisma reads plus thin delegations to the
 * lib domain functions — so the service stays decoupled from HTTP and
 * Prisma alike.
 */
import type { Achievement, CharityCard, User } from "@prisma/client";
import type { buildImpactMetrics, syncCardStats } from "@/domains/charity/card";
import type {
  achievementsSummary,
  achievementProgress,
  claimAchievement,
  myAchievements,
} from "@/domains/charity/achievements";
import type {
  pointsExpiring,
  pointsHistory,
  pointsOverview,
  redeemPoints,
} from "@/domains/charity/points";
import type {
  completeGoal,
  createGoal,
  deleteGoal,
  getGoal,
  goalsSummary,
  listGoals,
  updateGoal,
} from "@/domains/charity/goals";
import type {
  cancelRegistration,
  checkIn,
  eventDetails,
  listEvents,
  myEvents,
  registerForEvent,
} from "@/domains/charity/events";

export type CardWithUser = CharityCard & { user: User };

/** Where-filter for the achievement catalogue (isActive always true). */
export interface AchievementFilter {
  category?: string;
  tier?: string;
}

export interface CharityRepository {
  // Direct reads the legacy routes performed inline
  findCardByUserId(userId: string): Promise<CharityCard | null>;
  findCardByNumberWithUser(cardNumber: string): Promise<CardWithUser | null>;
  findUserById(id: string): Promise<User | null>;
  listAchievements(
    filter: AchievementFilter,
    skip: number,
    limit: number
  ): Promise<{ rows: Achievement[]; total: number }>;

  // Delegations to the shared domain modules
  syncCardStats(userId: string): ReturnType<typeof syncCardStats>;
  buildImpactMetrics(userId: string): ReturnType<typeof buildImpactMetrics>;

  pointsOverview(userId: string): ReturnType<typeof pointsOverview>;
  pointsHistory(
    userId: string,
    opts: { type?: string | null; skip: number; limit: number }
  ): ReturnType<typeof pointsHistory>;
  pointsExpiring(
    userId: string,
    days: number,
    skip: number,
    limit: number
  ): ReturnType<typeof pointsExpiring>;
  redeemPoints(
    userId: string,
    input: { points: number; redemptionType: string; description?: string | null }
  ): ReturnType<typeof redeemPoints>;

  myAchievements(userId: string, status: string): ReturnType<typeof myAchievements>;
  achievementProgress(userId: string, achievementId: number): ReturnType<typeof achievementProgress>;
  claimAchievement(userId: string, achievementId: number): ReturnType<typeof claimAchievement>;
  achievementsSummary(userId: string): ReturnType<typeof achievementsSummary>;

  listGoals(userId: string, status: string): ReturnType<typeof listGoals>;
  getGoal(userId: string, goalId: string): ReturnType<typeof getGoal>;
  createGoal(userId: string, input: Parameters<typeof createGoal>[1]): ReturnType<typeof createGoal>;
  updateGoal(
    userId: string,
    goalId: string,
    input: Parameters<typeof updateGoal>[2]
  ): ReturnType<typeof updateGoal>;
  deleteGoal(userId: string, goalId: string): ReturnType<typeof deleteGoal>;
  completeGoal(userId: string, goalId: string): ReturnType<typeof completeGoal>;
  goalsSummary(userId: string): ReturnType<typeof goalsSummary>;

  listEvents(
    userId: string | null,
    filters: { type?: string | null; status?: string | null }
  ): ReturnType<typeof listEvents>;
  myEvents(userId: string, status: string): ReturnType<typeof myEvents>;
  eventDetails(eventId: string, userId: string | null): ReturnType<typeof eventDetails>;
  registerForEvent(
    userId: string,
    eventId: string,
    notes?: string | null
  ): ReturnType<typeof registerForEvent>;
  cancelRegistration(userId: string, eventId: string): ReturnType<typeof cancelRegistration>;
  checkIn(userId: string, eventId: string, qrCode?: string | null): ReturnType<typeof checkIn>;
}
