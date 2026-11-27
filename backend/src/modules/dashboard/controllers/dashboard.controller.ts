/**
 * Dashboard controller — serves the root /api snapshot with the legacy
 * enveloped contract ({success:true,data} / {success:false,error}).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { fail, ok } from "@/shared/utils/response";
import { logSnapshotFailure } from "../services/dashboard.service";
import type { DashboardService } from "../services/dashboard.service";

export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** GET /api — root dashboard stats. */
  snapshot: RequestHandler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const snapshot = await this.dashboardService.getSnapshot();
      ok(res, snapshot);
    } catch (error) {
      // Preserve the legacy contract: 500 with {success:false,error}, and
      // the wide-event log line emitted from the route layer.
      logSnapshotFailure(error);
      fail(res, "Failed to fetch dashboard stats", 500);
      return;
    }
  };
}
