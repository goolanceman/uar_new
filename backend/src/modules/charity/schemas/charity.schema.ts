/**
 * Charity schemas — request definitions for /api/charity/*.
 *
 * Pagination reproduces the legacy pageParams() exactly (parseInt(String(v))
 * || default, page floored at 1, limit clamped to [1, 100]). The remaining
 * query fields (type/status/category/tier/days/…) were read through silent
 * truthy checks / Number() coercions mid-flow, so they pass through the
 * schemas untouched and are coerced verbatim in the controller/service —
 * e.g. a non-numeric achievement `:id` still flows through as a string and
 * fails with the exact legacy "Invalid achievement id" 400 (a strict schema
 * here would invent a rejection). Bodies are permissive envelopes for the
 * same reason.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

/** pageParams(q, defLimit) as a Zod transform — parseInt semantics verbatim. */
const pagedQuery = <T extends z.ZodRawShape>(defLimit: number, extra: T = {} as T) =>
  z.object({
    page: z.any().optional().transform((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1)),
    limit: z
      .any()
      .optional()
      .transform((v) => Math.min(100, Math.max(1, parseInt(String(v ?? String(defLimit)), 10) || defLimit))),
    ...extra,
  });

// ─── Charity card ────────────────────────────────────────────────────────────

export const cardVerifyBodySchema = z.any();
export type CardVerifyBody = Record<string, unknown>;

// ─── Impact / points ─────────────────────────────────────────────────────────

export const pointsHistoryQuerySchema = pagedQuery(20, { type: z.any().optional() });
export type PointsHistoryQuery = z.infer<typeof pointsHistoryQuerySchema>;

/** ?days= — silent Math.min(365, Math.max(1, Number(days) || 30)) coercion. */
export const pointsExpiringQuerySchema = z.object({
  page: z.any().optional().transform((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1)),
  limit: z
    .any()
    .optional()
    .transform((v) => Math.min(100, Math.max(1, parseInt(String(v ?? "20"), 10) || 20))),
  days: z.any().optional().transform((v) => Math.min(365, Math.max(1, Number(v) || 30))),
});
export type PointsExpiringQuery = z.infer<typeof pointsExpiringQuerySchema>;

export const redeemBodySchema = z.any();
export type RedeemBody = Record<string, unknown>;

// ─── Achievements ────────────────────────────────────────────────────────────

export const achievementsQuerySchema = pagedQuery(50, {
  category: z.any().optional(),
  tier: z.any().optional(),
});
export type AchievementsQuery = z.infer<typeof achievementsQuerySchema>;

export const myAchievementsQuerySchema = pagedQuery(50, { status: z.any().optional() });
export type MyAchievementsQuery = z.infer<typeof myAchievementsQuerySchema>;

export const achievementIdParamSchema = z.object({ id: z.string() });
export type AchievementIdParams = z.infer<typeof achievementIdParamSchema>;

// ─── Goals ───────────────────────────────────────────────────────────────────

export const goalsQuerySchema = pagedQuery(50, { status: z.any().optional() });
export type GoalsQuery = z.infer<typeof goalsQuerySchema>;

export const goalBodySchema = z.any();
export type GoalBody = Record<string, unknown>;

export const goalIdParamSchema = stringIdParamSchema;
export type GoalIdParams = z.infer<typeof goalIdParamSchema>;

// ─── Events ──────────────────────────────────────────────────────────────────

export const eventsQuerySchema = pagedQuery(50, {
  type: z.any().optional(),
  status: z.any().optional(),
});
export type EventsQuery = z.infer<typeof eventsQuerySchema>;

export const myEventsQuerySchema = pagedQuery(50, { status: z.any().optional() });
export type MyEventsQuery = z.infer<typeof myEventsQuerySchema>;

export const eventCheckInBodySchema = z.any();
export type EventCheckInBody = Record<string, unknown>;

export const eventIdParamSchema = stringIdParamSchema;
export type EventIdParams = z.infer<typeof eventIdParamSchema>;

export const eventRegisterBodySchema = z.any();
export type EventRegisterBody = Record<string, unknown>;
