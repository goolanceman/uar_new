/**
 * Causes routes — /api/causes, /api/causes/pledges, /api/causes/:id,
 * /api/causes/:id/pledges.
 * Thin endpoint definitions; all logic lives in src/modules/causes
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/causes`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  listCausePledgesQuerySchema,
  listCausesQuerySchema,
} from "@/modules/causes/schemas/cause.schema";
import { causeController } from "@/modules/causes";

export const router = Router();

// GET /api/causes?condition=&status=&q= (public)
router.get("/", validate({ query: listCausesQuerySchema }), causeController.list);

// GET /api/causes/pledges?mine=1&causeId= (auth)
// NOTE: declared before any conflicting "/:id" pattern.
router.get(
  "/pledges",
  authenticate,
  validate({ query: listCausePledgesQuerySchema }),
  causeController.listPledges
);

// POST /api/causes (ADMIN)
router.post("/", authorize("ADMIN"), causeController.create);

// GET /api/causes/:id (public)
router.get("/:id", causeController.detail);

// PATCH /api/causes/:id (ADMIN)
router.patch("/:id", authorize("ADMIN"), causeController.update);

// DELETE /api/causes/:id (ADMIN)
router.delete("/:id", authorize("ADMIN"), causeController.remove);

// POST /api/causes/:id/pledges — public (guests) OR authenticated donors
// (validateSession runs inline in the controller — optional session, not a gate).
router.post("/:id/pledges", causeController.createPledge);
