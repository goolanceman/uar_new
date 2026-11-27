/**
 * Beneficiary-requests module — composition root. Wires repository → service
 * → controller. The router itself lives in src/routes/beneficiary-requests.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaBeneficiaryRequestRepository } from "./repositories/beneficiary-request.repository";
import { BeneficiaryRequestService } from "./services/beneficiary-request.service";
import { BeneficiaryRequestController } from "./controllers/beneficiary-request.controller";

const beneficiaryRequestRepository = new PrismaBeneficiaryRequestRepository();
const beneficiaryRequestService = new BeneficiaryRequestService(beneficiaryRequestRepository);

export const beneficiaryRequestController = new BeneficiaryRequestController(beneficiaryRequestService);
export { BeneficiaryRequestService, BeneficiaryRequestController, PrismaBeneficiaryRequestRepository };
