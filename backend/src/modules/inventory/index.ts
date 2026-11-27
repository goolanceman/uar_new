/**
 * Inventory module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/inventory.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaInventoryRepository } from "./repositories/inventory.repository";
import { InventoryService } from "./services/inventory.service";
import { InventoryController } from "./controllers/inventory.controller";

const inventoryRepository = new PrismaInventoryRepository();
const inventoryService = new InventoryService(inventoryRepository);

export const inventoryController = new InventoryController(inventoryService);
export { InventoryService, InventoryController, PrismaInventoryRepository };
