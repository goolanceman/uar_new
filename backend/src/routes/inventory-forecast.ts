/**
 * Inventory forecast routes — thin endpoint definitions; all logic lives in
 * src/modules/inventory-forecast (routes → controllers → services →
 * repositories). The historical export path (`@/routes/inventory-forecast`)
 * is preserved: tests and the app entry import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { inventoryForecastController } from "@/modules/inventory-forecast";

export const router = Router();

// GET /api/inventory-forecast (ADMIN | VOLUNTEER) — stockout forecast over
// ACTIVE recurring needs plus the 7-day due-soon worklist.
router.get("/", authorize("ADMIN", "VOLUNTEER"), inventoryForecastController.index);
