/**
 * Beneficiaries module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/beneficiaries.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaBeneficiaryRepository } from "./repositories/beneficiary.repository";
import { BeneficiaryService } from "./services/beneficiary.service";
import { BeneficiaryController } from "./controllers/beneficiary.controller";

const beneficiaryRepository = new PrismaBeneficiaryRepository();
const beneficiaryService = new BeneficiaryService(beneficiaryRepository);

export const beneficiaryController = new BeneficiaryController(beneficiaryService);
export { BeneficiaryService, BeneficiaryController, PrismaBeneficiaryRepository };
