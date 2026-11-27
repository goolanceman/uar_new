/**
 * Animal analytics route — /api/animal-analytics
 * Thin endpoint definitions; all logic lives in
 * src/modules/animal-analytics (routes → controllers → services →
 * repositories). The historical export path (`@/routes/animal-analytics`)
 * is preserved.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { animalAnalyticsController } from "@/modules/animal-analytics";

export const router = Router();

/**
 * GET /api/animal-analytics (ADMIN)
 *
 * One consolidated payload for the Animal Welfare analytics tab:
 *  - animals: totals by status + care flags + monthly food commitment
 *  - species: count + monthly food per species (donut + bar)
 *  - status:  count per adoption status (available → fostered → adopted)
 *  - pledges: active count, monthly pledge value, per-kind split and the
 *             shelter-fund pool (pledges with animalId null).
 *
 * Everything is computed server-side with Prisma groupBy/aggregate so the
 * client never has to crunch raw rows.
 */
router.get("/", authorize("ADMIN"), animalAnalyticsController.get);
