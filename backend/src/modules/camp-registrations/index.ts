/**
 * Camp registrations module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/camp-registrations.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaCampRegistrationRepository } from "./repositories/camp-registration.repository";
import { CampRegistrationService } from "./services/camp-registration.service";
import { CampRegistrationController } from "./controllers/camp-registration.controller";

const campRegistrationRepository = new PrismaCampRegistrationRepository();
const campRegistrationService = new CampRegistrationService(campRegistrationRepository);

export const campRegistrationController = new CampRegistrationController(campRegistrationService);
export { CampRegistrationService, CampRegistrationController, PrismaCampRegistrationRepository };
