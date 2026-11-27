/**
 * Kit-stats module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/kit-stats.ts (preserved
 * export path for tests and the app entry).
 */
import { PrismaKitStatsRepository } from "./repositories/kit-stats.repository";
import { KitStatsService } from "./services/kit-stats.service";
import { KitStatsController } from "./controllers/kit-stats.controller";

const kitStatsRepository = new PrismaKitStatsRepository();
const kitStatsService = new KitStatsService(kitStatsRepository);

export const kitStatsController = new KitStatsController(kitStatsService);
export { KitStatsService, KitStatsController, PrismaKitStatsRepository };
