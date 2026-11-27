/**
 * Animal analytics controller — HTTP layer only. Delegates to the service
 * and returns the response. Errors flow to the centralized error middleware
 * via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AnimalAnalyticsService } from "../services/animal-analytics.service";

export class AnimalAnalyticsController {
  constructor(private readonly animalAnalyticsService: AnimalAnalyticsService) {}

  /** GET /api/animal-analytics */
  get: RequestHandler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.animalAnalyticsService.getAnalytics();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };
}
