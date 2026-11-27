/**
 * Stats routes — /api/stats
 * Thin endpoint definitions; all logic lives in src/modules/stats
 * (routes → controllers → services → repositories).
 * The historical export path (`@/routes/stats`) is preserved.
 */
import { Router } from "express";
import { validate } from "@/shared/middleware/validate";
import { statsQuerySchema } from "@/modules/stats/schemas/stats.schema";
import { statsController } from "@/modules/stats";

export const router = Router();

// GET /api/stats — public aggregate snapshot.
//   ?from=&to= (ISO) → range-scoped giving numbers (raised, donations,
//   monthly, categories, recent) plus deltas vs the previous equal-length
//   period. Without params → all-time defaults (fully backward compatible);
//   `categories` is included in both paths. Snapshot is cached via
//   cached(statsKey(...), cacheTtl.stats, ...) in the service.
router.get("/", validate({ query: statsQuerySchema }), statsController.get);
