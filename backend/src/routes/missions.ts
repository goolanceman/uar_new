/**
 * Missions routes — /api/missions, /api/missions/:id
 * Thin endpoint definitions; all logic lives in src/modules/missions
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/missions`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createMissionBodySchema,
  listMissionsQuerySchema,
  missionIdParamSchema,
  updateMissionBodySchema,
} from "@/modules/missions/schemas/mission.schema";
import { missionController } from "@/modules/missions";

export const router = Router();

// GET /api/missions?status=&q=&ambulanceId=&limit= (auth) — newest first
// (Legacy gate: `await requireAuth(req)` as the handler's first step.)
router.get("/", authenticate, validate({ query: listMissionsQuerySchema }), missionController.list);

// POST /api/missions (ADMIN | VOLUNTEER) — generates a 4-segment simulated route
// (Legacy gate: `await requireRole(req, "ADMIN", "VOLUNTEER")` as the handler's
// first step; field checks run in the service — legacy order.)
router.post(
  "/",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ body: createMissionBodySchema }),
  missionController.create
);

// PATCH /api/missions/:id (ADMIN | VOLUNTEER)
//   1. {status, progress?}  — status-stepper advance
//   2. {action: dispatch|advance|complete|cancel, ambulanceId?} — legacy simulation flow
// (Body checks run in the service after the mission 404 — legacy order.)
router.patch(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: missionIdParamSchema, body: updateMissionBodySchema }),
  missionController.update
);
