/**
 * Insight controller — HTTP layer only. Preserves the legacy two-step catch
 * exactly: deliberate AppErrors render through handleError with their own
 * status; any other failure means the AI provider is unavailable — log the
 * ai_unavailable event and fail 503 with the friendly message (no AI
 * interaction is written). Unlike the other handlers this catch must NOT
 * funnel non-AppErrors into handleError's unhandled_route_error path.
 */
import type { Request, RequestHandler, Response } from "express";
import { logger } from "@/infrastructure/logging/logger";
import { handleError } from "@/infrastructure/auth/session";
import { ApiError } from "@/shared/errors";
import { validatedBody } from "@/shared/middleware/validate";
import type { FoodBody } from "../schemas/food.schema";
import type { InsightService } from "../services/insight.service";

const log = logger.child("food");

export class InsightController {
  constructor(private readonly insightService: InsightService) {}

  /** POST /api/food/insights { mode, eventId?, question? } — ADMIN, advisory-only. */
  generate: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = validatedBody<FoodBody>(req);
      const payload = await this.insightService.generate(body, req.session!);
      res.json(payload);
    } catch (error) {
      if (error instanceof ApiError) {
        handleError(error, res);
        return;
      }
      // AI provider unavailable — fail loudly, log nothing sensitive.
      log.warn("ai_unavailable", { error: error instanceof Error ? error.message : String(error) });
      res.status(503).json({ error: "AI assistant is unavailable right now — please try again later" });
    }
  };
}
