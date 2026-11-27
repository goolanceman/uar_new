/**
 * Charity controller — HTTP layer only. Extracts validated data / session
 * with the legacy's exact coercion expressions, delegates to the service,
 * returns the response. Errors flow to the centralized error middleware via
 * next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import { validateSession } from "@/infrastructure/auth/session";
import type {
  AchievementIdParams,
  AchievementsQuery,
  CardVerifyBody,
  EventCheckInBody,
  EventIdParams,
  EventRegisterBody,
  EventsQuery,
  GoalBody,
  GoalIdParams,
  GoalsQuery,
  MyAchievementsQuery,
  MyEventsQuery,
  PointsExpiringQuery,
  PointsHistoryQuery,
  RedeemBody,
} from "../schemas/charity.schema";
import type { CharityService } from "../services/charity.service";

export class CharityController {
  constructor(private readonly charityService: CharityService) {}

  /** Optional session user id — public reads still personalise per-user state. */
  private async optionalUserId(req: Request): Promise<string | null> {
    const s = await validateSession(req);
    return s?.userId ?? null;
  }

  // ─── CHARITY CARD ────────────────────────────────────────────────────────

  /** GET /card — sync stats from COMPLETED donations, then return. */
  card: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.charityService.card(req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /card/tiers — the static tier ladder. */
  cardTiers: RequestHandler = async (_req, res, next) => {
    try {
      res.json(this.charityService.cardTiers());
    } catch (error) {
      next(error);
    }
  };

  /** POST /card/verify — QR scanning (card number → public card info). */
  verifyCard: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CardVerifyBody>(req) ?? {};
      const result = await this.charityService.verifyCard(body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /card/share — share copy for the donor's card. */
  shareCard: RequestHandler = async (req, res, next) => {
    try {
      const result = await this.charityService.shareCard(req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  // ─── IMPACT ──────────────────────────────────────────────────────────────

  /** GET /impact */
  impact: RequestHandler = async (req, res, next) => {
    try {
      const metrics = await this.charityService.impact(req.session!);
      res.json(metrics);
    } catch (error) {
      next(error);
    }
  };

  // ─── DONATION POINTS ─────────────────────────────────────────────────────

  /** GET /points — balance + summary merged. */
  points: RequestHandler = async (req, res, next) => {
    try {
      const payload = await this.charityService.points(req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /points/history — paged transactions, optional ?type=. */
  pointsHistory: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<PointsHistoryQuery>(req);
      const payload = await this.charityService.pointsHistory(
        req.session!,
        query.type ? String(query.type) : null,
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /points/expiring — active points expiring within ?days=. */
  pointsExpiring: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<PointsExpiringQuery>(req);
      const payload = await this.charityService.pointsExpiring(
        req.session!,
        query.days,
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /points/redeem — spend points on a redemption type. */
  redeem: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<RedeemBody>(req) ?? {};
      const result = await this.charityService.redeem(req.session!, body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  // ─── ACHIEVEMENTS ────────────────────────────────────────────────────────

  /** GET /achievements — catalogue with filters. */
  achievements: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<AchievementsQuery>(req);
      const payload = await this.charityService.achievements(
        query.category ? String(query.category) : null,
        query.tier ? String(query.tier) : null,
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /achievements/mine — catalogue + the user's unlock state. */
  myAchievements: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<MyAchievementsQuery>(req);
      const payload = await this.charityService.myAchievements(
        req.session!,
        String(query.status ?? "all"),
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /achievements/summary — counts + recent unlocks. */
  achievementsSummary: RequestHandler = async (req, res, next) => {
    try {
      const payload = await this.charityService.achievementsSummary(req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /achievements/:id/progress */
  achievementProgress: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AchievementIdParams>(req);
      const payload = await this.charityService.achievementProgress(req.session!, id);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /achievements/:id/claim */
  claimAchievement: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AchievementIdParams>(req);
      const result = await this.charityService.claimAchievement(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  // ─── DONATION GOALS ──────────────────────────────────────────────────────

  /** GET /goals — the user's goals, optional ?status=. */
  listGoals: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<GoalsQuery>(req);
      const payload = await this.charityService.listGoals(
        req.session!,
        String(query.status ?? "all").toLowerCase(),
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /goals — create a goal. */
  createGoal: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<GoalBody>(req) ?? {};
      const goal = await this.charityService.createGoal(req.session!, body);
      res.status(201).json(goal);
    } catch (error) {
      next(error);
    }
  };

  /** GET /goals/summary — counts (before /:id). */
  goalsSummary: RequestHandler = async (req, res, next) => {
    try {
      const payload = await this.charityService.goalsSummary(req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /goals/:id */
  getGoal: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<GoalIdParams>(req);
      const goal = await this.charityService.getGoal(req.session!, id);
      res.json(goal);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /goals/:id */
  updateGoal: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<GoalIdParams>(req);
      const body = validatedBody<GoalBody>(req) ?? {};
      const goal = await this.charityService.updateGoal(req.session!, id, body);
      res.json(goal);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /goals/:id */
  deleteGoal: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<GoalIdParams>(req);
      const result = await this.charityService.deleteGoal(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /goals/:id/complete */
  completeGoal: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<GoalIdParams>(req);
      const result = await this.charityService.completeGoal(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  // ─── CHARITY EVENTS ──────────────────────────────────────────────────────

  /** GET /events — list; personalises with the session when present. */
  listEvents: RequestHandler = async (req, res, next) => {
    try {
      const userId = await this.optionalUserId(req);
      const query = validatedQuery<EventsQuery>(req);
      const payload = await this.charityService.listEvents(
        userId,
        {
          type: query.type ? String(query.type) : null,
          status: query.status ? String(query.status) : null,
        },
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /events/mine — the user's registrations (before /:id). */
  myEvents: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<MyEventsQuery>(req);
      const payload = await this.charityService.myEvents(
        req.session!,
        String(query.status ?? "all").toLowerCase(),
        query.page,
        query.limit
      );
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /events/check-in — QR check-in (before /:id routes). */
  checkIn: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<EventCheckInBody>(req) ?? {};
      const result = await this.charityService.checkIn(req.session!, body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /events/:id — details + participants. */
  eventDetails: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<EventIdParams>(req);
      const userId = await this.optionalUserId(req);
      const payload = await this.charityService.eventDetails(id, userId);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /events/:id/register */
  register: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<EventIdParams>(req);
      const body = validatedBody<EventRegisterBody>(req) ?? {};
      const result = await this.charityService.register(req.session!, id, body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /events/:id/cancel */
  cancel: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<EventIdParams>(req);
      const result = await this.charityService.cancel(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
