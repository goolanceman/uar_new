/**
 * Prescriptions module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/prescriptions.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaPrescriptionRepository } from "./repositories/prescription.repository";
import { PrescriptionService } from "./services/prescription.service";
import { PrescriptionController } from "./controllers/prescription.controller";

const prescriptionRepository = new PrismaPrescriptionRepository();
const prescriptionService = new PrescriptionService(prescriptionRepository);

export const prescriptionController = new PrescriptionController(prescriptionService);
export { PrescriptionService, PrescriptionController, PrismaPrescriptionRepository };
