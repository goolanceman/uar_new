/**
 * Masters routes — /api/masters, /api/masters/:id
 * Thin endpoint definitions; all logic lives in src/modules/masters
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/masters`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  listMastersQuerySchema,
  masterIdParamSchema,
} from "@/modules/masters/schemas/master.schema";
import { masterController } from "@/modules/masters";

export const router = Router();

// GET /api/masters
//   ?categories=1  → distinct category strings (orderBy category)
//   ?all=1 (ADMIN) → every master row
//   ?category=X    → active {value,label}[] ordered by sortOrder
// (the role gate is branch-dependent, so it stays a mid-handler lib call).
router.get("/", validate({ query: listMastersQuerySchema }), masterController.list);

// POST /api/masters (ADMIN) — upsert by (category, value). Body coercion and
// the "category and value are required" check run in the service with the
// exact legacy messages.
router.post("/", authorize("ADMIN"), masterController.create);

// PATCH /api/masters/:id (ADMIN) — {label?, active?, sortOrder?, value?};
// field checks run in the service, after the legacy existence lookup.
router.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: masterIdParamSchema }),
  masterController.update
);

// DELETE /api/masters/:id (ADMIN)
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: masterIdParamSchema }),
  masterController.remove
);
