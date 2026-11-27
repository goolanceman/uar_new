/**
 * Follow-ups module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/follow-ups.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaFollowUpRepository } from "./repositories/follow-up.repository";
import { FollowUpService } from "./services/follow-up.service";
import { FollowUpController } from "./controllers/follow-up.controller";

const followUpRepository = new PrismaFollowUpRepository();
const followUpService = new FollowUpService(followUpRepository);

export const followUpController = new FollowUpController(followUpService);
export { FollowUpService, FollowUpController, PrismaFollowUpRepository };
