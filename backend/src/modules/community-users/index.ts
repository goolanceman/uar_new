/**
 * Community users module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/community-users.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaCommunityUserRepository } from "./repositories/community-user.repository";
import { CommunityUserService } from "./services/community-user.service";
import { CommunityUserController } from "./controllers/community-user.controller";

const communityUserRepository = new PrismaCommunityUserRepository();
const communityUserService = new CommunityUserService(communityUserRepository);

export const communityUserController = new CommunityUserController(communityUserService);
export { CommunityUserService, CommunityUserController, PrismaCommunityUserRepository };
