/**
 * Medical camps module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/medical-camps.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaMedicalCampRepository } from "./repositories/medical-camp.repository";
import { MedicalCampService } from "./services/medical-camp.service";
import { MedicalCampController } from "./controllers/medical-camp.controller";

const medicalCampRepository = new PrismaMedicalCampRepository();
const medicalCampService = new MedicalCampService(medicalCampRepository);

export const medicalCampController = new MedicalCampController(medicalCampService);
export { MedicalCampService, MedicalCampController, PrismaMedicalCampRepository };
