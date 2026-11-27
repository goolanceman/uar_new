/**
 * Cause analytics module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/cause-analytics.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaCauseAnalyticsRepository } from "./repositories/cause-analytics.repository";
import { CauseAnalyticsService } from "./services/cause-analytics.service";
import { CauseAnalyticsController } from "./controllers/cause-analytics.controller";

const causeAnalyticsRepository = new PrismaCauseAnalyticsRepository();
const causeAnalyticsService = new CauseAnalyticsService(causeAnalyticsRepository);

export const causeAnalyticsController = new CauseAnalyticsController(causeAnalyticsService);
export { CauseAnalyticsService, CauseAnalyticsController, PrismaCauseAnalyticsRepository };
