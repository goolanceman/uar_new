/**
 * Volunteer attendances route — /api/volunteer-attendances
 * Thin endpoint definitions; all logic lives in
 * src/modules/volunteer-attendances (routes → controllers → services →
 * repositories). The historical export path (`@/routes/volunteer-attendances`)
 * is preserved: tests and the app entry import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createAttendanceBodySchema,
  listAttendancesQuerySchema,
} from "@/modules/volunteer-attendances/schemas/volunteer-attendance.schema";
import { volunteerAttendanceController } from "@/modules/volunteer-attendances";

export const router = Router();

// GET /api/volunteer-attendances?volunteerId=&from=&to=&limit=
// (legacy gate: `await requireRole(req, "ADMIN", "VOLUNTEER")` as the
// handler's first step; volunteers are scoped to their own register).
router.get(
  "/",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ query: listAttendancesQuerySchema }),
  volunteerAttendanceController.list
);

// POST /api/volunteer-attendances — admin records a volunteer day; an ACTIVE
// volunteer self-checks-in for today ({ taskId?, latitude?, longitude? }).
// (Body field checks run in the service — legacy order interleaves lookups.)
router.post(
  "/",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ body: createAttendanceBodySchema }),
  volunteerAttendanceController.create
);
