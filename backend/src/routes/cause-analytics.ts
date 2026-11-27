/**
 * Cause analytics route — /api/cause-analytics
 * Thin endpoint definitions; all logic lives in
 * src/modules/cause-analytics (routes → controllers → services →
 * repositories). The historical export path (`@/routes/cause-analytics`)
 * is preserved.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { causeAnalyticsController } from "@/modules/cause-analytics";

export const router = Router();

/**
 * GET /api/cause-analytics (ADMIN)
 *
 * One consolidated payload for the Adopt-a-Medicine analytics tab:
 *  - causes: totals by status + funding summary (raised vs full cost)
 *  - condition: count + monthly cost per condition (donut)
 *  - status:    count per lifecycle status (bar)
 *  - monthly:   last 12 months of new pledge value committed
 *  - pledges:   active count, monthly value, all-time count
 *  - topCities: top 5 cities by number of causes
 *  - topCauses: top 5 by amount raised (progress list)
 *
 * Everything is computed server-side with Prisma groupBy/aggregate so the
 * client never has to crunch raw rows.
 */
router.get("/", authorize("ADMIN"), causeAnalyticsController.get);
