/**
 * Kit stats route — /api/kit-stats
 * Thin endpoint definitions; all logic lives in src/modules/kit-stats
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/kit-stats`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { kitStatsQuerySchema } from "@/modules/kit-stats/schemas/kit-stats.schema";
import { kitStatsController } from "@/modules/kit-stats";

export const router = Router();

// GET /api/kit-stats (auth) — legacy gate: `await requireAuth(req)` as the
// handler's first step.
router.get("/", authenticate, validate({ query: kitStatsQuerySchema }), kitStatsController.snapshot);
