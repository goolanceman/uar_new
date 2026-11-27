/**
 * Event volunteer controller — HTTP layer only. The list branches keep their
 * branch-dependent requireRole gates here (available=1 → ADMIN; default →
 * ADMIN/VOLUNTEER) in legacy order. Errors render through lib/session
 * handleError directly (the legacy per-route catch).
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError, requireRole } from "@/infrastructure/auth/session";
import { ApiError } from "@/shared/errors";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import type { FoodBody } from "../schemas/food.schema";
import type { EventVolunteerService } from "../services/event-volunteer.service";

export class EventVolunteerController {
  constructor(private readonly eventVolunteerService: EventVolunteerService) {}

  /**
   * GET /api/food/events/:id/volunteers              (ADMIN | VOLUNTEER)
   * GET /api/food/events/:id/volunteers?available=1  (ADMIN)
   */
  list: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const sp = new URL(req.url, "http://localhost").searchParams;

      if (sp.get("available") === "1") {
        await requireRole(req, "ADMIN");
        const rows = await this.eventVolunteerService.listAvailable(id);
        res.json(rows);
        return;
      }

      await requireRole(req, "ADMIN", "VOLUNTEER");
      const tasks = await this.eventVolunteerService.listForEvent(id);
      res.json(tasks);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/food/events/:id/volunteers — { volunteerId, role, notes? }. */
  assign: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<FoodBody>(req);
      const task = await this.eventVolunteerService.assign(id, body, req.session!);
      res.status(201).json(task);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** DELETE /api/food/events/:id/volunteers?taskId= — soft-cancel assignment. */
  unassign: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const taskId = new URL(req.url, "http://localhost").searchParams.get("taskId");
      if (!taskId) throw new ApiError("taskId query parameter is required", 400);
      const result = await this.eventVolunteerService.unassign(id, taskId, req.session!);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  };
}
