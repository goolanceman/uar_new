/**
 * Profile module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/profile.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaProfileRepository } from "./repositories/profile.repository";
import { ProfileService } from "./services/profile.service";
import { ProfileController } from "./controllers/profile.controller";

const profileRepository = new PrismaProfileRepository();
const profileService = new ProfileService(profileRepository);

export const profileController = new ProfileController(profileService);
export { ProfileService, ProfileController, PrismaProfileRepository };
