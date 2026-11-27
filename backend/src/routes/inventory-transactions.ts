/**
 * Inventory transactions route — /api/inventory-transactions
 * Thin endpoint definitions; all logic lives in
 * src/modules/inventory-transactions (routes → controllers → services →
 * repositories). The historical export path
 * (`@/routes/inventory-transactions`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createTransactionBodySchema,
  listTransactionsQuerySchema,
} from "@/modules/inventory-transactions/schemas/inventory-transaction.schema";
import { inventoryTransactionController } from "@/modules/inventory-transactions";

export const router = Router();

// GET /api/inventory-transactions — ADMIN. Filters: itemId, campId, type.
// Includes the item name. (The case-sensitive type check runs in the service,
// before any DB call, with the legacy 400 message.)
router.get(
  "/",
  authorize("ADMIN"),
  validate({ query: listTransactionsQuerySchema }),
  inventoryTransactionController.list
);

// POST /api/inventory-transactions — ADMIN. { itemId, campId?, type,
// quantity (signed), batchNo?, expiryDate?, source?, notes? } — the quantity
// delta is applied to InventoryItem.quantity (RECEIVED + / ISSUED − /
// CONSUMED − / RETURNED + / ADJUSTED explicit signed delta) and the stock is
// never allowed to go below zero (409).
router.post(
  "/",
  authorize("ADMIN"),
  validate({ body: createTransactionBodySchema }),
  inventoryTransactionController.create
);
