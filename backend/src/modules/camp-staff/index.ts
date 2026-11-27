/**
 * Camp staff module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/camp-staff.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaCampStaffRepository } from "./repositories/camp-staff.repository";
import { CampStaffService } from "./services/camp-staff.service";
import { CampStaffController } from "./controllers/camp-staff.controller";

const campStaffRepository = new PrismaCampStaffRepository();
const campStaffService = new CampStaffService(campStaffRepository);

export const campStaffController = new CampStaffController(campStaffService);
export { CampStaffService, CampStaffController, PrismaCampStaffRepository };
