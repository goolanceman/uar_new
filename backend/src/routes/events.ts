/**
 * Live event stream — /api/events/stream (Server-Sent Events)
 *
 * Gated by the `features.liveDonationFeed` flag in Settings → Feature flags:
 * when the flag is off the endpoint answers 503 and no client connects.
 * The client checks the public settings payload first (which also exposes
 * the flag), so the stream is only opened when the feature is on.
 *
 * Thin endpoint definitions; all logic lives in src/modules/events
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/events`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { validate } from "@/shared/middleware/validate";
import { eventStreamQuerySchema } from "@/modules/events/schemas/event.schema";
import { eventController } from "@/modules/events";

export const router = Router();

// GET /api/events/stream — public, unauthenticated (broadcasts are read-only)
router.get("/stream", validate({ query: eventStreamQuerySchema }), eventController.stream);
