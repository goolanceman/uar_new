/**
 * School coverage routes — /api/school-coverages
 * Thin endpoint definitions; all logic lives in src/modules/school-coverages
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/school-coverages`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createSchoolCoverageSchema,
  listSchoolCoveragesQuerySchema,
} from "@/modules/school-coverages/schemas/school-coverage.schema";
import { schoolCoverageController } from "@/modules/school-coverages";

export const router = Router();

// GET /api/school-coverages?q=&active=1 — legacy gate: `await requireRole(req,
// "ADMIN", "VOLUNTEER")` as the handler's first step.
router.get(
  "/",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ query: listSchoolCoveragesQuerySchema }),
  schoolCoverageController.list
);

// POST /api/school-coverages — register/upsert a school in the outreach registry
// (same requireRole-first gate; 200 on update, 201 on create).
router.post(
  "/",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ body: createSchoolCoverageSchema }),
  schoolCoverageController.upsert
);
