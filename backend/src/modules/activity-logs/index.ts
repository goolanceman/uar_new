/**
 * Activity-logs module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/activity-logs.ts
 * (preserved export path for tests and the app entry).
 */
import { PrismaActivityLogRepository } from "./repositories/activity-log.repository";
import { ActivityLogService } from "./services/activity-log.service";
import { ActivityLogController } from "./controllers/activity-log.controller";

const activityLogRepository = new PrismaActivityLogRepository();
const activityLogService = new ActivityLogService(activityLogRepository);

export const activityLogController = new ActivityLogController(activityLogService);
export { ActivityLogService, ActivityLogController, PrismaActivityLogRepository };
