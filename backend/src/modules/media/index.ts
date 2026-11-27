/**
 * Media module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/media.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaMediaRepository } from "./repositories/media.repository";
import { MediaService } from "./services/media.service";
import { MediaController } from "./controllers/media.controller";

const mediaRepository = new PrismaMediaRepository();
const mediaService = new MediaService(mediaRepository);

export const mediaController = new MediaController(mediaService);
export { MediaService, MediaController, PrismaMediaRepository };
