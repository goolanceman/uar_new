/**
 * Appointment routes — /api/appointments, /api/appointments/:id
 * Thin endpoint definitions; all logic lives in src/modules/appointments
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/appointments`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  appointmentBodySchema,
  appointmentIdParamSchema,
  listAppointmentsQuerySchema,
} from "@/modules/appointments/schemas/appointment.schema";
import { appointmentController } from "@/modules/appointments";

export const router = Router();

// GET /api/appointments?campId&beneficiaryId&professionalId&type&status&from&to
// BENEFICIARY sees only appointments of their own patient record.
router.get(
  "/",
  authorize("ADMIN", "VOLUNTEER", "DOCTOR", "NURSE", "BENEFICIARY"),
  validate({ query: listAppointmentsQuerySchema }),
  appointmentController.list
);

// POST /api/appointments (ADMIN | VOLUNTEER | DOCTOR)
// {campId?, beneficiaryId, professionalId?, type, scheduledAt, notes?}
// A DOCTOR creating without professionalId is auto-linked to their own record.
// (Field checks run in the service — legacy order interleaved with lookups.)
router.post(
  "/",
  authorize("ADMIN", "VOLUNTEER", "DOCTOR"),
  validate({ body: appointmentBodySchema }),
  appointmentController.create
);

// GET /api/appointments/:id — ADMIN | VOLUNTEER | DOCTOR.
router.get(
  "/:id",
  authorize("ADMIN", "VOLUNTEER", "DOCTOR"),
  validate({ params: appointmentIdParamSchema }),
  appointmentController.get
);

// PATCH /api/appointments/:id (ADMIN | VOLUNTEER | DOCTOR)
// {status: CONFIRMED|COMPLETED|CANCELLED|NO_SHOW, noShowReason?, professionalId?, scheduledAt?}
// (Field checks run in the service — legacy order interleaved with lookups.)
router.patch(
  "/:id",
  authorize("ADMIN", "VOLUNTEER", "DOCTOR"),
  validate({ params: appointmentIdParamSchema, body: appointmentBodySchema }),
  appointmentController.update
);

// DELETE /api/appointments/:id (ADMIN) — only while still SCHEDULED.
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: appointmentIdParamSchema }),
  appointmentController.remove
);
