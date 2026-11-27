/**
 * Distributions module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/distributions.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaDistributionRepository } from "./repositories/distribution.repository";
import { DistributionService } from "./services/distribution.service";
import { DistributionController } from "./controllers/distribution.controller";

const distributionRepository = new PrismaDistributionRepository();
const distributionService = new DistributionService(distributionRepository);

export const distributionController = new DistributionController(distributionService);
export { DistributionService, DistributionController, PrismaDistributionRepository };
