/**
 * Vitals module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/vitals.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaVitalObservationRepository } from "./repositories/vitals.repository";
import { VitalsService } from "./services/vitals.service";
import { VitalsController } from "./controllers/vitals.controller";

const vitalsRepository = new PrismaVitalObservationRepository();
const vitalsService = new VitalsService(vitalsRepository);

export const vitalsController = new VitalsController(vitalsService);
export { VitalsService, VitalsController, PrismaVitalObservationRepository };
