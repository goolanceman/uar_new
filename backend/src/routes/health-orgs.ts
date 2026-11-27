/**
 * Health organisation routes — /api/health-orgs, /api/health-orgs/:id
 * Thin endpoint definitions; all logic lives in src/modules/health-orgs
 * (routes → controllers → services → repositories).
 * The historical export path (`@/routes/health-orgs`) is preserved: tests and
 * the app entry import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  createHealthOrgBodySchema,
  listHealthOrgsQuerySchema,
  updateHealthOrgBodySchema,
} from "@/modules/health-orgs/schemas/health-org.schema";
import { healthOrgController } from "@/modules/health-orgs";

export const router = Router();

// GET /api/health-orgs — ADMIN sees all (q/status/type filters);
// HOSPITAL sees only the org it owns; DOCTOR the verified directory.
router.get(
  "/",
  authorize("ADMIN", "HOSPITAL", "DOCTOR"),
  validate({ query: listHealthOrgsQuerySchema }),
  healthOrgController.list
);

// POST /api/health-orgs (ADMIN) — orgs are created PENDING until verified.
// Public self-registration is intentionally NOT exposed on this endpoint.
router.post("/", authorize("ADMIN"), validate({ body: createHealthOrgBodySchema }), healthOrgController.create);

// GET /api/health-orgs/:id — ADMIN, or the HOSPITAL user that owns the org
router.get(
  "/:id",
  authorize("ADMIN", "HOSPITAL"),
  validate({ params: stringIdParamSchema }),
  healthOrgController.get
);

// PATCH /api/health-orgs/:id (ADMIN) — verification (status + verifiedByName/
// verifiedAt) or plain field edits.
router.patch(
  "/:id",
  authorize("ADMIN", "HOSPITAL"),
  validate({ params: stringIdParamSchema, body: updateHealthOrgBodySchema }),
  healthOrgController.update
);

// DELETE /api/health-orgs/:id (ADMIN) — only when the org has no camp partnerships
router.delete("/:id", authorize("ADMIN"), validate({ params: stringIdParamSchema }), healthOrgController.remove);
