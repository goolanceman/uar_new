/**
 * Realtime routes — /api/realtime/* (GENERIC: shared by web + mobile).
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
 * Both validate the session (Bearer JWT via requireAuth/validateSession); the
 * actor is always the session user.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@/lib/db";
import { requireAuth, validateSession, ApiError, json, handleError } from "@/lib/session";
import { channelAuth } from "@/lib/realtime/pusher";
import { buildRtcToken } from "@/lib/realtime/agora";
import { findConversation, hasConversationAccess } from "@/lib/community/chat";
import { findSpace, getSpaceParticipant } from "@/lib/community/audio-spaces";
import { logger } from "@/lib/logger";

const log = logger.child("realtime");

export const router = Router();

/**
 * Per-channel authorization for POST /auth — a signed session alone must not
 * grant access to ANY private channel. Matches every channel name the backend
 * broadcasts (src/lib/community/*: conversation.<id> public +
 * private-conversation.<id>) and the ones the Flutter app subscribes to:
 *   private-conversation.<id>          → active conversation participant
 *   private-user.<id> / private-App.Models.User.<id>
 *                                      → the session user's own channel
 *   private-audio-space.<id>           → public spaces anyone, private spaces
 *                                        participants only (same privacy rule
 *                                        as GET /audio-spaces/:id)
 *   private-room.<id>                  → room admin or member
 * Public (non-private/presence) channels need no auth; any unknown
 * private/presence pattern is denied.
 */
async function authorizeChannelAccess(userId: string, channelName: string): Promise<boolean> {
  if (!channelName.startsWith("private-") && !channelName.startsWith("presence-")) return true;

  // User-scoped channels — a user may only subscribe to their own.
  const userChannel = channelName.match(/^private-(?:user|App\.Models\.User)\.(.+)$/);
  if (userChannel) return userChannel[1] === userId;

  // 1:1 (user_1/user_2) and group (active ConversationParticipant) chats.
  const conversation = channelName.match(/^private-conversation\.(.+)$/);
  if (conversation) {
    const conv = await findConversation(conversation[1]);
    if (!conv) return false;
    return hasConversationAccess(conv, userId);
  }

  // Audio spaces — the space id is the channel; private spaces gate on the
  // participant rows, public spaces follow the listing/detail visibility rule.
  const audioSpace = channelName.match(/^private-audio-space\.(.+)$/);
  if (audioSpace) {
    const space = await findSpace(audioSpace[1]);
    if (!space) return false;
    if (space.type !== "private") return true;
    return !!(await getSpaceParticipant(space.id, userId));
  }

  // Community rooms — the admin or any member row.
  const room = channelName.match(/^private-room\.(.+)$/);
  if (room) {
    const roomRow = await db.communityRoom.findUnique({
      where: { id: room[1] },
      select: { id: true, adminId: true },
    });
    if (!roomRow) return false;
    if (roomRow.adminId === userId) return true;
    const member = await db.communityRoomUser.findFirst({
      where: { roomId: roomRow.id, userId },
      select: { id: true },
    });
    return !!member;
  }

  // Unknown private/presence patterns (presence-* included) are denied.
  return false;
}

/**
 * POST /api/realtime/auth — Pusher private-channel authorization.
 * websocket_service.dart posts {socket_id, channel_name} with the session
 * Bearer token; the response is {auth: "<appKey>:<hmac>"}. The channel name
 * is authorized per type (see authorizeChannelAccess) before signing — a
 * valid session alone does NOT grant every private channel.
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
    if (!(await authorizeChannelAccess(session.userId, channelName))) {
      log.warn("channel_access_denied", { channel: channelName, actor: session.userId });
      return res.status(403).json({ error: "Channel access denied" });
    }
    return res.json({ auth: channelAuth(socketId, channelName) });
  } catch (e) {
    log.error("channel_auth_failed", {
      error: e instanceof Error ? e : String(e),
      channel: String(req.body?.channel_name ?? ""),
    });
    return res.status(500).json({ error: "auth failed" });
  }
}

// POST /api/realtime/auth — Pusher channel authorization.
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
      if (!participant) {
        log.warn("agora_space_participant_required", { channel: channelName, actor: session.userId });
        throw new ApiError("You are not a participant of this audio space", 403);
      }
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
