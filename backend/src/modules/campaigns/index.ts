/**
 * Campaigns module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/campaigns.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaCampaignRepository } from "./repositories/campaign.repository";
import { CampaignService } from "./services/campaign.service";
import { CampaignController } from "./controllers/campaign.controller";

const campaignRepository = new PrismaCampaignRepository();
const campaignService = new CampaignService(campaignRepository);

export const campaignController = new CampaignController(campaignService);
export { CampaignService, CampaignController, PrismaCampaignRepository };
