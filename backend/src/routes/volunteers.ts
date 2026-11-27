/**
 * Volunteers routes — /api/volunteers, /api/volunteers/me, /api/volunteers/:id
 * Thin endpoint definitions; all logic lives in src/modules/volunteers
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/volunteers`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  listVolunteersQuerySchema,
  updateVolunteerBodySchema,
} from "@/modules/volunteers/schemas/volunteer.schema";
import { volunteerController } from "@/modules/volunteers";

export const router = Router();

// GET /api/volunteers            (ADMIN) — roster array (legacy shape,
// status filter). (Legacy gate: `await requireRole(req, "ADMIN")` as the
// handler's first step.)
// GET /api/volunteers?analytics=1 (ADMIN) — module analytics roll-up for the
// Analytics tab: KPIs, tasks by type, status distribution, leaderboard and
// a 6-month hours trend.
router.get("/", authorize("ADMIN"), validate({ query: listVolunteersQuerySchema }), volunteerController.list);

// GET /api/volunteers/me — the session volunteer's profile incl tasks and
// their latest application. (Legacy gate: `await requireAuth(req)` as the
// handler's first step.)
router.get("/me", authenticate, volunteerController.me);

// PATCH /api/volunteers/:id — admin updates the volunteer profile; a
// volunteer may update the self-service roster fields of their own record.
// (Legacy gate: `await requireRole(req, "ADMIN", "VOLUNTEER")` as the
// handler's first step; field checks run in the service — legacy order.)
router.patch(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: stringIdParamSchema, body: updateVolunteerBodySchema }),
  volunteerController.update
);

// GET /api/volunteers/:id — profile with tasks + attendance summary
router.get("/:id", authorize("ADMIN"), validate({ params: stringIdParamSchema }), volunteerController.get);
