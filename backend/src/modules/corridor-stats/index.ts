/**
 * Corridor-stats module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/corridor-stats.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaCorridorStatsRepository } from "./repositories/corridor-stats.repository";
import { CorridorStatsService } from "./services/corridor-stats.service";
import { CorridorStatsController } from "./controllers/corridor-stats.controller";

const corridorStatsRepository = new PrismaCorridorStatsRepository();
const corridorStatsService = new CorridorStatsService(corridorStatsRepository);

export const corridorStatsController = new CorridorStatsController(corridorStatsService);
export { CorridorStatsService, CorridorStatsController, PrismaCorridorStatsRepository };
