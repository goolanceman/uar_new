/**
 * Camp staff routes — /api/camp-staff, /api/camp-staff/:id
 * Thin endpoint definitions; all logic lives in src/modules/camp-staff
 * (routes → controllers → services → repositories).
 * The historical export path (`@/routes/camp-staff`) is preserved: tests and
 * the app entry import `router` from here.
 *
 * NOTE: DELETE /api/camp-staff?id=… keeps its query-parameter id (as in the
 * original route handler), so it is router.delete("/") not router.delete("/:id").
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  createCampStaffBodySchema,
  deleteCampStaffQuerySchema,
  listCampStaffQuerySchema,
  updateCampStaffBodySchema,
} from "@/modules/camp-staff/schemas/camp-staff.schema";
import { campStaffController } from "@/modules/camp-staff";

export const router = Router();

// GET /api/camp-staff?campId= — authenticated (camp roster)
router.get("/", authenticate, validate({ query: listCampStaffQuerySchema }), campStaffController.list);

// POST /api/camp-staff (ADMIN | HOSPITAL) {campId, professionalId?, volunteerId?, role}
router.post(
  "/",
  authorize("ADMIN", "HOSPITAL"),
  validate({ body: createCampStaffBodySchema }),
  campStaffController.create
);

// DELETE /api/camp-staff?id= (ADMIN) — remove from roster
router.delete(
  "/",
  authorize("ADMIN"),
  validate({ query: deleteCampStaffQuerySchema }),
  campStaffController.remove
);

// PATCH /api/camp-staff/:id — ADMIN advances an assignment through camp day.
router.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: updateCampStaffBodySchema }),
  campStaffController.updateStatus
);
