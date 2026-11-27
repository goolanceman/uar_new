/**
 * Contact queries module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/contact-queries.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaContactQueryRepository } from "./repositories/contact-query.repository";
import { ContactQueryService } from "./services/contact-query.service";
import { ContactQueryController } from "./controllers/contact-query.controller";

const contactQueryRepository = new PrismaContactQueryRepository();
const contactQueryService = new ContactQueryService(contactQueryRepository);

export const contactQueryController = new ContactQueryController(contactQueryService);
export { ContactQueryService, ContactQueryController, PrismaContactQueryRepository };
