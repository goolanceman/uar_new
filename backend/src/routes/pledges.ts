/**
 * Pledges routes — /api/pledges, /api/pledges/:id
 * Thin endpoint definitions; all logic lives in src/modules/pledges
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/pledges`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  listPledgesQuerySchema,
  pledgeIdParamSchema,
  updatePledgeBodySchema,
} from "@/modules/pledges/schemas/pledge.schema";
import { pledgeController } from "@/modules/pledges";

export const router = Router();

// GET /api/pledges?status=&q= — admin list of all medicine pledges
// (legacy gate: `await requireRole(req, "ADMIN")` as the handler's first step).
router.get(
  "/",
  authorize("ADMIN"),
  validate({ query: listPledgesQuerySchema }),
  pledgeController.list
);

// GET /api/pledges/mine — the signed-in donor's pledges with the full payment
// schedule. Owner-scoped. NOTE: declared before "/:id".
router.get("/mine", authenticate, pledgeController.mine);

// GET /api/pledges/:id — one pledge + schedule + payments (owner or ADMIN)
router.get("/:id", authenticate, validate({ params: pledgeIdParamSchema }), pledgeController.get);

// PATCH /api/pledges/:id — ADMIN or the pledge's own donor → {pledge}
// (status field check runs in the service, after the legacy lookup/gates).
router.patch(
  "/:id",
  authenticate,
  validate({ params: pledgeIdParamSchema, body: updatePledgeBodySchema }),
  pledgeController.update
);

// DELETE /api/pledges/:id (ADMIN)
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: pledgeIdParamSchema }),
  pledgeController.remove
);
