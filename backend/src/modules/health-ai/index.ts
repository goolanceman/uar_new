/**
 * Health AI module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/health-ai.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaHealthAiRepository } from "./repositories/health-ai.repository";
import { CONSULT_DISCLAIMER, HealthAiService } from "./services/health-ai.service";
import { HealthAiController } from "./controllers/health-ai.controller";

const healthAiRepository = new PrismaHealthAiRepository();
const healthAiService = new HealthAiService(healthAiRepository);

export const healthAiController = new HealthAiController(healthAiService);
export { HealthAiService, HealthAiController, PrismaHealthAiRepository, CONSULT_DISCLAIMER };
