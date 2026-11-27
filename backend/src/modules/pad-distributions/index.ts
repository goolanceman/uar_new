/**
 * Pad distributions module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/pad-distributions.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaPadDistributionRepository } from "./repositories/pad-distribution.repository";
import { PadDistributionService } from "./services/pad-distribution.service";
import { PadDistributionController } from "./controllers/pad-distribution.controller";

const padDistributionRepository = new PrismaPadDistributionRepository();
const padDistributionService = new PadDistributionService(padDistributionRepository);

export const padDistributionController = new PadDistributionController(padDistributionService);
export { PadDistributionService, PadDistributionController, PrismaPadDistributionRepository };
