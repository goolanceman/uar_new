/**
 * Camp attendance module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/camp-attendance.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaCampAttendanceRepository } from "./repositories/camp-attendance.repository";
import { CampAttendanceService } from "./services/camp-attendance.service";
import { CampAttendanceController } from "./controllers/camp-attendance.controller";

const campAttendanceRepository = new PrismaCampAttendanceRepository();
const campAttendanceService = new CampAttendanceService(campAttendanceRepository);

export const campAttendanceController = new CampAttendanceController(campAttendanceService);
export { CampAttendanceService, CampAttendanceController, PrismaCampAttendanceRepository };
