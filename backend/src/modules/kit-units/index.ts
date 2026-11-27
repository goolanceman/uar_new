/**
 * Kit-units module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/kit-units.ts (preserved
 * export path for tests and the app entry).
 */
import { PrismaKitUnitRepository } from "./repositories/kit-unit.repository";
import { KitUnitService } from "./services/kit-unit.service";
import { KitUnitController } from "./controllers/kit-unit.controller";

const kitUnitRepository = new PrismaKitUnitRepository();
const kitUnitService = new KitUnitService(kitUnitRepository);

export const kitUnitController = new KitUnitController(kitUnitService);
export { KitUnitService, KitUnitController, PrismaKitUnitRepository };
