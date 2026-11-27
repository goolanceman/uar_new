/**
 * Corridor events route — /api/corridor-events
 * Thin endpoint definitions; all logic lives in src/modules/corridor-events
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/corridor-events`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { listCorridorEventsQuerySchema } from "@/modules/corridor-events/schemas/corridor-event.schema";
import { corridorEventController } from "@/modules/corridor-events";

export const router = Router();

// GET /api/corridor-events?missionId=&limit= (auth) — desc createdAt
// (legacy gate: `await requireAuth(req)` as the handler's first step).
router.get(
  "/",
  authenticate,
  validate({ query: listCorridorEventsQuerySchema }),
  corridorEventController.list
);
