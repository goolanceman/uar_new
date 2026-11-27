/**
 * Donations module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/donations.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaDonationRepository } from "./repositories/donation.repository";
import { DonationService } from "./services/donation.service";
import { DonationController } from "./controllers/donation.controller";

const donationRepository = new PrismaDonationRepository();
const donationService = new DonationService(donationRepository);

export const donationController = new DonationController(donationService);
export { DonationService, DonationController, PrismaDonationRepository };
