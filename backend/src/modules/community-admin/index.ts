/**
 * Community admin module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/community-admin.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaCommunityAdminRepository } from "./repositories/community-admin.repository";
import { CommunityAdminService } from "./services/community-admin.service";
import { CommunityAdminController } from "./controllers/community-admin.controller";

const communityAdminRepository = new PrismaCommunityAdminRepository();
const communityAdminService = new CommunityAdminService(communityAdminRepository);

export const communityAdminController = new CommunityAdminController(communityAdminService);
export { CommunityAdminService, CommunityAdminController, PrismaCommunityAdminRepository };
