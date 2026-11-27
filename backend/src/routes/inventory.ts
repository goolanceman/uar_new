/**
 * Inventory routes — /api/inventory, /api/inventory/:id
 * Thin endpoint definitions; all logic lives in src/modules/inventory
 * (routes → controllers → services → repositories).
 * The historical export path (`@/routes/inventory`) is preserved.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  inventoryIdParamSchema,
  listInventoryQuerySchema,
} from "@/modules/inventory/schemas/inventory.schema";
import { inventoryController } from "@/modules/inventory";

export const router = Router();

// GET /api/inventory?category=&q=&low=1 (auth) — orderBy name
router.get("/", authenticate, validate({ query: listInventoryQuerySchema }), inventoryController.list);

// POST /api/inventory (ADMIN | VOLUNTEER)
// (no body schema: legacy coercions never reject and stay in the service)
router.post("/", authorize("ADMIN", "VOLUNTEER"), inventoryController.create);

// GET /api/inventory/:id — item + purchase history (ADMIN | VOLUNTEER)
router.get(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: inventoryIdParamSchema }),
  inventoryController.getById
);

// PATCH /api/inventory/:id (ADMIN | VOLUNTEER)
//   {addQuantity}          → increment quantity (never below 0)
//   ...or set plain fields {name?, category?, quantity?, minStock?, unit?, location?, pricePerUnit?, description?}
// (no body schema: the 404 fires before body processing — service keeps that order)
router.patch(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: inventoryIdParamSchema }),
  inventoryController.update
);

// DELETE /api/inventory/:id (ADMIN)
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: inventoryIdParamSchema }),
  inventoryController.remove
);
