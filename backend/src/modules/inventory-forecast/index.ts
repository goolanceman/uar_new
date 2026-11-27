/**
 * Inventory-forecast module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/inventory-forecast.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaInventoryForecastRepository } from "./repositories/inventory-forecast.repository";
import { InventoryForecastService } from "./services/inventory-forecast.service";
import { InventoryForecastController } from "./controllers/inventory-forecast.controller";

const inventoryForecastRepository = new PrismaInventoryForecastRepository();
const inventoryForecastService = new InventoryForecastService(inventoryForecastRepository);

export const inventoryForecastController = new InventoryForecastController(inventoryForecastService);
export { InventoryForecastService, InventoryForecastController, PrismaInventoryForecastRepository };
