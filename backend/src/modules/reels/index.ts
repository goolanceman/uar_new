/**
 * Reels module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/reels.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { ReelLibRepository } from "./repositories/reel.repository";
import { ReelService } from "./services/reel.service";
import { ReelController } from "./controllers/reel.controller";

const reelRepository = new ReelLibRepository();
const reelService = new ReelService(reelRepository);

export const reelController = new ReelController(reelService);
export { ReelService, ReelController, ReelLibRepository };
