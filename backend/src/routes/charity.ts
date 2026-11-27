/**
 * Charity routes — thin endpoint definitions; all logic lives in
 * src/modules/charity (routes → controllers → services → repositories).
 * The historical export path (`@/routes/charity`) is preserved: tests and
 * the app entry import `router` from here.
 *
 * /api/charity/* (GENERIC: shared by web + mobile).
 *
 * Replaces the mobile-only compat router src/routes/mobile/charity.ts:
 * same business logic (ported to src/lib/charity/*), but the generic REST
 * contract — Bearer [redacted] auth (requireAuth), raw JSON (no envelope),
 * camelCase fields, paged() lists, ApiError → {error}.
 *
 * Endpoints (legacy equivalent in brackets):
 *   GET  /card                        [GET /charity/card (+my-card)]
 *   GET  /card/tiers                  [GET /charity/card/tier-info]
 *   POST /card/verify                 [POST /charity/card/verify]
 *   POST /card/share                  [POST /charity/card/share]
 *   GET  /impact                      [GET /charity/impact (+card/stats)]
 *   GET  /points                      [GET /charity/points/balance + summary]
 *   GET  /points/history              [GET /charity/points/history]
 *   GET  /points/expiring             [GET /charity/points/expiring]
 *   POST /points/redeem               [POST /charity/points/redeem]
 *   GET  /achievements                [GET /charity/achievements/all]
 *   GET  /achievements/mine           [GET /charity/achievements/my-achievements]
 *   GET  /achievements/summary        [GET /charity/achievements/summary]
 *   GET  /achievements/:id/progress   [GET /charity/achievements/progress]
 *   POST /achievements/:id/claim      [POST /charity/achievements/claim]
 *   GET  /goals                       [GET|POST /charity/goals(+my-goals)]
 *   POST /goals                       [POST /charity/goals/create]
 *   GET  /goals/summary               [GET /charity/goals/summary]
 *   GET  /goals/:id                   [GET /charity/goals/:id]
 *   PATCH /goals/:id                  [POST /charity/goals/update]
 *   DELETE /goals/:id                 [POST /charity/goals/delete]
 *   POST /goals/:id/complete          [POST /charity/goals/complete]
 *   GET  /events                      [GET /charity/events(+all)]
 *   GET  /events/mine                 [GET /charity/events/my-events]
 *   GET  /events/:id                  [GET /charity/events/:id(+details)]
 *   POST /events/:id/register         [POST /charity/events/:id/register]
 *   POST /events/:id/cancel           [POST /charity/events/:id/cancel]
 *   POST /events/check-in             [POST /charity/events/check-in]
 *
 * The donation settlement side effects (points/card/achievements) now run
 * from routes/payments.ts settleCompleted via lib/charity/settlement.ts.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  achievementIdParamSchema,
  achievementsQuerySchema,
  cardVerifyBodySchema,
  eventIdParamSchema,
  eventCheckInBodySchema,
  eventRegisterBodySchema,
  eventsQuerySchema,
  goalBodySchema,
  goalIdParamSchema,
  goalsQuerySchema,
  myAchievementsQuerySchema,
  myEventsQuerySchema,
  pointsExpiringQuerySchema,
  pointsHistoryQuerySchema,
  redeemBodySchema,
} from "@/modules/charity/schemas/charity.schema";
import { charityController } from "@/modules/charity";

export const router = Router();

// ─── CHARITY CARD ────────────────────────────────────────────────────────────

// GET /api/charity/card — sync stats from COMPLETED donations, then return.
router.get("/card", authenticate, charityController.card);

// GET /api/charity/card/tiers — the static tier ladder.
router.get("/card/tiers", charityController.cardTiers);

// POST /api/charity/card/verify — QR scanning (card number → public card info).
router.post("/card/verify", validate({ body: cardVerifyBodySchema }), charityController.verifyCard);

// POST /api/charity/card/share — share copy for the donor's card.
router.post("/card/share", authenticate, charityController.shareCard);

// ─── IMPACT (merged card stats + impact metrics) ─────────────────────────────

// GET /api/charity/impact
router.get("/impact", authenticate, charityController.impact);

// ─── DONATION POINTS ─────────────────────────────────────────────────────────

// GET /api/charity/points — balance + summary merged.
router.get("/points", authenticate, charityController.points);

// GET /api/charity/points/history — paged transactions, optional ?type=.
router.get(
  "/points/history",
  authenticate,
  validate({ query: pointsHistoryQuerySchema }),
  charityController.pointsHistory
);

// GET /api/charity/points/expiring — active points expiring within ?days=.
router.get(
  "/points/expiring",
  authenticate,
  validate({ query: pointsExpiringQuerySchema }),
  charityController.pointsExpiring
);

// POST /api/charity/points/redeem — spend points on a redemption type.
router.post(
  "/points/redeem",
  authenticate,
  validate({ body: redeemBodySchema }),
  charityController.redeem
);

// ─── ACHIEVEMENTS ────────────────────────────────────────────────────────────

// GET /api/charity/achievements — catalogue with filters (public).
router.get("/achievements", validate({ query: achievementsQuerySchema }), charityController.achievements);

// GET /api/charity/achievements/mine — catalogue + the user's unlock state.
router.get(
  "/achievements/mine",
  authenticate,
  validate({ query: myAchievementsQuerySchema }),
  charityController.myAchievements
);

// GET /api/charity/achievements/summary — counts + recent unlocks.
router.get("/achievements/summary", authenticate, charityController.achievementsSummary);

// GET /api/charity/achievements/:id/progress
router.get(
  "/achievements/:id/progress",
  authenticate,
  validate({ params: achievementIdParamSchema }),
  charityController.achievementProgress
);

// POST /api/charity/achievements/:id/claim
router.post(
  "/achievements/:id/claim",
  authenticate,
  validate({ params: achievementIdParamSchema }),
  charityController.claimAchievement
);

// ─── DONATION GOALS ──────────────────────────────────────────────────────────

// GET /api/charity/goals — the user's goals, optional ?status=.
router.get("/goals", authenticate, validate({ query: goalsQuerySchema }), charityController.listGoals);

// POST /api/charity/goals — create a goal.
router.post("/goals", authenticate, validate({ body: goalBodySchema }), charityController.createGoal);

// GET /api/charity/goals/summary — counts (before /:id).
router.get("/goals/summary", authenticate, charityController.goalsSummary);

// GET /api/charity/goals/:id
router.get("/goals/:id", authenticate, validate({ params: goalIdParamSchema }), charityController.getGoal);

// PATCH /api/charity/goals/:id
router.patch(
  "/goals/:id",
  authenticate,
  validate({ params: goalIdParamSchema, body: goalBodySchema }),
  charityController.updateGoal
);

// DELETE /api/charity/goals/:id
router.delete("/goals/:id", authenticate, validate({ params: goalIdParamSchema }), charityController.deleteGoal);

// POST /api/charity/goals/:id/complete
router.post(
  "/goals/:id/complete",
  authenticate,
  validate({ params: goalIdParamSchema }),
  charityController.completeGoal
);

// ─── CHARITY EVENTS ──────────────────────────────────────────────────────────

// GET /api/charity/events — list; personalises with the session when present.
router.get("/events", validate({ query: eventsQuerySchema }), charityController.listEvents);

// GET /api/charity/events/mine — the user's registrations (before /:id).
router.get(
  "/events/mine",
  authenticate,
  validate({ query: myEventsQuerySchema }),
  charityController.myEvents
);

// POST /api/charity/events/check-in — QR check-in (before /:id routes).
router.post(
  "/events/check-in",
  authenticate,
  validate({ body: eventCheckInBodySchema }),
  charityController.checkIn
);

// GET /api/charity/events/:id — details + participants.
router.get("/events/:id", validate({ params: eventIdParamSchema }), charityController.eventDetails);

// POST /api/charity/events/:id/register
router.post(
  "/events/:id/register",
  authenticate,
  validate({ params: eventIdParamSchema, body: eventRegisterBodySchema }),
  charityController.register
);

// POST /api/charity/events/:id/cancel
router.post(
  "/events/:id/cancel",
  authenticate,
  validate({ params: eventIdParamSchema }),
  charityController.cancel
);
