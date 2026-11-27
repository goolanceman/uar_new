/**
 * Medical camp routes — /api/medical-camps, /api/medical-camps/:id
 * Thin endpoint definitions; all logic lives in src/modules/medical-camps
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/medical-camps`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  campIdParamSchema,
  createCampBodySchema,
  listCampsQuerySchema,
  updateCampBodySchema,
} from "@/modules/medical-camps/schemas/medical-camp.schema";
import { medicalCampController } from "@/modules/medical-camps";

export const router = Router();

// GET /api/medical-camps?q&status&city&campaignId&upcoming=1&withCounts=1&page&limit
// PUBLIC for anonymous visitors: only SCHEDULED/LIVE/COMPLETED camps, with
// internal fields stripped. (Legacy gate: `await validateSession(req)` — an
// OPTIONAL session, so it stays a lib call in the controller.)
router.get("/", validate({ query: listCampsQuerySchema }), medicalCampController.list);

// POST /api/medical-camps (ADMIN) — auto code, createdByName from session.
// (Field checks run in the service — legacy order.)
router.post("/", authorize("ADMIN"), validate({ body: createCampBodySchema }), medicalCampController.create);

// GET /api/medical-camps/:id — any authenticated user; partners, staff and counts
// (Legacy gate: `await requireAuth(req)` as the handler's first step.)
router.get("/:id", authenticate, validate({ params: campIdParamSchema }), medicalCampController.get);

// PATCH /api/medical-camps/:id (ADMIN) — field edits + validated lifecycle
// DRAFT→SCHEDULED→LIVE→COMPLETED / CANCELLED (terminal states cannot reopen).
router.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: campIdParamSchema, body: updateCampBodySchema }),
  medicalCampController.update
);

// DELETE /api/medical-camps/:id (ADMIN) — only DRAFT camps with no registrations
router.delete("/:id", authorize("ADMIN"), validate({ params: campIdParamSchema }), medicalCampController.remove);
