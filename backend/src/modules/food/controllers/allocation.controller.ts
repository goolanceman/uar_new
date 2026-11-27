/**
 * Allocation controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors render through
 * lib/session handleError directly (the legacy per-route catch — test
 * harnesses mount routers without an app-level error middleware).
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError } from "@/infrastructure/auth/session";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import type { FoodBody } from "../schemas/food.schema";
import type { AllocationService } from "../services/allocation.service";

export class AllocationController {
  constructor(private readonly allocationService: AllocationService) {}

  /** POST /api/food/allocations — ADMIN reserves stock for an event. */
  reserve: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = validatedBody<FoodBody>(req);
      const result = await this.allocationService.reserve(body, req.session!);
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/food/allocations/:id — ADMIN { action: "issue" | "cancel" }. */
  decide: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<FoodBody>(req);
      const result = await this.allocationService.decide(id, body, req.session!);
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  };
}
