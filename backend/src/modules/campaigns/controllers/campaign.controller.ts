/**
 * Campaign controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { handleError } from "@/infrastructure/auth/session";
import { validateSession } from "@/infrastructure/auth/session";
import { validatedQuery } from "@/shared/middleware/validate";
import type { CampaignService } from "../services/campaign.service";
import type { ListCampaignsQuery } from "../schemas/campaign.schema";

export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  /** GET /api/campaigns — public list. validateSession is the legacy FIRST
   *  step but is NOT a gate: it only personalizes (admin "all"), so it stays
   *  an inline lib call. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListCampaignsQuery>(req);
      const session = await validateSession(req);
      const payload = await this.campaignService.list(query, session);
      res.json(payload);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };

  /** POST /api/campaigns — body checked in the service (exact legacy
   *  messages and check order, unique-slug lookup interleaved). */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const campaign = await this.campaignService.create(rawBody, req.session!);
      res.status(201).json(campaign);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };

  /** GET /api/campaigns/:id — by id, falling back to slug. */
  detail: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const campaign = await this.campaignService.detail(id);
      res.json(campaign);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };

  /** PATCH /api/campaigns/:id/urgency — body checked in the service (the
   *  missing-urgent-flag 400 fires only after the 404 lookup, as legacy). */
  updateUrgency: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const campaign = await this.campaignService.updateUrgency(id, rawBody, req.session!);
      res.json(campaign);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };

  /** PATCH /api/campaigns/:id — body checked in the service (exact legacy order). */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const campaign = await this.campaignService.update(id, rawBody, req.session!);
      res.json(campaign);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };

  /** DELETE /api/campaigns/:id. */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await this.campaignService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      // Render via the legacy per-route handler — bare test harnesses mount
      // no app-level error middleware and assert {error} JSON bodies.
      handleError(error, res);
    }
  };
}
