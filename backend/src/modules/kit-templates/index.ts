/**
 * Kit templates module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/kit-templates.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaKitTemplateRepository } from "./repositories/kit-template.repository";
import { KitTemplateService } from "./services/kit-template.service";
import { KitTemplateController } from "./controllers/kit-template.controller";

const kitTemplateRepository = new PrismaKitTemplateRepository();
const kitTemplateService = new KitTemplateService(kitTemplateRepository);

export const kitTemplateController = new KitTemplateController(kitTemplateService);
export { KitTemplateService, KitTemplateController, PrismaKitTemplateRepository };
