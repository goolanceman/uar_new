/**
 * Recurring-needs module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/recurring-needs.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaRecurringNeedRepository } from "./repositories/recurring-need.repository";
import { RecurringNeedService } from "./services/recurring-need.service";
import { RecurringNeedController } from "./controllers/recurring-need.controller";

const recurringNeedRepository = new PrismaRecurringNeedRepository();
const recurringNeedService = new RecurringNeedService(recurringNeedRepository);

export const recurringNeedController = new RecurringNeedController(recurringNeedService);
export { RecurringNeedService, RecurringNeedController, PrismaRecurringNeedRepository };
