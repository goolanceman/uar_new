/**
 * Volunteer task controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { requireAuth, requireRole } from "@/infrastructure/auth/session";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateVolunteerTaskBody,
  ListVolunteerTasksQuery,
  UpdateVolunteerTaskBody,
} from "../schemas/volunteer-task.schema";
import type { VolunteerTaskService } from "../services/volunteer-task.service";

export class VolunteerTaskController {
  constructor(private readonly volunteerTaskService: VolunteerTaskService) {}

  /**
   * GET /api/volunteer-tasks — ?mine=1 (auth) → the session volunteer's
   * tasks; else (ADMIN) the filtered roster. (Legacy gates were branch-local
   * `await requireAuth(req)` / `await requireRole(req, "ADMIN")` calls —
   * kept in the controller to preserve the exact ordering.)
   */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListVolunteerTasksQuery>(req);
      if (query.mine) {
        const session = await requireAuth(req);
        const tasks = await this.volunteerTaskService.listMine(session.userId);
        res.json(tasks);
        return;
      }
      await requireRole(req, "ADMIN");
      const rows = await this.volunteerTaskService.list(query);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/volunteer-tasks (ADMIN) — manual task creation. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateVolunteerTaskBody>(req);
      const task = await this.volunteerTaskService.create(body, req.session!);
      res.status(201).json(task);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/volunteer-tasks/:id — ADMIN: any task · VOLUNTEER: own only. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateVolunteerTaskBody>(req);
      const updated = await this.volunteerTaskService.update(id, body, req.session!);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/volunteer-tasks/:id (ADMIN). */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.volunteerTaskService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
