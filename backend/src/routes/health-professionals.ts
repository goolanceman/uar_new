/**
 * Health professional routes — /api/health-professionals, /api/health-professionals/:id
 * Thin endpoint definitions; all logic lives in
 * src/modules/health-professionals (routes → controllers → services →
 * repositories).
 * The historical export path (`@/routes/health-professionals`) is preserved:
 * tests and the app entry import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  createHealthProfessionalBodySchema,
  listHealthProfessionalsQuerySchema,
  updateHealthProfessionalBodySchema,
} from "@/modules/health-professionals/schemas/health-professional.schema";
import { healthProfessionalController } from "@/modules/health-professionals";

export const router = Router();

// GET /api/health-professionals?q&kind&orgId&verificationStatus&active
// ADMIN: full directory. HOSPITAL: scoped to its own org.
router.get(
  "/",
  authorize("ADMIN", "HOSPITAL"),
  validate({ query: listHealthProfessionalsQuerySchema }),
  healthProfessionalController.list
);

// POST /api/health-professionals — ADMIN anywhere, HOSPITAL within its own
// org (orgId forced server-side). New professionals start PENDING; verify
// via PATCH.
router.post(
  "/",
  authorize("ADMIN", "HOSPITAL"),
  validate({ body: createHealthProfessionalBodySchema }),
  healthProfessionalController.create
);

// GET /api/health-professionals/:id — ADMIN, or the HOSPITAL owning the pro's org
router.get(
  "/:id",
  authorize("ADMIN", "HOSPITAL"),
  validate({ params: stringIdParamSchema }),
  healthProfessionalController.get
);

// PATCH /api/health-professionals/:id
// ADMIN: full profile + verification (verificationStatus + verifiedByName/At).
// Owning HOSPITAL: profile fields only — cannot self-verify.
router.patch(
  "/:id",
  authorize("ADMIN", "HOSPITAL"),
  validate({ params: stringIdParamSchema, body: updateHealthProfessionalBodySchema }),
  healthProfessionalController.update
);
