/**
 * Charity routes — /api/charity/* (GENERIC: shared by web + mobile).
 *
 * Replaces the mobile-only compat router src/routes/mobile/charity.ts:
 * same business logic (ported to src/lib/charity/*), but the generic REST
 * contract — Bearer session auth (requireAuth), raw JSON (no envelope),
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
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ApiError, requireAuth, validateSession, handleError, json } from "@/lib/session";
import { paged, pageParams } from "@/lib/community/serializers";
import {
  CHARITY_TIERS,
  serializeCard,
  syncCardStats,
  buildImpactMetrics,
} from "@/lib/charity/card";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_TIERS,
  achievementWire,
  myAchievements,
  achievementProgress,
  claimAchievement,
  achievementsSummary,
} from "@/lib/charity/achievements";
import {
  pointsOverview,
  pointsHistory,
  pointsExpiring,
  redeemPoints,
  serializePoint,
  POINT_TYPES,
} from "@/lib/charity/points";
import {
  goalWire,
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  completeGoal,
  goalsSummary,
} from "@/lib/charity/goals";
import {
  EVENT_TYPES,
  eventWire,
  listEvents,
  myEvents,
  eventDetails,
  registerForEvent,
  cancelRegistration,
  checkIn,
} from "@/lib/charity/events";

export const router = Router();

const log = logger.child("charity");

type Params = Record<string, string>;

function intParam(raw: string | undefined, label: string): number {
  const id = Math.trunc(Number(raw));
  if (!Number.isFinite(id) || id <= 0) throw new ApiError(`Invalid ${label}`, 400);
  return id;
}

/** Optional session user id — public reads still personalise per-user state. */
async function optionalUserId(req: Parameters<typeof validateSession>[0]): Promise<string | null> {
  const s = await validateSession(req);
  return s?.userId ?? null;
}

// ─── CHARITY CARD ────────────────────────────────────────────────────────────

// GET /api/charity/card — sync stats from COMPLETED donations, then return.
router.get("/card", async (req, res) => {
  try {
    const session = await requireAuth(req);
    await syncCardStats(session.userId);
    const card = await db.charityCard.findUnique({ where: { userId: session.userId } });
    if (!card) throw new ApiError("Failed to retrieve charity card", 500);
    const user = await db.user.findUnique({ where: { id: session.userId } });
    return json(res, serializeCard(card, user));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/charity/card/tiers — the static tier ladder.
router.get("/card/tiers", async (_req, res) => {
  return json(res, { items: CHARITY_TIERS });
});

// POST /api/charity/card/verify — QR scanning (card number → public card info).
router.post("/card/verify", async (req, res) => {
  try {
    const cardNumber = String(req.body?.cardNumber ?? "").trim();
    if (!cardNumber) throw new ApiError("The card number field is required.", 400);
    if (cardNumber.length !== 20) throw new ApiError("The card number must be 20 characters.", 400);

    const card = await db.charityCard.findUnique({ where: { cardNumber }, include: { user: true } });
    if (!card) {
      log.warn("card_verify_not_found", { cardNumber });
      throw new ApiError("Invalid card number", 404);
    }

    if (card.validUntil && card.validUntil.getTime() < Date.now()) {
      log.debug("card_verify_expired", { cardNumber });
      return json(res, {
        cardNumber: card.cardNumber,
        validUntil: card.validUntil.toISOString().slice(0, 10),
        isValid: false,
        isExpired: true,
      });
    }

    return json(res, {
      cardNumber: card.cardNumber,
      membershipLevel: card.membershipLevel,
      user: {
        id: card.user.id,
        name: card.user.name,
        username: card.user.username ?? "",
        avatar: card.user.avatar,
      },
      totalDonated: card.totalDonated,
      impactScore: card.impactScore,
      validUntil: card.validUntil ? card.validUntil.toISOString().slice(0, 10) : null,
      isValid: true,
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/charity/card/share — share copy for the donor's card.
router.post("/card/share", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const card = await db.charityCard.findUnique({ where: { userId: session.userId } });
    if (!card) {
      log.warn("card_share_not_found", { actor: session.userId });
      throw new ApiError("Card not found", 404);
    }

    const level = card.membershipLevel.charAt(0).toUpperCase() + card.membershipLevel.slice(1);
    const donated = `₹${card.totalDonated.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
    return json(res, {
      message: "Check out my charity impact!",
      cardNumber: card.cardNumber,
      membershipLevel: level,
      totalDonated: donated,
      impactScore: card.impactScore,
      shareUrl: `/api/charity/card/verify?cardNumber=${card.cardNumber}`,
      socialText: `I've donated ${donated} and achieved ${level} tier status! Join me in making an impact. 🌟`,
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── IMPACT (merged card stats + impact metrics) ─────────────────────────────

// GET /api/charity/impact
router.get("/impact", async (req, res) => {
  try {
    const session = await requireAuth(req);
    await syncCardStats(session.userId);
    const metrics = await buildImpactMetrics(session.userId);
    if (!metrics) throw new ApiError("Card not found", 404);
    return json(res, metrics);
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── DONATION POINTS ─────────────────────────────────────────────────────────

// GET /api/charity/points — balance + summary merged.
router.get("/points", async (req, res) => {
  try {
    const session = await requireAuth(req);
    return json(res, await pointsOverview(session.userId));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/charity/points/history — paged transactions, optional ?type=.
router.get("/points/history", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>);
    const type = req.query.type ? String(req.query.type) : null;
    if (type && !POINT_TYPES.includes(type as (typeof POINT_TYPES)[number])) {
      throw new ApiError("Invalid points type", 400);
    }
    const { rows, total } = await pointsHistory(session.userId, { type, skip, limit });
    return json(res, { ...paged(rows.map(serializePoint), page, limit, total), totalCount: total });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/charity/points/expiring — active points expiring within ?days=.
router.get("/points/expiring", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>);
    const rows = await pointsExpiring(session.userId, days, skip, limit);
    const totalExpiring = rows.reduce((s, r) => s + (r.points > 0 ? r.points : 0), 0);
    return json(res, {
      ...paged(rows.map(serializePoint), page, limit, rows.length),
      totalExpiring,
      days,
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/charity/points/redeem — spend points on a redemption type.
router.post("/points/redeem", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const points = Math.trunc(Number(req.body?.points ?? 0));
    if (!(points >= 1)) throw new ApiError("The points must be at least 1.", 400);
    const redemptionType = String(req.body?.redemptionType ?? req.body?.redemption_type ?? "");
    const result = await redeemPoints(session.userId, {
      points,
      redemptionType,
      description: req.body?.description ? String(req.body.description) : null,
    });
    log.info("points_redeemed", { actor: session.userId, points, redemptionType });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── ACHIEVEMENTS ────────────────────────────────────────────────────────────

// GET /api/charity/achievements — catalogue with filters.
router.get("/achievements", async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 50);
    const category = req.query.category ? String(req.query.category) : null;
    const tier = req.query.tier ? String(req.query.tier) : null;
    if (category && !ACHIEVEMENT_CATEGORIES.includes(category as (typeof ACHIEVEMENT_CATEGORIES)[number])) {
      throw new ApiError("Invalid achievement category", 400);
    }
    if (tier && !ACHIEVEMENT_TIERS.includes(tier as (typeof ACHIEVEMENT_TIERS)[number])) {
      throw new ApiError("Invalid achievement tier", 400);
    }

    const where = {
      isActive: true,
      ...(category ? { category } : {}),
      ...(tier ? { tier } : {}),
    };
    const [rows, total] = await Promise.all([
      db.achievement.findMany({ where, orderBy: [{ tier: "asc" }, { pointsRequired: "asc" }], skip, take: limit }),
      db.achievement.count({ where }),
    ]);
    return json(res, paged(rows.map(achievementWire), page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/charity/achievements/mine — catalogue + the user's unlock state.
router.get("/achievements/mine", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 50);
    const status = String(req.query.status ?? "all");
    const list = await myAchievements(session.userId, status);
    const slice = list.slice(skip, skip + limit);
    return json(res, {
      ...paged(slice, page, limit, list.length),
      totalUnlocked: list.filter((a) => a.isUnlocked).length,
      totalClaimed: list.filter((a) => a.isClaimed).length,
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/charity/achievements/summary — counts + recent unlocks.
router.get("/achievements/summary", async (req, res) => {
  try {
    const session = await requireAuth(req);
    return json(res, await achievementsSummary(session.userId));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/charity/achievements/:id/progress
router.get("/achievements/:id/progress", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const id = intParam((req.params as Params).id, "achievement id");
    return json(res, await achievementProgress(session.userId, id));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/charity/achievements/:id/claim
router.post("/achievements/:id/claim", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const id = intParam((req.params as Params).id, "achievement id");
    const result = await claimAchievement(session.userId, id);
    log.info("achievement_claimed", { actor: session.userId, achievementId: id });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── DONATION GOALS ──────────────────────────────────────────────────────────

// GET /api/charity/goals — the user's goals, optional ?status=.
router.get("/goals", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 50);
    const status = String(req.query.status ?? "all").toLowerCase();
    const goals = await listGoals(session.userId, status);
    return json(res, paged(goals.map(goalWire).slice(skip, skip + limit), page, limit, goals.length));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/charity/goals — create a goal.
router.post("/goals", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = req.body ?? {};
    const goal = await createGoal(session.userId, {
      title: String(body.title ?? ""),
      targetAmount: Number(body.targetAmount ?? body.target_amount ?? 0),
      deadline: body.deadline != null ? String(body.deadline) : null,
      endDate: body.endDate != null ? String(body.endDate) : null,
      description: body.description != null ? String(body.description) : null,
      startDate: body.startDate != null ? String(body.startDate) : null,
      frequency: body.frequency != null ? String(body.frequency) : null,
      isPublic: body.isPublic === true || body.isPublic === "true" || body.isPublic === 1,
    });
    log.info("goal_created", {
      goalId: goal.id,
      actor: session.userId,
      targetAmount: Number(body.targetAmount ?? body.target_amount ?? 0),
    });
    return json(res, goal, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/charity/goals/summary — counts (before /:id).
router.get("/goals/summary", async (req, res) => {
  try {
    const session = await requireAuth(req);
    return json(res, await goalsSummary(session.userId));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/charity/goals/:id
router.get("/goals/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const goal = await getGoal(session.userId, (req.params as Params).id);
    return json(res, goalWire(goal));
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/charity/goals/:id
router.patch("/goals/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = req.body ?? {};
    const goal = await updateGoal(session.userId, (req.params as Params).id, {
      title: body.title !== undefined ? String(body.title) : undefined,
      description: body.description !== undefined ? (body.description == null ? null : String(body.description)) : undefined,
      targetAmount: body.targetAmount !== undefined || body.target_amount !== undefined
        ? Number(body.targetAmount ?? body.target_amount)
        : undefined,
      deadline: body.deadline != null ? String(body.deadline) : body.endDate != null ? String(body.endDate) : undefined,
      isPublic: body.isPublic !== undefined
        ? body.isPublic === true || body.isPublic === "true" || body.isPublic === 1
        : undefined,
      status: body.status !== undefined ? String(body.status) : undefined,
    });
    log.info("goal_updated", { goalId: (req.params as Params).id, actor: session.userId });
    return json(res, goal);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/charity/goals/:id
router.delete("/goals/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const goalId = (req.params as Params).id;
    const result = await deleteGoal(session.userId, goalId);
    log.info("goal_deleted", { goalId, actor: session.userId });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/charity/goals/:id/complete
router.post("/goals/:id/complete", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const goalId = (req.params as Params).id;
    const result = await completeGoal(session.userId, goalId);
    log.info("goal_completed", { goalId, actor: session.userId });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// ─── CHARITY EVENTS ──────────────────────────────────────────────────────────

// GET /api/charity/events — list; personalises with the session when present.
router.get("/events", async (req, res) => {
  try {
    const userId = await optionalUserId(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 50);
    const rows = await listEvents(userId, {
      type: req.query.type ? String(req.query.type) : null,
      status: req.query.status ? String(req.query.status) : null,
    });
    return json(res, paged(rows.slice(skip, skip + limit), page, limit, rows.length));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/charity/events/mine — the user's registrations (before /:id).
router.get("/events/mine", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query as Record<string, unknown>, 50);
    const status = String(req.query.status ?? "all").toLowerCase();
    const rows = await myEvents(session.userId, status);
    return json(res, paged(rows.slice(skip, skip + limit), page, limit, rows.length));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/charity/events/check-in — QR check-in (before /:id routes).
router.post("/events/check-in", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = req.body ?? {};
    const eventId = String(body.eventId ?? body.event_id ?? "");
    if (!eventId) throw new ApiError("The event id field is required.", 400);
    const qrCode = body.qrCode != null ? String(body.qrCode) : body.qr_code != null ? String(body.qr_code) : null;
    const result = await checkIn(session.userId, eventId, qrCode);
    log.info("event_checked_in", { eventId, actor: session.userId });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/charity/events/:id — details + participants.
router.get("/events/:id", async (req, res) => {
  try {
    const userId = await optionalUserId(req);
    return json(res, await eventDetails((req.params as Params).id, userId));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/charity/events/:id/register
router.post("/events/:id/register", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const eventId = (req.params as Params).id;
    const notes = req.body?.notes != null ? String(req.body.notes) : null;
    const result = await registerForEvent(session.userId, eventId, notes);
    log.info("event_registered", { eventId, actor: session.userId });
    return json(res, result, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/charity/events/:id/cancel
router.post("/events/:id/cancel", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const eventId = (req.params as Params).id;
    const result = await cancelRegistration(session.userId, eventId);
    log.info("event_cancelled", { eventId, actor: session.userId });
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});
