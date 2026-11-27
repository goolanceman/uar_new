/**
 * Event controller — HTTP layer only. The listing branches are kept here
 * because their auth gates are branch-dependent in the legacy handler:
 * ?public=1 runs unauthenticated, ?mine=1 and the admin list gate with
 * requireRole AFTER the branch decision. Errors render through lib/session
 * handleError directly (the legacy per-route catch).
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError, requireRole } from "@/infrastructure/auth/session";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import type { FoodBody } from "../schemas/food.schema";
import type { EventService } from "../services/event.service";

export class EventController {
  constructor(private readonly eventService: EventService) {}

  /**
   * GET /api/food/events            — ADMIN list w/ filters
   * GET /api/food/events?public=1   — public list (safe fields only)
   * GET /api/food/events?mine=1     — BENEFICIARY: own registrations
   */
  list: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;

      if (sp.get("public") === "1") {
        const rows = await this.eventService.listPublic();
        res.json(rows);
        return;
      }

      const session = await requireRole(req, "ADMIN", "VOLUNTEER", "BENEFICIARY");

      if (sp.get("mine") === "1") {
        const regs = await this.eventService.listMine(session);
        res.json(regs);
        return;
      }

      const rows = await this.eventService.listAdmin(sp);
      res.json(rows);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/food/events — ADMIN create. */
  create: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = validatedBody<FoodBody>(req);
      const row = await this.eventService.create(body, req.session!);
      res.status(201).json(row);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/food/events/:id — ADMIN operations-brain detail. */
  detail: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const payload = await this.eventService.detail(id);
      res.json(payload);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/food/events/:id — ADMIN lifecycle transitions + field edits. */
  update: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<FoodBody>(req);
      const row = await this.eventService.update(id, body, req.session!);
      res.json(row);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/food/events/:id/expenses — ADMIN/VOLUNTEER. */
  listExpenses: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const rows = await this.eventService.listExpenses(id);
      res.json(rows);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/food/events/:id/expenses — ADMIN record programme spend. */
  createExpense: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<FoodBody>(req);
      const row = await this.eventService.createExpense(id, body, req.session!);
      res.status(201).json(row);
    } catch (error) {
      handleError(error, res);
    }
  };
}
