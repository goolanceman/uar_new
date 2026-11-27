/**
 * Recurring-needs routes — /api/recurring-needs, /api/recurring-needs/:id
 * Thin endpoint definitions; all logic lives in src/modules/recurring-needs
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/recurring-needs`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  listRecurringNeedsQuerySchema,
  recurringNeedIdParamSchema,
} from "@/modules/recurring-needs/schemas/recurring-need.schema";
import { recurringNeedController } from "@/modules/recurring-needs";

export const router = Router();

// GET /api/recurring-needs?beneficiaryId=&itemId=&status=&dueBy= (staff)
router.get(
  "/",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ query: listRecurringNeedsQuerySchema }),
  recurringNeedController.list
);

// POST /api/recurring-needs (ADMIN | VOLUNTEER) — register a beneficiary's
// standing need (field checks run in the service — legacy order interleaves
// DB lookups; the raw body is passed through unchanged).
router.post("/", authorize("ADMIN", "VOLUNTEER"), recurringNeedController.create);

// PATCH /api/recurring-needs/:id (ADMIN | VOLUNTEER) — edit qty/cycle,
// pause/resume/complete (field checks run in the service, after the legacy
// 404 lookup).
router.patch(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: recurringNeedIdParamSchema }),
  recurringNeedController.update
);

// DELETE /api/recurring-needs/:id (ADMIN only) — cancel a standing need
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: recurringNeedIdParamSchema }),
  recurringNeedController.remove
);
