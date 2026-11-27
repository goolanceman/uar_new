/**
 * Household controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors render through
 * lib/session handleError directly (the legacy per-route catch).
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError } from "@/lib/session";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import type { FoodBody } from "../schemas/food.schema";
import type { HouseholdService } from "../services/household.service";

export class HouseholdController {
  constructor(private readonly householdService: HouseholdService) {}

  /** GET /api/food/households?q — ADMIN household registry. */
  list: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;
      const rows = await this.householdService.list(sp);
      res.json(rows);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/food/households — ADMIN create household + members. */
  create: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = validatedBody<FoodBody>(req);
      const row = await this.householdService.create(body, req.session!);
      res.status(201).json(row);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/food/households/:id — ADMIN edit / add / remove members. */
  update: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<FoodBody>(req);
      const row = await this.householdService.update(id, body, req.session!);
      res.json(row);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** DELETE /api/food/households/:id — ADMIN (only when no registrations exist). */
  remove: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.householdService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  };
}
