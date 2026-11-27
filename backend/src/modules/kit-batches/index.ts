/**
 * Kit batches module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/kit-batches.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaKitBatchRepository } from "./repositories/kit-batch.repository";
import { KitBatchService } from "./services/kit-batch.service";
import { KitBatchController } from "./controllers/kit-batch.controller";

const kitBatchRepository = new PrismaKitBatchRepository();
const kitBatchService = new KitBatchService(kitBatchRepository);

export const kitBatchController = new KitBatchController(kitBatchService);
export { KitBatchService, KitBatchController, PrismaKitBatchRepository };
