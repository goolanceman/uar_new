/**
 * Prisma implementation of the activity log repository — the ONLY place in
 * the activity-logs module that touches Prisma models directly. (Read-only
 * list: no unique/FK violation risk, so no mapPrismaError wrap.)
 */
import { db } from "@/infrastructure/database/prisma";
import type { ActivityLog } from "@prisma/client";
import type { ActivityLogRepository } from "./activity-log.repository.interface";

export class PrismaActivityLogRepository implements ActivityLogRepository {
  async listDesc(limit: number): Promise<ActivityLog[]> {
    return db.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      // Legacy: `...(limit > 0 ? { take: limit } : {})` — NaN/0/negative → unlimited.
      ...(limit > 0 ? { take: limit } : {}),
    });
  }
}
