/**
 * Cause analytics controller — HTTP layer only. Delegates to the service and
 * returns the response. Errors flow to the centralized error middleware via
 * next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { CauseAnalyticsService } from "../services/cause-analytics.service";

export class CauseAnalyticsController {
  constructor(private readonly causeAnalyticsService: CauseAnalyticsService) {}

  /** GET /api/cause-analytics */
  get: RequestHandler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.causeAnalyticsService.getAnalytics();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };
}
