/**
 * Sponsorships module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/sponsorships.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaSponsorshipRepository } from "./repositories/sponsorship.repository";
import { SponsorshipService } from "./services/sponsorship.service";
import { SponsorshipController } from "./controllers/sponsorship.controller";

const sponsorshipRepository = new PrismaSponsorshipRepository();
const sponsorshipService = new SponsorshipService(sponsorshipRepository);

export const sponsorshipController = new SponsorshipController(sponsorshipService);
export { SponsorshipService, SponsorshipController, PrismaSponsorshipRepository };
