/**
 * Interests routes — /api/interests (shared by web + mobile).
 * Thin endpoint definitions; all logic lives in src/modules/interests
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/interests`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { elevated } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createInterestSchema,
  interestIdParamSchema,
  listInterestsQuerySchema,
  updateInterestSchema,
} from "@/modules/interests/schemas/interest.schema";
import { interestController } from "@/modules/interests";

export const router = Router();

// GET /api/interests?page=&limit= — interests + totalRoomOfInterest.
router.get("/", validate({ query: listInterestsQuerySchema }), interestController.list);

// POST /api/interests {title} — admin (legacy gate: `await requireElevated(req)`
// as the handler's first step, BEFORE the title check — middleware order kept).
router.post("/", elevated, validate({ body: createInterestSchema }), interestController.create);

// PATCH /api/interests/:id {title} — admin (same requireElevated-first order;
// the :id conversion with Number() stays mid-handler in the controller).
router.patch(
  "/:id",
  elevated,
  validate({ params: interestIdParamSchema, body: updateInterestSchema }),
  interestController.update
);

// DELETE /api/interests/:id — admin; strips the id from users.interestIds and
// the communityPost/communityReel/communityRoom CSVs (done in the shared lib).
router.delete("/:id", elevated, validate({ params: interestIdParamSchema }), interestController.remove);
