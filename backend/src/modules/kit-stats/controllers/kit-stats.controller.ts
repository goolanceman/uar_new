/**
 * Kit stats controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { KitStatsService } from "../services/kit-stats.service";

export class KitStatsController {
  constructor(private readonly kitStatsService: KitStatsService) {}

  /** GET /api/kit-stats (auth). */
  snapshot: RequestHandler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.kitStatsService.snapshot();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };
}
