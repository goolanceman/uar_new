/**
 * Donors module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/donors.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaDonorRepository } from "./repositories/donor.repository";
import { DonorService } from "./services/donor.service";
import { DonorController } from "./controllers/donor.controller";

const donorRepository = new PrismaDonorRepository();
const donorService = new DonorService(donorRepository);

export const donorController = new DonorController(donorService);
export { DonorService, DonorController, PrismaDonorRepository };
