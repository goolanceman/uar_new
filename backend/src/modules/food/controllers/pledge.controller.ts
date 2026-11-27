/**
 * Pledge controller — HTTP layer only. The optional-session probe stays here
 * (request-bound lib call) so it runs AFTER the route-level rate-limit
 * middleware and BEFORE the service body checks — exact legacy order. The
 * mine=1 branch keeps its branch-dependent requireRole gate. Errors render
 * through lib/session handleError directly (the legacy per-route catch).
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError, requireRole, validateSession } from "@/infrastructure/auth/session";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import type { FoodBody } from "../schemas/food.schema";
import type { PledgeService } from "../services/pledge.service";

export class PledgeController {
  constructor(private readonly pledgeService: PledgeService) {}

  /**
   * GET /api/food/pledges           — ADMIN pickups desk
   * GET /api/food/pledges?mine=1    — signed-in donor's own pledges
   */
  list: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;
      if (sp.get("mine") === "1") {
        const session = await requireRole(req, "DONOR", "ADMIN", "VOLUNTEER");
        const rows = await this.pledgeService.listMine(session);
        res.json(rows);
        return;
      }
      await requireRole(req, "ADMIN", "VOLUNTEER");
      const rows = await this.pledgeService.listAdmin(sp);
      res.json(rows);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/food/pledges — PUBLIC food/grocery donation pledge with pickup. */
  create: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await validateSession(req);
      const body = validatedBody<FoodBody>(req);
      const result = await this.pledgeService.create(body, session);
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/food/pledges/:id — the pickups desk workflow. */
  decide: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<FoodBody>(req);
      const result = await this.pledgeService.decide(id, body, req.session!);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  };
}
