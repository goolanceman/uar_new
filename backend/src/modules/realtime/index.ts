/**
 * Realtime module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/realtime.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaRealtimeRepository } from "./repositories/realtime.repository";
import { RealtimeService } from "./services/realtime.service";
import { RealtimeController } from "./controllers/realtime.controller";

const realtimeRepository = new PrismaRealtimeRepository();
const realtimeService = new RealtimeService(realtimeRepository);

export const realtimeController = new RealtimeController(realtimeService);
export { RealtimeService, RealtimeController, PrismaRealtimeRepository };
