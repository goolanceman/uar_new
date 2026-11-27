/**
 * Ambulances module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/ambulances.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaAmbulanceRepository } from "./repositories/ambulance.repository";
import { AmbulanceService } from "./services/ambulance.service";
import { AmbulanceController } from "./controllers/ambulance.controller";

const ambulanceRepository = new PrismaAmbulanceRepository();
const ambulanceService = new AmbulanceService(ambulanceRepository);

export const ambulanceController = new AmbulanceController(ambulanceService);
export { AmbulanceService, AmbulanceController, PrismaAmbulanceRepository };
