/**
 * Inventory-transactions module — composition root. Wires repository →
 * service → controller. The router itself lives in
 * src/routes/inventory-transactions.ts (preserved export path for tests and
 * the app entry) and references the controller from here.
 */
import { PrismaInventoryTransactionRepository } from "./repositories/inventory-transaction.repository";
import { InventoryTransactionService } from "./services/inventory-transaction.service";
import { InventoryTransactionController } from "./controllers/inventory-transaction.controller";

const inventoryTransactionRepository = new PrismaInventoryTransactionRepository();
const inventoryTransactionService = new InventoryTransactionService(inventoryTransactionRepository);

export const inventoryTransactionController = new InventoryTransactionController(
  inventoryTransactionService
);
export {
  InventoryTransactionService,
  InventoryTransactionController,
  PrismaInventoryTransactionRepository,
};
