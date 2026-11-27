/**
 * Realtime service — channel authorization rules + Agora token minting.
 * Depends on the repository contract and shared lib domain helpers, throws
 * application errors, never touches HTTP.
 */
import { logger } from "@/infrastructure/logging/logger";
import { channelAuth } from "@/infrastructure/external-services/pusher-server";
import { buildRtcToken } from "@/infrastructure/external-services/agora";
import { findConversation, hasConversationAccess } from "@/domains/community/chat";
import { findSpace, getSpaceParticipant } from "@/domains/community/audio-spaces";
import { ApiError } from "@/shared/errors";
import type { Session } from "@/infrastructure/auth/session";
import type { RealtimeRepository } from "../repositories/realtime.repository.interface";

const log = logger.child("realtime");

export class RealtimeService {
  constructor(private readonly realtimeRepository: RealtimeRepository) {}

  /**
   * Per-channel authorization for POST /auth — a signed session alone must not
   * grant access to ANY private channel. Matches every channel name the
   * backend broadcasts (src/lib/community/*: conversation.<id> public +
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
  async authorizeChannelAccess(userId: string, channelName: string): Promise<boolean> {
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
      const roomRow = await this.realtimeRepository.findRoom(room[1]);
      if (!roomRow) return false;
      if (roomRow.adminId === userId) return true;
      const member = await this.realtimeRepository.findRoomMember(roomRow.id, userId);
      return !!member;
    }

    // Unknown private/presence patterns (presence-* included) are denied.
    return false;
  }

  /**
   * Pusher private-channel authorization signature — {auth: "<appKey>:<hmac>"}.
   * Crypto/signing stays here (byte-identical to the legacy call).
   */
  signChannel(socketId: string, channelName: string): string {
    return channelAuth(socketId, channelName);
  }

  /**
   * Agora RTC dynamic key (legacy SettingsController::generateAgoraToken).
   * The app names each channel after its audio-space id, so when the channel
   * maps to an existing audio space the caller must be a participant of it;
   * arbitrary channels (1:1 calls, ...) only need a valid session.
   */
  async createAgoraToken(channelName: string, actor: Session): Promise<string> {
    const space = await this.realtimeRepository.findSpaceById(channelName);
    if (space) {
      const participant = await this.realtimeRepository.findSpaceParticipant(space.id, actor.userId);
      if (!participant) {
        log.warn("agora_space_participant_required", { channel: channelName, actor: actor.userId });
        throw new ApiError("You are not a participant of this audio space", 403);
      }
    }

    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERT;
    if (!appId || !appCertificate) throw new ApiError("Agora is not configured", 500);

    // RolePublisher, privilegeExpiredTs = now + 7200, uid 0 — as in the legacy.
    const expireTs = Math.floor(Date.now() / 1000) + 7200;
    return buildRtcToken(appId, appCertificate, channelName, 0, expireTs, "publisher");
  }
}
