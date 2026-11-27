/**
 * Camp expense routes — thin endpoint definitions; all logic lives in
 * src/modules/camp-expense (routes → controllers → services → repositories).
 * The historical export path (`@/routes/camp-expenses`) is preserved: tests
 * and the app entry import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { listCampExpensesQuerySchema } from "@/modules/camp-expense/schemas/camp-expense.schema";
import { campExpenseController } from "@/modules/camp-expense";

export const router = Router();

// GET /api/camp-expenses?campId= — ADMIN. When campId is given the envelope
// carries a totals block for that camp.
router.get("/", authorize("ADMIN"), validate({ query: listCampExpensesQuerySchema }), campExpenseController.list);

// POST /api/camp-expenses — ADMIN. { campId, head, amount, notes? }
// (field checks live in the service — legacy order interleaves a DB lookup).
router.post("/", authorize("ADMIN"), campExpenseController.create);
