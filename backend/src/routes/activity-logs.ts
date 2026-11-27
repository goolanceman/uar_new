/**
 * Activity log routes — /api/activity-logs
 * Thin endpoint definitions; all logic lives in src/modules/activity-logs
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/activity-logs`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { listActivityLogsQuerySchema } from "@/modules/activity-logs/schemas/activity-log.schema";
import { activityLogController } from "@/modules/activity-logs";

export const router = Router();

// GET /api/activity-logs?limit=60 — admin audit trail (legacy gate:
// `await requireRole(req, "ADMIN")` as the handler's first step).
router.get(
  "/",
  authorize("ADMIN"),
  validate({ query: listActivityLogsQuerySchema }),
  activityLogController.list
);
