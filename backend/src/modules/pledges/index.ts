/**
 * Pledges module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/pledges.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaPledgeRepository } from "./repositories/pledge.repository";
import { PledgeService } from "./services/pledge.service";
import { PledgeController } from "./controllers/pledge.controller";

const pledgeRepository = new PrismaPledgeRepository();
const pledgeService = new PledgeService(pledgeRepository);

export const pledgeController = new PledgeController(pledgeService);
export { PledgeService, PledgeController, PrismaPledgeRepository };
