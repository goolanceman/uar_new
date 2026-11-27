/**
 * Health-timeline module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/health-timeline.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaHealthTimelineRepository } from "./repositories/health-timeline.repository";
import { HealthTimelineService } from "./services/health-timeline.service";
import { HealthTimelineController } from "./controllers/health-timeline.controller";

const healthTimelineRepository = new PrismaHealthTimelineRepository();
const healthTimelineService = new HealthTimelineService(healthTimelineRepository);

export const healthTimelineController = new HealthTimelineController(healthTimelineService);
export { HealthTimelineService, HealthTimelineController, PrismaHealthTimelineRepository };
