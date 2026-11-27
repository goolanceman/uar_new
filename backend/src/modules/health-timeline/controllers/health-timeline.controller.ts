/**
 * Health-timeline controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to
 * the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedQuery } from "@/shared/middleware/validate";
import type { HealthTimelineQuery } from "../schemas/health-timeline.schema";
import type { HealthTimelineService } from "../services/health-timeline.service";

export class HealthTimelineController {
  constructor(private readonly healthTimelineService: HealthTimelineService) {}

  /** GET /api/health-timeline?beneficiaryId= — ADMIN | DOCTOR | NURSE; a
   *  BENEFICIARY sees its own chronology. The route's authorize() middleware
   *  applies the same gate as the legacy requireAuth + inline role check. */
  timeline: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { beneficiaryId } = validatedQuery<HealthTimelineQuery>(req);
      const payload = await this.healthTimelineService.timeline(req.session!, beneficiaryId);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };
}
