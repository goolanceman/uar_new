/**
 * Interests module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/interests.ts (preserved
 * export path for tests and the app entry).
 */
import { LibInterestRepository } from "./repositories/interest.repository";
import { InterestService } from "./services/interest.service";
import { InterestController } from "./controllers/interest.controller";

const interestRepository = new LibInterestRepository();
const interestService = new InterestService(interestRepository);

export const interestController = new InterestController(interestService);
export { InterestService, InterestController, LibInterestRepository };
