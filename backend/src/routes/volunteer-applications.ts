/**
 * Volunteer applications routes — /api/volunteer-applications, /api/volunteer-applications/mine, /api/volunteer-applications/:id
 * Thin endpoint definitions; all logic lives in
 * src/modules/volunteer-applications (routes → controllers → services →
 * repositories). The historical export path
 * (`@/routes/volunteer-applications`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  applyBodySchema,
  listApplicationsQuerySchema,
  updateApplicationBodySchema,
} from "@/modules/volunteer-applications/schemas/volunteer-application.schema";
import { volunteerApplicationController } from "@/modules/volunteer-applications";

export const router = Router();

// GET /api/volunteer-applications?mine=1 | (ADMIN) ?status&q — the branch
// gates are order-dependent (the soft ?mine=1 session check runs BEFORE the
// ADMIN gate), so both stay lib calls inside the controller.
router.get("/", validate({ query: listApplicationsQuerySchema }), volunteerApplicationController.list);

// POST /api/volunteer-applications — public form (or logged-in user). The
// session is optional and resolved mid-handler (lib call in the controller).
// The body envelope is permissive — field rules with their exact legacy 400
// messages run in the service after the session-profile lookup.
router.post("/", validate({ body: applyBodySchema }), volunteerApplicationController.apply);

// GET /api/volunteer-applications/mine — latest application + derived review
// timeline. (Legacy gate: `await requireAuth(req)` as the handler's first
// step → authenticate middleware.)
router.get("/mine", authenticate, volunteerApplicationController.mine);

// PATCH /api/volunteer-applications/:id
// - ADMIN: review machine (under review / request info / approve / reject /
//   undo back to pending). Mirrors User.volunteerStatus for the app badge.
// - Applicant (owner): may edit and resubmit their OWN application, only
//   while it is INFO_REQUESTED. Same endpoint and payload shape the web
//   portal and the mobile app both use.
// (Legacy gate: `await requireAuth(req)` as the handler's first step; the
// owner-vs-admin branch and field checks run in the service — legacy order.)
router.patch(
  "/:id",
  authenticate,
  validate({ params: stringIdParamSchema, body: updateApplicationBodySchema }),
  volunteerApplicationController.update
);

// DELETE /api/volunteer-applications/:id — admin removes an application.
// (Legacy gate: `await requireRole(req, "ADMIN")` as the handler's first
// step → authorize middleware.)
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema }),
  volunteerApplicationController.remove
);
