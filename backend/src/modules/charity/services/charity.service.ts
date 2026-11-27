/**
 * Charity service — card, impact, points, achievements, goals and events.
 * Depends on the repository contract (shared @/lib/charity/* domain modules
 * + the four legacy in-route Prisma reads), throws application errors,
 * never touches HTTP.
 *
 * Body coercion/validation reproduces the legacy handlers exactly — same
 * silent defaults, same check order, same bare error messages — and every
 * log event keeps its legacy name.
 */
import { logger } from "@/lib/logger";
import { paged } from "@/lib/community/serializers";
import { ApiError } from "@/shared/errors";
import type { Session } from "@/lib/session";
import {
  CHARITY_TIERS,
  serializeCard,
} from "@/lib/charity/card";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_TIERS,
  achievementWire,
} from "@/lib/charity/achievements";
import { POINT_TYPES, serializePoint } from "@/lib/charity/points";
import { goalWire } from "@/lib/charity/goals";
import type { CharityRepository } from "../repositories/charity.repository.interface";

const log = logger.child("charity");

/** Legacy intParam — positive-integer ids from `:id` segments. */
function intParam(raw: string | undefined, label: string): number {
  const id = Math.trunc(Number(raw));
  if (!Number.isFinite(id) || id <= 0) throw new ApiError(`Invalid ${label}`, 400);
  return id;
}

export class CharityService {
  constructor(private readonly charityRepository: CharityRepository) {}

  // ─── CHARITY CARD ────────────────────────────────────────────────────────

  /** GET /card — sync stats from COMPLETED donations, then return. */
  async card(session: Session) {
    await this.charityRepository.syncCardStats(session.userId);
    const card = await this.charityRepository.findCardByUserId(session.userId);
    if (!card) throw new ApiError("Failed to retrieve charity card", 500);
    const user = await this.charityRepository.findUserById(session.userId);
    return serializeCard(card, user);
  }

  /** GET /card/tiers — the static tier ladder. */
  cardTiers() {
    return { items: CHARITY_TIERS };
  }

  /** POST /card/verify — QR scanning (card number → public card info). */
  async verifyCard(body: Record<string, unknown>) {
    const cardNumber = String(body?.cardNumber ?? "").trim();
    if (!cardNumber) throw new ApiError("The card number field is required.", 400);
    if (cardNumber.length !== 20) throw new ApiError("The card number must be 20 characters.", 400);

    const card = await this.charityRepository.findCardByNumberWithUser(cardNumber);
    if (!card) {
      log.warn("card_verify_not_found", { cardNumber });
      throw new ApiError("Invalid card number", 404);
    }

    if (card.validUntil && card.validUntil.getTime() < Date.now()) {
      log.debug("card_verify_expired", { cardNumber });
      return {
        cardNumber: card.cardNumber,
        validUntil: card.validUntil.toISOString().slice(0, 10),
        isValid: false,
        isExpired: true,
      };
    }

    return {
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
    };
  }

  /** POST /card/share — share copy for the donor's card. */
  async shareCard(session: Session) {
    const card = await this.charityRepository.findCardByUserId(session.userId);
    if (!card) {
      log.warn("card_share_not_found", { actor: session.userId });
      throw new ApiError("Card not found", 404);
    }

    const level = card.membershipLevel.charAt(0).toUpperCase() + card.membershipLevel.slice(1);
    const donated = `₹${card.totalDonated.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
    return {
      message: "Check out my charity impact!",
      cardNumber: card.cardNumber,
      membershipLevel: level,
      totalDonated: donated,
      impactScore: card.impactScore,
      shareUrl: `/api/charity/card/verify?cardNumber=${card.cardNumber}`,
      socialText: `I've donated ${donated} and achieved ${level} tier status! Join me in making an impact. 🌟`,
    };
  }

  // ─── IMPACT (merged card stats + impact metrics) ─────────────────────────

  /** GET /impact */
  async impact(session: Session) {
    await this.charityRepository.syncCardStats(session.userId);
    const metrics = await this.charityRepository.buildImpactMetrics(session.userId);
    if (!metrics) throw new ApiError("Card not found", 404);
    return metrics;
  }

  // ─── DONATION POINTS ─────────────────────────────────────────────────────

  /** GET /points — balance + summary merged. */
  async points(session: Session) {
    return this.charityRepository.pointsOverview(session.userId);
  }

  /** GET /points/history — paged transactions, optional ?type=. */
  async pointsHistory(session: Session, type: string | null, page: number, limit: number) {
    if (type && !POINT_TYPES.includes(type as (typeof POINT_TYPES)[number])) {
      throw new ApiError("Invalid points type", 400);
    }
    const skip = (page - 1) * limit;
    const { rows, total } = await this.charityRepository.pointsHistory(session.userId, {
      type,
      skip,
      limit,
    });
    return { ...paged(rows.map(serializePoint), page, limit, total), totalCount: total };
  }

  /** GET /points/expiring — active points expiring within ?days=. */
  async pointsExpiring(session: Session, days: number, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const rows = await this.charityRepository.pointsExpiring(session.userId, days, skip, limit);
    const totalExpiring = rows.reduce((s, r) => s + (r.points > 0 ? r.points : 0), 0);
    return {
      ...paged(rows.map(serializePoint), page, limit, rows.length),
      totalExpiring,
      days,
    };
  }

  /** POST /points/redeem — spend points on a redemption type. */
  async redeem(session: Session, body: Record<string, unknown>) {
    const points = Math.trunc(Number(body?.points ?? 0));
    if (!(points >= 1)) throw new ApiError("The points must be at least 1.", 400);
    const redemptionType = String(body?.redemptionType ?? body?.redemption_type ?? "");
    const result = await this.charityRepository.redeemPoints(session.userId, {
      points,
      redemptionType,
      description: body?.description ? String(body.description) : null,
    });
    log.info("points_redeemed", { actor: session.userId, points, redemptionType });
    return result;
  }

  // ─── ACHIEVEMENTS ────────────────────────────────────────────────────────

  /** GET /achievements — catalogue with filters. */
  async achievements(category: string | null, tier: string | null, page: number, limit: number) {
    if (category && !ACHIEVEMENT_CATEGORIES.includes(category as (typeof ACHIEVEMENT_CATEGORIES)[number])) {
      throw new ApiError("Invalid achievement category", 400);
    }
    if (tier && !ACHIEVEMENT_TIERS.includes(tier as (typeof ACHIEVEMENT_TIERS)[number])) {
      throw new ApiError("Invalid achievement tier", 400);
    }

    const skip = (page - 1) * limit;
    const { rows, total } = await this.charityRepository.listAchievements(
      { ...(category ? { category } : {}), ...(tier ? { tier } : {}) },
      skip,
      limit
    );
    return paged(rows.map(achievementWire), page, limit, total);
  }

  /** GET /achievements/mine — catalogue + the user's unlock state. */
  async myAchievements(session: Session, status: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const list = await this.charityRepository.myAchievements(session.userId, status);
    const slice = list.slice(skip, skip + limit);
    return {
      ...paged(slice, page, limit, list.length),
      totalUnlocked: list.filter((a) => a.isUnlocked).length,
      totalClaimed: list.filter((a) => a.isClaimed).length,
    };
  }

  /** GET /achievements/summary — counts + recent unlocks. */
  async achievementsSummary(session: Session) {
    return this.charityRepository.achievementsSummary(session.userId);
  }

  /** GET /achievements/:id/progress */
  async achievementProgress(session: Session, idRaw: string) {
    const id = intParam(idRaw, "achievement id");
    return this.charityRepository.achievementProgress(session.userId, id);
  }

  /** POST /achievements/:id/claim */
  async claimAchievement(session: Session, idRaw: string) {
    const id = intParam(idRaw, "achievement id");
    const result = await this.charityRepository.claimAchievement(session.userId, id);
    log.info("achievement_claimed", { actor: session.userId, achievementId: id });
    return result;
  }

  // ─── DONATION GOALS ──────────────────────────────────────────────────────

  /** GET /goals — the user's goals, optional ?status=. */
  async listGoals(session: Session, status: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const goals = await this.charityRepository.listGoals(session.userId, status);
    return paged(
      goals.map(goalWire).slice(skip, skip + limit),
      page,
      limit,
      goals.length
    );
  }

  /** POST /goals — create a goal. */
  async createGoal(session: Session, body: Record<string, unknown>) {
    const goal = await this.charityRepository.createGoal(session.userId, {
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
    return goal;
  }

  /** GET /goals/summary — counts (before /:id). */
  async goalsSummary(session: Session) {
    return this.charityRepository.goalsSummary(session.userId);
  }

  /** GET /goals/:id */
  async getGoal(session: Session, goalId: string) {
    const goal = await this.charityRepository.getGoal(session.userId, goalId);
    return goalWire(goal);
  }

  /** PATCH /goals/:id */
  async updateGoal(session: Session, goalId: string, body: Record<string, unknown>) {
    const goal = await this.charityRepository.updateGoal(session.userId, goalId, {
      title: body.title !== undefined ? String(body.title) : undefined,
      description:
        body.description !== undefined
          ? body.description == null
            ? null
            : String(body.description)
          : undefined,
      targetAmount:
        body.targetAmount !== undefined || body.target_amount !== undefined
          ? Number(body.targetAmount ?? body.target_amount)
          : undefined,
      deadline:
        body.deadline != null ? String(body.deadline) : body.endDate != null ? String(body.endDate) : undefined,
      isPublic:
        body.isPublic !== undefined
          ? body.isPublic === true || body.isPublic === "true" || body.isPublic === 1
          : undefined,
      status: body.status !== undefined ? String(body.status) : undefined,
    });
    log.info("goal_updated", { goalId, actor: session.userId });
    return goal;
  }

  /** DELETE /goals/:id */
  async deleteGoal(session: Session, goalId: string) {
    const result = await this.charityRepository.deleteGoal(session.userId, goalId);
    log.info("goal_deleted", { goalId, actor: session.userId });
    return result;
  }

  /** POST /goals/:id/complete */
  async completeGoal(session: Session, goalId: string) {
    const result = await this.charityRepository.completeGoal(session.userId, goalId);
    log.info("goal_completed", { goalId, actor: session.userId });
    return result;
  }

  // ─── CHARITY EVENTS ──────────────────────────────────────────────────────

  /** GET /events — list; personalises with the session when present. */
  async listEvents(
    userId: string | null,
    filters: { type: string | null; status: string | null },
    page: number,
    limit: number
  ) {
    const skip = (page - 1) * limit;
    const rows = await this.charityRepository.listEvents(userId, filters);
    return paged(rows.slice(skip, skip + limit), page, limit, rows.length);
  }

  /** GET /events/mine — the user's registrations (before /:id). */
  async myEvents(session: Session, status: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const rows = await this.charityRepository.myEvents(session.userId, status);
    return paged(rows.slice(skip, skip + limit), page, limit, rows.length);
  }

  /** POST /events/check-in — QR check-in (before /:id routes). */
  async checkIn(session: Session, body: Record<string, unknown>) {
    const eventId = String(body.eventId ?? body.event_id ?? "");
    if (!eventId) throw new ApiError("The event id field is required.", 400);
    const qrCode =
      body.qrCode != null ? String(body.qrCode) : body.qr_code != null ? String(body.qr_code) : null;
    const result = await this.charityRepository.checkIn(session.userId, eventId, qrCode);
    log.info("event_checked_in", { eventId, actor: session.userId });
    return result;
  }

  /** GET /events/:id — details + participants. */
  async eventDetails(eventId: string, userId: string | null) {
    return this.charityRepository.eventDetails(eventId, userId);
  }

  /** POST /events/:id/register */
  async register(session: Session, eventId: string, body: Record<string, unknown>) {
    const notes = body?.notes != null ? String(body.notes) : null;
    const result = await this.charityRepository.registerForEvent(session.userId, eventId, notes);
    log.info("event_registered", { eventId, actor: session.userId });
    return result;
  }

  /** POST /events/:id/cancel */
  async cancel(session: Session, eventId: string) {
    const result = await this.charityRepository.cancelRegistration(session.userId, eventId);
    log.info("event_cancelled", { eventId, actor: session.userId });
    return result;
  }
}
