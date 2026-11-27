/**
 * Campaign analytics module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/campaign-analytics.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaCampaignAnalyticsRepository } from "./repositories/campaign-analytics.repository";
import { CampaignAnalyticsService } from "./services/campaign-analytics.service";
import { CampaignAnalyticsController } from "./controllers/campaign-analytics.controller";

const campaignAnalyticsRepository = new PrismaCampaignAnalyticsRepository();
const campaignAnalyticsService = new CampaignAnalyticsService(campaignAnalyticsRepository);

export const campaignAnalyticsController = new CampaignAnalyticsController(campaignAnalyticsService);
export { CampaignAnalyticsService, CampaignAnalyticsController, PrismaCampaignAnalyticsRepository };
