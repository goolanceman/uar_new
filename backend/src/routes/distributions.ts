/**
 * Distributions routes — /api/distributions, /api/distributions/:id
 * Thin endpoint definitions; all logic lives in src/modules/distributions
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/distributions`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createDistributionBodySchema,
  distributionIdParamSchema,
  listDistributionsQuerySchema,
  updateDistributionBodySchema,
} from "@/modules/distributions/schemas/distribution.schema";
import { distributionController } from "@/modules/distributions";

export const router = Router();

// GET /api/distributions
//   ?unified=1  → merged ledger across all four distribution systems (auth)
//   ?type=FOOD,MEDICAL &q= &from= &to= &volunteerId= &beneficiaryId= &campaignId=
//   &mine=1 &limit= &offset= &withTotals=1   (auth)
// Default response = raw array (legacy callers). withTotals=1 → envelope.
// (Legacy gate: `await requireAuth(req)` as the handler's first step.)
router.get(
  "/",
  authenticate,
  validate({ query: listDistributionsQuerySchema }),
  distributionController.list
);

// POST /api/distributions (VOLUNTEER | ADMIN)
// (Legacy gate: `await requireRole(req, "VOLUNTEER", "ADMIN")` as the handler's
// first step; field checks + the transactional stock effects run in the
// service — legacy order.)
router.post(
  "/",
  authorize("VOLUNTEER", "ADMIN"),
  validate({ body: createDistributionBodySchema }),
  distributionController.create
);

// GET /api/distributions/:id (ADMIN, VOLUNTEER) — enriched detail
router.get(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: distributionIdParamSchema }),
  distributionController.getById
);

// PATCH /api/distributions/:id (ADMIN, or the recording VOLUNTEER)
// (The ownership 404/403 fire before body processing — service keeps that
// order; stock re-apply runs inside one transaction.)
router.patch(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: distributionIdParamSchema, body: updateDistributionBodySchema }),
  distributionController.update
);

// DELETE /api/distributions/:id (ADMIN, or the recording VOLUNTEER)
// (Stock reversal + delete run inside one transaction.)
router.delete(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: distributionIdParamSchema }),
  distributionController.remove
);
