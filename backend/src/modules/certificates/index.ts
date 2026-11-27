/**
 * Certificates module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/certificates.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaCertificateRepository } from "./repositories/certificate.repository";
import { CertificateService } from "./services/certificate.service";
import { CertificateController } from "./controllers/certificate.controller";

const certificateRepository = new PrismaCertificateRepository();
const certificateService = new CertificateService(certificateRepository);

export const certificateController = new CertificateController(certificateService);
export { CertificateService, CertificateController, PrismaCertificateRepository };
