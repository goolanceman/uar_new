/**
 * Charity module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/charity.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaCharityRepository } from "./repositories/charity.repository";
import { CharityService } from "./services/charity.service";
import { CharityController } from "./controllers/charity.controller";

const charityRepository = new PrismaCharityRepository();
const charityService = new CharityService(charityRepository);

export const charityController = new CharityController(charityService);
export { CharityService, CharityController, PrismaCharityRepository };
