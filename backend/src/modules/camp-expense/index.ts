/**
 * Camp-expense module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/camp-expenses.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaCampExpenseRepository } from "./repositories/camp-expense.repository";
import { CampExpenseService } from "./services/camp-expense.service";
import { CampExpenseController } from "./controllers/camp-expense.controller";

const campExpenseRepository = new PrismaCampExpenseRepository();
const campExpenseService = new CampExpenseService(campExpenseRepository);

export const campExpenseController = new CampExpenseController(campExpenseService);
export { CampExpenseService, CampExpenseController, PrismaCampExpenseRepository };
