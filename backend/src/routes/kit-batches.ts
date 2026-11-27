/**
 * Kit batch routes — /api/kit-batches, /api/kit-batches/:id
 * Thin endpoint definitions; all logic lives in src/modules/kit-batches
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/kit-batches`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  createKitBatchBodySchema,
  listKitBatchesQuerySchema,
  updateKitBatchBodySchema,
} from "@/modules/kit-batches/schemas/kit-batch.schema";
import { kitBatchController } from "@/modules/kit-batches";

export const router = Router();

// GET /api/kit-batches?status= — newest first. (Legacy gate: `await
// requireAuth(req)` as the handler's first step.)
router.get(
  "/",
  authenticate,
  validate({ query: listKitBatchesQuerySchema }),
  kitBatchController.list
);

// POST /api/kit-batches (ADMIN) — creates the batch + N QR-coded kit units.
// (Legacy gate: `await requireRole(req, "ADMIN")` as the handler's first
// step; field checks run in the service — legacy order.)
router.post(
  "/",
  authorize("ADMIN"),
  validate({ body: createKitBatchBodySchema }),
  kitBatchController.create
);

// PATCH /api/kit-batches/:id (ADMIN) — {name?, instructions?, status?}
router.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: updateKitBatchBodySchema }),
  kitBatchController.update
);

// DELETE /api/kit-batches/:id (ADMIN) — removes units then the batch
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema }),
  kitBatchController.remove
);
