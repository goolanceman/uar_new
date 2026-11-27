/**
 * Missions module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/missions.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaMissionRepository } from "./repositories/mission.repository";
import { MissionService } from "./services/mission.service";
import { MissionController } from "./controllers/mission.controller";

const missionRepository = new PrismaMissionRepository();
const missionService = new MissionService(missionRepository);

export const missionController = new MissionController(missionService);
export { MissionService, MissionController, PrismaMissionRepository };
