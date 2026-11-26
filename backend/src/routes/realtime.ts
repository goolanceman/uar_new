/**
 * Realtime routes — /api/realtime/* (GENERIC: shared by web + mobile).
 *
 * Replaces the mobile-only /broadcasting/auth handler and the legacy
 * POST /generateAgoraToken compat endpoint:
 *
 *   POST /auth          Pusher-protocol private-channel authorization
 *                       (legacy /broadcasting/auth — the root alias stays
 *                       mounted in src/index.ts until the legacy cleanup)
 *   POST /agora-token   Agora RTC token for a channel (legacy
 *                       POST /generateAgoraToken); when the channel maps to
 *                       an audio space the caller must be a participant
 *
 * Both validate the session (Bearer JWT via requireAuth/validateSession); the
 * actor is always the session user.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@/lib/db";
import { requireAuth, validateSession, ApiError, json, handleError } from "@/lib/session";
import { channelAuth } from "@/lib/realtime/pusher";
import { buildRtcToken } from "@/lib/realtime/agora";

export const router = Router();

/**
 * POST /api/realtime/auth — Pusher private-channel authorization.
 * websocket_service.dart posts {socket_id, channel_name} with the session
 * Bearer token; the response is {auth: "<appKey>:<hmac>"}. Also exported as
 * broadcastingAuthHandler so src/index.ts can keep the root /broadcasting/auth
 * alias working (same handler, same wire shape).
 */
export async function broadcastingAuthHandler(req: Request, res: Response) {
  try {
    const socketId = req.body?.socket_id;
    const channelName = req.body?.channel_name;
    if (!socketId || !channelName) {
      return res.status(401).json({ error: "Invalid auth request" });
    }
    const session = await validateSession(req);
    if (!session) return res.status(401).json({ error: "Invalid or expired token" });
    return res.json({ auth: channelAuth(socketId, channelName) });
  } catch (e) {
    console.error("[realtime] channel auth failed", e);
    return res.status(500).json({ error: "auth failed" });
  }
}

// POST /api/realtime/auth — the generic path (root /broadcasting/auth stays as
// an alias in src/index.ts until the legacy cleanup).
router.post("/auth", broadcastingAuthHandler);

/**
 * POST /api/realtime/agora-token — Agora RTC dynamic key (legacy
 * SettingsController::generateAgoraToken). Session required. The app names
 * each channel after its audio-space id, so when the channel maps to an
 * existing audio space the caller must be a participant of it; arbitrary
 * channels (1:1 calls, ...) only need a valid session.
 */
router.post("/agora-token", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const channelName = String((req.body ?? {}).channelName ?? "").trim();
    if (!channelName) throw new ApiError("The channel name field is required", 400);

    const space = await db.audioSpace.findUnique({
      where: { id: channelName },
      select: { id: true },
    });
    if (space) {
      const participant = await db.audioSpaceParticipant.findFirst({
        where: { audioSpaceId: space.id, userId: session.userId },
        select: { id: true },
      });
      if (!participant) throw new ApiError("You are not a participant of this audio space", 403);
    }

    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERT;
    if (!appId || !appCertificate) throw new ApiError("Agora is not configured", 500);

    // RolePublisher, privilegeExpiredTs = now + 7200, uid 0 — as in the legacy.
    const expireTs = Math.floor(Date.now() / 1000) + 7200;
    const token = buildRtcToken(appId, appCertificate, channelName, 0, expireTs, "publisher");
    return json(res, { token });
  } catch (e) {
    return handleError(e, res);
  }
});
