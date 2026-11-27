/**
 * Kit scan controller — HTTP layer only. Extracts the session, delegates to
 * the service, returns the response. Errors flow to the centralized error
 * middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { KitScanService } from "../services/kit-scan.service";

export class KitScanController {
  constructor(private readonly kitScanService: KitScanService) {}

  /** POST /api/kit-scan — body checked in the service (exact legacy messages). */
  scan: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawBody = (req.body ?? null) as Record<string, unknown> | null;
      const result = await this.kitScanService.scan(req.session!, rawBody);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };
}
