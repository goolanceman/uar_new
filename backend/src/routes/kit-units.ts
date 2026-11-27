/**
 * Kit units route — /api/kit-units
 * Thin endpoint definitions; all logic lives in src/modules/kit-units
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/kit-units`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { listKitUnitsQuerySchema } from "@/modules/kit-units/schemas/kit-unit.schema";
import { kitUnitController } from "@/modules/kit-units";

export const router = Router();

// GET /api/kit-units?batchId=&status=&q=&mine=1&limit= (auth) — orderBy code asc
// (legacy gate: `const session = await requireAuth(req)` as the handler's first step).
router.get("/", authenticate, validate({ query: listKitUnitsQuerySchema }), kitUnitController.list);
