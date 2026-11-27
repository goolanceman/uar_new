/**
 * Application controller — HTTP layer only. The optional-session probe stays
 * here (request-bound lib call) so it runs AFTER the route-level rate-limit
 * middleware and BEFORE the service body checks — exact legacy order. Errors
 * render through lib/session handleError directly (the legacy per-route
 * catch).
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError, validateSession } from "@/lib/session";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import type { FoodBody } from "../schemas/food.schema";
import type { ApplicationService } from "../services/application.service";

export class ApplicationController {
  constructor(private readonly applicationService: ApplicationService) {}

  /** GET /api/food/applications — ADMIN review queue. */
  list: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;
      const rows = await this.applicationService.list(sp);
      res.json(rows);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/food/applications — PUBLIC application (rate-limited). */
  submit: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await validateSession(req);
      const body = validatedBody<FoodBody>(req);
      const result = await this.applicationService.submit(body, session);
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/food/applications/status — PUBLIC status check (rate-limited). */
  statusCheck: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;
      const result = await this.applicationService.statusCheck(sp);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/food/applications/:id — ADMIN review workflow. */
  review: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<FoodBody>(req);
      const result = await this.applicationService.review(id, body, req.session!);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  };
}
