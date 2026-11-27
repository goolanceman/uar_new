/**
 * Medical documents module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/medical-documents.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaMedicalDocumentRepository } from "./repositories/medical-document.repository";
import { MedicalDocumentService } from "./services/medical-document.service";
import { MedicalDocumentController } from "./controllers/medical-document.controller";

const medicalDocumentRepository = new PrismaMedicalDocumentRepository();
const medicalDocumentService = new MedicalDocumentService(medicalDocumentRepository);

export const medicalDocumentController = new MedicalDocumentController(medicalDocumentService);
export { MedicalDocumentService, MedicalDocumentController, PrismaMedicalDocumentRepository };
