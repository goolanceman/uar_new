/**
 * Volunteer tasks routes — /api/volunteer-tasks, /api/volunteer-tasks/:id
 * Thin endpoint definitions; all logic lives in src/modules/volunteer-tasks
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/volunteer-tasks`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  createVolunteerTaskBodySchema,
  listVolunteerTasksQuerySchema,
  updateVolunteerTaskBodySchema,
} from "@/modules/volunteer-tasks/schemas/volunteer-task.schema";
import { volunteerTaskController } from "@/modules/volunteer-tasks";

export const router = Router();

// GET /api/volunteer-tasks — ?mine=1 (auth) → the session volunteer's tasks,
// desc scheduledDate; else (ADMIN) ?status&type&volunteerId&refType&refId&q.
// (Legacy gates were branch-local awaits — kept in the controller.)
router.get("/", validate({ query: listVolunteerTasksQuerySchema }), volunteerTaskController.list);

// POST /api/volunteer-tasks (ADMIN) — manual task creation (createdFrom
// MANUAL). Optional refType/refId link the task to a DISTRIBUTION / CAMPAIGN /
// EVENT / MISSION record. (Legacy gate: `await requireRole(req, "ADMIN")` as
// the handler's first step; field checks run in the service — legacy order.)
router.post(
  "/",
  authorize("ADMIN"),
  validate({ body: createVolunteerTaskBodySchema }),
  volunteerTaskController.create
);

// PATCH /api/volunteer-tasks/:id — ADMIN: any task · VOLUNTEER: only their
// own task. (Legacy gate: `await requireRole(req, "ADMIN", "VOLUNTEER")` as
// the handler's first step.)
router.patch(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: stringIdParamSchema, body: updateVolunteerTaskBodySchema }),
  volunteerTaskController.update
);

// DELETE /api/volunteer-tasks/:id (ADMIN)
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema }),
  volunteerTaskController.remove
);
