/**
 * Corridor-stats route — /api/corridor-stats
 * Thin endpoint definitions; all logic lives in src/modules/corridor-stats
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/corridor-stats`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { corridorStatsQuerySchema } from "@/modules/corridor-stats/schemas/corridor-stats.schema";
import { corridorStatsController } from "@/modules/corridor-stats";

export const router = Router();

// GET /api/corridor-stats (auth) — legacy gate: `await requireAuth(req)` as
// the handler's first step.
// Green-corridor + fleet analytics. Keeps every legacy key
// (missions / vehiclesAlerted / timeSavedMin / avgSavedSec / byMethod / bySegment)
// and adds the richer analytics payload used by the admin Analytics tab.
router.get(
  "/",
  authenticate,
  validate({ query: corridorStatsQuerySchema }),
  corridorStatsController.snapshot
);
