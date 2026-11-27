/**
 * Screenings module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/screenings.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaScreeningRepository } from "./repositories/screening.repository";
import { ScreeningService } from "./services/screening.service";
import { ScreeningController } from "./controllers/screening.controller";

const screeningRepository = new PrismaScreeningRepository();
const screeningService = new ScreeningService(screeningRepository);

export const screeningController = new ScreeningController(screeningService);
export { ScreeningService, ScreeningController, PrismaScreeningRepository };
