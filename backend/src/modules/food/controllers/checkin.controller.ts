/**
 * Check-in controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors render through
 * lib/session handleError directly (the legacy per-route catch).
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError } from "@/infrastructure/auth/session";
import { validatedBody } from "@/shared/middleware/validate";
import type { FoodBody } from "../schemas/food.schema";
import type { CheckinService } from "../services/checkin.service";

export class CheckinController {
  constructor(private readonly checkinService: CheckinService) {}

  /** POST /api/food/checkin — lookup / checkout at the distribution desk. */
  handle: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = validatedBody<FoodBody>(req);
      const payload = await this.checkinService.handle(body, req.session!);
      res.json(payload);
    } catch (error) {
      handleError(error, res);
    }
  };
}
