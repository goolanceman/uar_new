/**
 * Kit-scan module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/kit-scan.ts (preserved export path
 * for tests and the app entry) and references the controller from here.
 */
import { PrismaKitScanRepository } from "./repositories/kit-scan.repository";
import { KitScanService } from "./services/kit-scan.service";
import { KitScanController } from "./controllers/kit-scan.controller";

const kitScanRepository = new PrismaKitScanRepository();
const kitScanService = new KitScanService(kitScanRepository);

export const kitScanController = new KitScanController(kitScanService);
export { KitScanService, KitScanController, PrismaKitScanRepository };
