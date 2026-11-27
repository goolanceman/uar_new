/**
 * Campaign analytics controller — HTTP layer only. Delegates to the service
 * and returns the response. Errors flow to the centralized error middleware
 * via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { CampaignAnalyticsService } from "../services/campaign-analytics.service";

export class CampaignAnalyticsController {
  constructor(private readonly campaignAnalyticsService: CampaignAnalyticsService) {}

  /** GET /api/campaign-analytics */
  get: RequestHandler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.campaignAnalyticsService.getAnalytics();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };
}
