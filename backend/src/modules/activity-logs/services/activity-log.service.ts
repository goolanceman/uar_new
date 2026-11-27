/**
 * Activity log service — read model for the admin audit trail. The legacy
 * route had no cache calls or log events, so the query passes straight
 * through to the repository.
 */
import type { ActivityLog } from "@prisma/client";
import type { ActivityLogRepository } from "../repositories/activity-log.repository.interface";

export class ActivityLogService {
  constructor(private readonly activityLogRepository: ActivityLogRepository) {}

  /** GET /api/activity-logs?limit=60 — newest first, optional take. */
  list(limit: number): Promise<ActivityLog[]> {
    return this.activityLogRepository.listDesc(limit);
  }
}
