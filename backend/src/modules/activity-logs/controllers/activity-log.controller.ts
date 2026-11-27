/**
 * Activity log controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to
 * the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedQuery } from "@/shared/middleware/validate";
import type { ListActivityLogsQuery } from "../schemas/activity-log.schema";
import type { ActivityLogService } from "../services/activity-log.service";

export class ActivityLogController {
  constructor(private readonly activityLogService: ActivityLogService) {}

  /** GET /api/activity-logs?limit=60 — admin audit trail. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { limit } = validatedQuery<ListActivityLogsQuery>(req);
      const logs = await this.activityLogService.list(limit);
      res.json(logs);
    } catch (error) {
      next(error);
    }
  };
}
