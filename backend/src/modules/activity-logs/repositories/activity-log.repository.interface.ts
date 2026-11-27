/**
 * Activity log repository contract — the admin audit trail read.
 */
import type { ActivityLog } from "@prisma/client";

export interface ActivityLogRepository {
  /** Newest first; `limit > 0` bounds the take, otherwise unlimited (legacy:
   * `...(limit > 0 ? { take: limit } : {})`, so NaN/0/negatives meant "all"). */
  listDesc(limit: number): Promise<ActivityLog[]>;
}
