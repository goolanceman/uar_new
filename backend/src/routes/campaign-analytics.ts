/**
 * Campaign analytics route — /api/campaign-analytics
 * Thin endpoint definitions; all logic lives in
 * src/modules/campaign-analytics (routes → controllers → services →
 * repositories). The historical export path (`@/routes/campaign-analytics`)
 * is preserved.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { campaignAnalyticsController } from "@/modules/campaign-analytics";

export const router = Router();

/**
 * GET /api/campaign-analytics (ADMIN)
 *
 * One consolidated payload for the Campaigns analytics tab:
 *  - campaigns: totals by status + featured/urgent + funding summary
 *  - category:  count + raised + target per category (donut)
 *  - status:    count per lifecycle status (bar)
 *  - monthly:   last 12 months of donation inflow attributed to campaigns
 *  - topCampaigns: top 5 by amount raised (progress list)
 *  - reach: beneficiaries + volunteers engaged, summed
 *
 * Everything is computed server-side with Prisma groupBy/aggregate so the
 * client never has to crunch raw rows.
 */
router.get("/", authorize("ADMIN"), campaignAnalyticsController.get);
