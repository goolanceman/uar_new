/**
 * Stats controller — HTTP layer only. Extracts validated data, delegates to
 * the service, returns the response. Errors flow to the centralized error
 * middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedQuery } from "@/shared/middleware/validate";
import type { StatsService } from "../services/stats.service";
import type { StatsQuery } from "../schemas/stats.schema";

export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  /** GET /api/stats — public aggregate snapshot (?from=&to= → range-scoped). */
  get: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<StatsQuery>(req);
      const payload = await this.statsService.getSnapshot(query.from, query.to);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };
}
