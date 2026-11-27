/**
 * Causes module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/causes.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaCauseRepository } from "./repositories/cause.repository";
import { CauseService } from "./services/cause.service";
import { CauseController } from "./controllers/cause.controller";

const causeRepository = new PrismaCauseRepository();
const causeService = new CauseService(causeRepository);

export const causeController = new CauseController(causeService);
export { CauseService, CauseController, PrismaCauseRepository };
