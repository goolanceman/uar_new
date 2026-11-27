/**
 * Registration controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors render
 * through lib/session handleError directly (the legacy per-route catch).
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError } from "@/infrastructure/auth/session";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import type { FoodBody } from "../schemas/food.schema";
import type { RegistrationService } from "../services/registration.service";

export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  /** POST /api/food/events/:id/registrations — admin bulk/desk + self-service. */
  createForEvent: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<FoodBody>(req);
      const result = await this.registrationService.createForEvent(id, body, req.session!);
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/food/events/:id/walkin — emergency walk-in registration. */
  walkin: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<FoodBody>(req);
      const result = await this.registrationService.walkin(id, body, req.session!);
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/food/registrations?eventId&status&q — admin queue lookup. */
  list: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;
      const rows = await this.registrationService.list(sp);
      res.json(rows);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/food/events/:id/registrations — event registration list. */
  listForEvent: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const sp = new URL(req.url, "http://localhost").searchParams;
      const rows = await this.registrationService.listForEvent(id, sp);
      res.json(rows);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/food/registrations/:id — ADMIN lifecycle update. */
  update: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<FoodBody>(req);
      const row = await this.registrationService.update(id, body, req.session!);
      res.json(row);
    } catch (error) {
      handleError(error, res);
    }
  };
}
