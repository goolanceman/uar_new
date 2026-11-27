/**
 * Ambulance routes — thin endpoint definitions; all logic lives in
 * src/modules/ambulances (routes → controllers → services → repositories).
 * The historical export path (`@/routes/ambulances`) is preserved: tests and
 * the app entry import `router` from here.
 *
 * /api/ambulances, /api/ambulances/:id — converted 1:1 from
 * src/app/api/ambulances/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  createAmbulanceBodySchema,
  listAmbulancesQuerySchema,
  updateAmbulanceBodySchema,
} from "@/modules/ambulances/schemas/ambulance.schema";
import { ambulanceController } from "@/modules/ambulances";

export const router = Router();

// GET /api/ambulances?status=&type=&q= (auth)
router.get("/", authenticate, validate({ query: listAmbulancesQuerySchema }), ambulanceController.list);

// POST /api/ambulances (ADMIN)
router.post("/", authorize("ADMIN"), validate({ body: createAmbulanceBodySchema }), ambulanceController.create);

// PATCH /api/ambulances/:id (ADMIN)
router.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: updateAmbulanceBodySchema }),
  ambulanceController.update
);

// DELETE /api/ambulances/:id (ADMIN) — blocked while ON_MISSION
router.delete("/:id", authorize("ADMIN"), validate({ params: stringIdParamSchema }), ambulanceController.remove);
