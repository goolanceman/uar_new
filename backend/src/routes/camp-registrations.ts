/**
 * Camp registration routes — /api/camp-registrations, /api/camp-registrations/:id
 * Thin endpoint definitions; all logic lives in src/modules/camp-registrations
 * (routes → controllers → services → repositories).
 * The historical export path (`@/routes/camp-registrations`) is preserved:
 * tests and the app entry import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  createCampRegistrationBodySchema,
  listCampRegistrationsQuerySchema,
  updateCampRegistrationBodySchema,
} from "@/modules/camp-registrations/schemas/camp-registration.schema";
import { campRegistrationController } from "@/modules/camp-registrations";

export const router = Router();

// GET /api/camp-registrations?q&campId&status&page&limit
// ADMIN | VOLUNTEER all; HOSPITAL only camps its org partners; BENEFICIARY own.
router.get(
  "/",
  authorize("ADMIN", "VOLUNTEER", "HOSPITAL", "DOCTOR", "NURSE", "BENEFICIARY"),
  validate({ query: listCampRegistrationsQuerySchema }),
  campRegistrationController.list
);

// POST /api/camp-registrations (ADMIN | VOLUNTEER | NURSE desk; BENEFICIARY self-service)
// {campId, beneficiaryId, registeredVia?, scheduledSlot?, notes?}
router.post(
  "/",
  authorize("ADMIN", "VOLUNTEER", "NURSE", "BENEFICIARY"),
  validate({ body: createCampRegistrationBodySchema }),
  campRegistrationController.create
);

// GET /api/camp-registrations/:id — ADMIN | VOLUNTEER
router.get(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: stringIdParamSchema }),
  campRegistrationController.get
);

// PATCH /api/camp-registrations/:id (ADMIN | VOLUNTEER)
// {status: CONFIRMED|CANCELLED|REJECTED, scheduledSlot?, notes?}
router.patch(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: stringIdParamSchema, body: updateCampRegistrationBodySchema }),
  campRegistrationController.update
);
