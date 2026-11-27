/**
 * Camp attendance routes — /api/camp-attendance
 * Thin endpoint definitions; all logic lives in src/modules/camp-attendance
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/camp-attendance`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  checkInBodySchema,
  listCampAttendanceQuerySchema,
  updateAttendanceBodySchema,
} from "@/modules/camp-attendance/schemas/camp-attendance.schema";
import { campAttendanceController } from "@/modules/camp-attendance";

export const router = Router();

// GET /api/camp-attendance?campId&status  |  ?campId&summary=1 (live dashboard
// counters) — ADMIN | VOLUNTEER all camps; HOSPITAL only camps its org
// partners. (Legacy gate: `await requireRole(req, "ADMIN", "VOLUNTEER",
// "HOSPITAL", "DOCTOR", "NURSE")` as the handler's first step.)
router.get(
  "/",
  authorize("ADMIN", "VOLUNTEER", "HOSPITAL", "DOCTOR", "NURSE"),
  validate({ query: listCampAttendanceQuerySchema }),
  campAttendanceController.list
);

// POST /api/camp-attendance (ADMIN | VOLUNTEER | NURSE) {registrationId,
// method?} — the CHECK-IN: idempotent, assigns the next queue token per camp.
// (Legacy gate: `await requireRole(req, "ADMIN", "VOLUNTEER", "NURSE")` as
// the handler's first step; field checks run in the service — legacy order.)
router.post(
  "/",
  authorize("ADMIN", "VOLUNTEER", "NURSE"),
  validate({ body: checkInBodySchema }),
  campAttendanceController.checkIn
);

// PATCH /api/camp-attendance (ADMIN | VOLUNTEER | NURSE | DOCTOR)
// {id, status, doctorId?, cancelReason?} — NO_SHOW only from CHECKED_IN/
// WAITING · CANCELLED requires cancelReason · CHECKED_OUT (sets checkOutAt)
// only from COMPLETED · COMPLETED does NOT check out.
router.patch(
  "/",
  authorize("ADMIN", "VOLUNTEER", "NURSE", "DOCTOR"),
  validate({ body: updateAttendanceBodySchema }),
  campAttendanceController.update
);
