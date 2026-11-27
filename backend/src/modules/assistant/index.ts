/**
 * Assistant module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/assistant.ts (preserved
 * export path for tests and the app entry) and references the controller from
 * here.
 */
import { LibAssistantRepository } from "./repositories/assistant.repository";
import { AssistantService } from "./services/assistant.service";
import { AssistantController } from "./controllers/assistant.controller";

const assistantRepository = new LibAssistantRepository();
const assistantService = new AssistantService(assistantRepository);

export const assistantController = new AssistantController(assistantService);
export { AssistantService, AssistantController, LibAssistantRepository };
