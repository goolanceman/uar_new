/**
 * Public-stats controller — HTTP layer only. Delegates to the service and
 * returns the response. Errors render through lib/session handleError
 * directly (the legacy per-route catch).
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError } from "@/lib/session";
import type { PublicStatsService } from "../services/public-stats.service";

export class PublicStatsController {
  constructor(private readonly publicStatsService: PublicStatsService) {}

  /** GET /api/food/public — public, privacy-safe food security aggregate. */
  stats: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload = await this.publicStatsService.stats();
      res.json(payload);
    } catch (error) {
      handleError(error, res);
    }
  };
}
