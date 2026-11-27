/**
 * Stats module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/stats.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaStatsRepository } from "./repositories/stats.repository";
import { StatsService } from "./services/stats.service";
import { StatsController } from "./controllers/stats.controller";

const statsRepository = new PrismaStatsRepository();
const statsService = new StatsService(statsRepository);

export const statsController = new StatsController(statsService);
export { StatsService, StatsController, PrismaStatsRepository };
