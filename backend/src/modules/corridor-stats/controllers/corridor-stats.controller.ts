/**
 * Corridor-stats controller — HTTP layer only. Delegates to the service and
 * returns the response. Errors flow to the centralized error middleware via
 * next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { CorridorStatsService } from "../services/corridor-stats.service";

export class CorridorStatsController {
  constructor(private readonly corridorStatsService: CorridorStatsService) {}

  /** GET /api/corridor-stats (auth) — legacy gate: `await requireAuth(req)`
   *  as the handler's first step (now the authenticate middleware). */
  snapshot: RequestHandler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.corridorStatsService.stats();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };
}
