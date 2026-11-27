/**
 * Masters module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/masters.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaMasterRepository } from "./repositories/master.repository";
import { MasterService } from "./services/master.service";
import { MasterController } from "./controllers/master.controller";

const masterRepository = new PrismaMasterRepository();
const masterService = new MasterService(masterRepository);

export const masterController = new MasterController(masterService);
export { MasterService, MasterController, PrismaMasterRepository };
