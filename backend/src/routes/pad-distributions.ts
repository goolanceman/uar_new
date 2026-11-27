/**
 * Pad distribution (pad drive) routes — /api/pad-distributions, /:id
 * Thin endpoint definitions; all logic lives in src/modules/pad-distributions
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/pad-distributions`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { listPadDistributionsQuerySchema } from "@/modules/pad-distributions/schemas/pad-distribution.schema";
import { padDistributionController } from "@/modules/pad-distributions";

export const router = Router();

// GET /api/pad-distributions
//   ?q= &session=1|0 &from= &to= &volunteerId= &limit= &offset= &withTotals=1   (auth)
// Default = raw array (legacy). withTotals=1 → {items,total,sumPads,sumGirls,…}
router.get(
  "/",
  authenticate,
  validate({ query: listPadDistributionsQuerySchema }),
  padDistributionController.list
);

// POST /api/pad-distributions (VOLUNTEER | ADMIN)
router.post("/", authorize("VOLUNTEER", "ADMIN"), padDistributionController.create);

// GET /api/pad-distributions/:id (ADMIN, VOLUNTEER) — detail with volunteer name
router.get("/:id", authorize("ADMIN", "VOLUNTEER"), padDistributionController.detail);

// PATCH /api/pad-distributions/:id (ADMIN, or the recording VOLUNTEER)
router.patch("/:id", authorize("ADMIN", "VOLUNTEER"), padDistributionController.update);

// DELETE /api/pad-distributions/:id (ADMIN, or the recording VOLUNTEER)
router.delete("/:id", authorize("ADMIN", "VOLUNTEER"), padDistributionController.remove);
