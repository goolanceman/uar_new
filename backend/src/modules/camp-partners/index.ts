/**
 * Camp-partners module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/camp-partners.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaCampPartnerRepository } from "./repositories/camp-partner.repository";
import { CampPartnerService } from "./services/camp-partner.service";
import { CampPartnerController } from "./controllers/camp-partner.controller";

const campPartnerRepository = new PrismaCampPartnerRepository();
const campPartnerService = new CampPartnerService(campPartnerRepository);

export const campPartnerController = new CampPartnerController(campPartnerService);
export { CampPartnerService, CampPartnerController, PrismaCampPartnerRepository };
