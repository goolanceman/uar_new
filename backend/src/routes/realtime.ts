/**
 * Realtime routes — /api/realtime/* (GENERIC: shared by web + mobile).
 * Thin endpoint definitions; all logic lives in src/modules/realtime
 * (routes → controllers → services → repositories).
 *
 * Replaces the mobile-only /broadcasting/auth handler and the legacy
 * POST /generateAgoraToken compat endpoint:
 *
 *   POST /auth          Pusher-protocol private-channel authorization
 *                       (replaces the retired legacy /broadcasting/auth)
 *   POST /agora-token   Agora RTC token for a channel (legacy
 *                       POST /generateAgoraToken); when the channel maps to
 *                       an audio space the caller must be a participant
 *
 * Both validate the session (Bearer [redacted] via validateSession/requireAuth); the
 * actor is always the session user. POST /auth performs its own inline
 * session + field checks (its 401/403 bodies are part of the Pusher client
 * contract), so no auth/validate middleware runs ahead of it.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { agoraTokenSchema } from "@/modules/realtime/schemas/realtime.schema";
import { realtimeController } from "@/modules/realtime";

export const router = Router();

// POST /api/realtime/auth — Pusher channel authorization (form-urlencoded
// bodies from the Flutter PusherChannelAuthorizer are parsed app-wide).
router.post("/auth", realtimeController.broadcastingAuth);

// POST /api/realtime/agora-token — Agora RTC dynamic key (legacy
// SettingsController::generateAgoraToken).
router.post("/agora-token", authenticate, validate({ body: agoraTokenSchema }), realtimeController.agoraToken);
