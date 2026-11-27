/**
 * Programme controller — HTTP layer only. The listing branches are kept here
 * because the public branch runs unauthenticated and the admin gate happens
 * after the branch decision in the legacy handler. Errors render through
 * lib/session handleError directly (the legacy per-route catch).
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError, requireRole } from "@/infrastructure/auth/session";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import type { FoodBody } from "../schemas/food.schema";
import type { ProgrammeService } from "../services/programme.service";

export class ProgrammeController {
  constructor(private readonly programmeService: ProgrammeService) {}

  /**
   * GET /api/food/programmes            — admin list (all statuses)
   * GET /api/food/programmes?public=1   — public list (safe fields)
   */
  list: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;
      if (sp.get("public") === "1") {
        const rows = await this.programmeService.listPublic();
        res.json(rows);
        return;
      }
      await requireRole(req, "ADMIN");
      const rows = await this.programmeService.listAdmin(sp);
      res.json(rows);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/food/programmes — ADMIN create. */
  create: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = validatedBody<FoodBody>(req);
      const row = await this.programmeService.create(body, req.session!);
      res.status(201).json(row);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/food/programmes/:id — ADMIN detail with event rollups. */
  detail: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const row = await this.programmeService.detail(id);
      res.json(row);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/food/programmes/:id — ADMIN edit / lifecycle. */
  update: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<FoodBody>(req);
      const row = await this.programmeService.update(id, body, req.session!);
      res.json(row);
    } catch (error) {
      handleError(error, res);
    }
  };
}
