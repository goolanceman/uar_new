/**
 * Mobile compat routes — chat-audio module.
 * Ports the legacy Laravel controllers (see ../index.ts module map):
 *   ChatController        → /chat/*                 (one-to-one + group chat)
 *   AudioSpaceController  → /audio-spaces/*         (Agora voice rooms)
 *   SettingsController    → /generateAgoraToken, /fetchSetting,
 *                           /pushNotificationToSingleUser
 *   FAQsController        → /fetchFAQs
 *
 * Wire contract notes (extracted from the Flutter app + PHP):
 *  - The four "common" endpoints carried only the apikey gate in routes/api.php
 *    (no user auth) — they are intentionally NOT behind mobileAuth.
 *  - ChatController::sendMessage broadcast App\Events\MessageSent ("message.sent"
 *    with broadcastWith payload) on conversation.<id>; websocket_service.dart
 *    subscribes to private-conversation.<id> and parses ChatMessage.fromJson —
 *    so we publish the exact same payload on BOTH channel names.
 *  - muted_by / cleared_at are JSON strings keyed by user id:
 *      muted_by   {"<uid>": true}              (mute)
 *      cleared_at {"<uid>": "YYYY-MM-DD HH:MM:SS"}          (clear)
 *      cleared_at {"<uid>": "dYYYY-MM-DD HH:MM:SS"}         (delete = 'd' prefix)
 *    mirroring the legacy Conversation model helpers.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@/lib/db";
import { multipart, type MulterFile } from "@/lib/multipart";
import {
  ok,
  data,
  fail,
  mobileAuth,
  session,
  params,
  str,
  num,
  optStr,
  bool,
  csvHas,
  storeUpload,
  sendPush,
  feedEvent,
  wrap,
  mobileErrorHandler,
} from "@/lib/mobile/compat";
import { broadcastToChannel } from "@/lib/mobile/pusher";
import { buildRtcToken } from "@/lib/mobile/agora";

export const router = Router();

// ─── Shared helpers ───────────────────────────────────────────────────────────

type ConversationRef = {
  id: string;
  type: number;
  user1Id: string | null;
  user2Id: string | null;
  mutedBy: string | null;
  clearedAt: string | null;
};

/** Parse a legacy JSON-string column (muted_by / cleared_at) into an object. */
function jsonMap(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** now()->toDateTimeString() equivalent ("YYYY-MM-DD HH:MM:SS", UTC). */
function legacyTimestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/** Parse a stored cleared_at timestamp ("YYYY-MM-DD HH:MM:SS") into a Date. */
function parseLegacyTimestamp(raw: string): Date | null {
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ChatController::getMessageTypeText. */
const MESSAGE_TYPE_TEXT: Record<number, string> = {
  1: "sent a message",
  2: "sent an image",
  3: "sent a video",
  4: "sent an audio",
  5: "sent a file",
  6: "sent a location",
  7: "replied to your story",
};

function msgTypeText(type: number): string {
  return MESSAGE_TYPE_TEXT[type] ?? "sent a message";
}

/** Conversation membership check used by every ChatController action. */
async function hasConversationAccess(
  conv: Pick<ConversationRef, "id" | "type" | "user1Id" | "user2Id">,
  userId: string
): Promise<boolean> {
  if (conv.type === 1) return conv.user1Id === userId || conv.user2Id === userId;
  const count = await db.conversationParticipant.count({
    where: { conversationId: conv.id, userId, isActive: true },
  });
  return count > 0;
}

/** Conversation::markAsRead — zeroes the caller's unread counter. */
async function markConversationRead(
  conv: Pick<ConversationRef, "id" | "type" | "user1Id" | "user2Id">,
  userId: string
): Promise<void> {
  if (conv.type === 1) {
    await db.conversation.update({
      where: { id: conv.id },
      data: conv.user1Id === userId ? { user1UnreadCount: 0 } : { user2UnreadCount: 0 },
    });
  } else {
    await db.conversationParticipant.updateMany({
      where: { conversationId: conv.id, userId },
      data: { unreadCount: 0 },
    });
  }
}

/** Grab one uploaded file by its multipart field name (legacy 'media'/'thumbnail'). */
function fileByField(req: Request, field: string): File | null {
  const files = ((req.files ?? []) as unknown as (MulterFile & { fieldname: string })[]) ?? [];
  const f = files.find((x) => x.fieldname === field);
  if (!f) return null;
  return new File([f.buffer], f.originalname, { type: f.mimetype || "application/octet-stream" });
}

// ─── Chat (ChatController) ────────────────────────────────────────────────────

/** GET /chat/conversations — ChatController::getConversations. */
async function getConversations(req: Request, res: Response) {
  const me = session(req).userId;
  const meUser = await db.user.findUnique({ where: { id: me }, select: { blockUserIds: true } });

  const [oneToOne, groups] = await Promise.all([
    db.conversation.findMany({
      where: { type: 1, deletedAt: null, OR: [{ user1Id: me }, { user2Id: me }] },
      include: { user1: true, user2: true },
      orderBy: { lastMessageAt: "desc" },
    }),
    db.conversation.findMany({
      where: { type: 2, deletedAt: null, participants: { some: { userId: me, isActive: true } } },
      include: { participants: { include: { user: true } } },
      orderBy: { lastMessageAt: "desc" },
    }),
  ]);

  const conversations: Array<Record<string, unknown>> = [];

  for (const conv of oneToOne) {
    const other = conv.user1Id === me ? conv.user2 : conv.user1;
    if (!other) continue; // PHP skipped conversations whose other side is gone

    const unreadCount = conv.user1Id === me ? conv.user1UnreadCount : conv.user2UnreadCount;
    const iBlocked = csvHas(meUser?.blockUserIds, other.id);
    const iAmBlocked = csvHas(other.blockUserIds, me);

    const isMuted = jsonMap(conv.mutedBy)[me] === true;

    // 'd'-prefixed cleared_at marks the conversation as deleted for this user.
    const cleared = str(jsonMap(conv.clearedAt)[me]);
    if (cleared.startsWith("d")) continue;

    conversations.push({
      id: conv.id,
      type: 1,
      title: other.name,
      profile_image: other.avatar,
      last_message: conv.lastMessage,
      last_message_at: conv.lastMessageAt ? conv.lastMessageAt.toISOString() : null,
      unread_count: unreadCount,
      is_muted: isMuted,
      i_blocked: iBlocked,
      i_am_blocked: iAmBlocked,
      other_user_id: other.id,
      other_user: {
        id: other.id,
        full_name: other.name,
        username: other.username,
        profile: other.avatar,
        is_verified: other.isVerified,
      },
    });
  }

  for (const conv of groups) {
    const mine = conv.participants.find((p) => p.userId === me);
    const room = await db.communityRoom.findFirst({
      where: { conversationId: conv.id },
      select: { id: true },
    });
    conversations.push({
      id: conv.id,
      type: 2,
      title: conv.groupName,
      profile_image: conv.groupPhoto,
      last_message: conv.lastMessage,
      last_message_at: conv.lastMessageAt ? conv.lastMessageAt.toISOString() : null,
      unread_count: mine ? mine.unreadCount : 0,
      is_muted: mine ? mine.isMuted : false,
      admin_id: conv.adminId,
      participants_count: conv.participants.filter((p) => p.isActive).length,
      room_id: room ? room.id : null, // room-linked group chats (Room list opens these)
    });
  }

  return data(res, "Conversations fetched successfully", conversations);
}

/** GET /chat/conversations/:conversationId/messages — ChatController::getMessages. */
async function getMessages(req: Request, res: Response) {
  const me = session(req).userId;
  const p = params(req);
  const limit = Math.min(100, Math.max(1, num(p.limit, 50)));

  const conv = await db.conversation.findFirst({
    where: { id: req.params.conversationId, deletedAt: null },
  });
  if (!conv) return fail(res, "Conversation not found");
  if (!(await hasConversationAccess(conv, me))) return fail(res, "Access denied");

  // Messages older than the caller's clear/delete timestamp stay hidden.
  const clearedRaw = str(jsonMap(conv.clearedAt)[me]).replace("d", ""); // strip 'd' delete prefix
  const clearedAfter = parseLegacyTimestamp(clearedRaw);

  const beforeId = optStr(p.before_message_id);
  let beforeCreatedAt: Date | null = null;
  if (beforeId) {
    const before = await db.message.findUnique({
      where: { id: beforeId },
      select: { createdAt: true },
    });
    if (!before) return fail(res, "The selected before message id is invalid.");
    beforeCreatedAt = before.createdAt;
  }

  const rows = await db.message.findMany({
    where: {
      conversationId: conv.id,
      isDeleted: false,
      ...(clearedAfter ? { createdAt: { gt: clearedAfter } } : {}),
      ...(beforeCreatedAt ? { createdAt: { lt: beforeCreatedAt } } : {}),
    },
    include: { sender: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  rows.reverse(); // legacy: ->get()->reverse()->values() (oldest first)

  await markConversationRead(conv, me);

  return data(res, "Messages fetched successfully", {
    conversation_id: conv.id,
    messages: rows.map((m) => ({
      id: m.id,
      message: m.message,
      type: m.type,
      media_url: m.mediaUrl,
      thumbnail_url: m.thumbnailUrl,
      sender_id: m.senderId,
      sender: {
        // Legacy snake_case shape...
        id: m.sender.id,
        full_name: m.sender.name,
        username: m.sender.username,
        profile: m.sender.avatar,
        // ...plus the camelCase keys ChatUser.fromJson actually reads
        // (the legacy API only sent snake_case, so the parser nulled them).
        fullName: m.sender.name,
        image: m.sender.avatar,
        userid: m.sender.id,
        is_verified: m.sender.isVerified,
      },
      created_at: m.createdAt.toISOString(),
      is_read: m.isRead,
      is_edited: m.isEdited,
      reply_to_message_id: m.replyToMessageId,
    })),
  });
}

/** POST /chat/messages — ChatController::sendMessage (JSON body or multipart). */
async function sendMessage(req: Request, res: Response) {
  const me = session(req).userId;
  const p = params(req); // multer puts multipart text fields into req.body too

  const conversationId = optStr(p.conversation_id);
  if (!conversationId) return fail(res, "The conversation id field is required.");

  const type = num(p.type, 0);
  if (p.type === undefined || p.type === null || p.type === "") {
    return fail(res, "The type field is required.");
  }
  if (![1, 2, 3, 4, 5, 6, 7].includes(type)) return fail(res, "The selected type is invalid.");

  const mediaFile = fileByField(req, "media");
  const thumbnailFile = fileByField(req, "thumbnail");
  const messageText = optStr(p.message);
  if (!mediaFile && !messageText) {
    return fail(res, "The message field is required when media is not present.");
  }

  const replyToId = optStr(p.reply_to_message_id);
  if (replyToId) {
    const exists = await db.message.findUnique({ where: { id: replyToId }, select: { id: true } });
    if (!exists) return fail(res, "The selected reply to message id is invalid.");
  }
  const storyId = optStr(p.story_id);

  const conv = await db.conversation.findFirst({
    where: { id: conversationId, deletedAt: null },
  });
  if (!conv) return fail(res, "Conversation not found");
  if (!(await hasConversationAccess(conv, me))) return fail(res, "Access denied");

  // Media upload — multipart files take priority (legacy 'media'/'thumbnail'
  // fields via saveFileAndGivePath); the app also posts plain URLs.
  let mediaUrl: string | null = null;
  let thumbnailUrl: string | null = null;
  if (mediaFile) {
    mediaUrl = await storeUpload(req, mediaFile, "mobile/chat");
    if (thumbnailFile) thumbnailUrl = await storeUpload(req, thumbnailFile, "mobile/chat");
  } else {
    mediaUrl = optStr(p.media_url);
    thumbnailUrl = optStr(p.thumbnail_url);
  }

  const message = await db.message.create({
    data: {
      conversationId: conv.id,
      senderId: me,
      message: messageText,
      type,
      mediaUrl,
      thumbnailUrl,
      replyToMessageId: replyToId,
      storyId,
    },
  });

  // Conversation::updateLastMessage
  const lastMessageText = messageText || msgTypeText(type);
  await db.conversation.update({
    where: { id: conv.id },
    data: {
      lastMessage: lastMessageText,
      lastMessageUserId: me,
      lastMessageAt: new Date(),
      ...(conv.type === 1
        ? conv.user1Id === me
          ? { user2UnreadCount: { increment: 1 } }
          : { user1UnreadCount: { increment: 1 } }
        : {}),
    },
  });
  if (conv.type !== 1) {
    await db.conversationParticipant.updateMany({
      where: { conversationId: conv.id, userId: { not: me }, isActive: true },
      data: { unreadCount: { increment: 1 } },
    });
  }

  // Real-time broadcast — MessageSent.php payload, byte-for-byte. Published on
  // the legacy public channel AND on private-conversation.<id>, which is the
  // channel websocket_service.dart actually subscribes/authorizes.
  const broadcastPayload = {
    id: message.id,
    conversation_id: message.conversationId,
    sender_id: message.senderId,
    message: message.message,
    type: message.type,
    media_url: message.mediaUrl,
    thumbnail_url: message.thumbnailUrl,
    reply_to_message_id: message.replyToMessageId,
    created_at: message.createdAt.toISOString(),
  };
  broadcastToChannel(`conversation.${conv.id}`, "message.sent", broadcastPayload);
  broadcastToChannel(`private-conversation.${conv.id}`, "message.sent", broadcastPayload);

  // Push notifications — never crash the request (PHP wrapped these in try/catch).
  try {
    const title = conv.type === 1 ? session(req).name : conv.groupName;
    const body = messageText || msgTypeText(type);
    const pushData = { conversationId: conv.id, messageId: message.id, type: "chat_message" };

    let recipientIds: string[] = [];
    if (conv.type === 1) {
      const otherId = conv.user1Id === me ? conv.user2Id : conv.user1Id;
      recipientIds = otherId ? [otherId] : [];
    } else {
      const rows = await db.conversationParticipant.findMany({
        where: { conversationId: conv.id, userId: { not: me }, isActive: true },
        select: { userId: true },
      });
      recipientIds = rows.map((r) => r.userId);
    }
    if (recipientIds.length) {
      const recipients = await db.user.findMany({
        where: { id: { in: recipientIds }, isPushNotifications: 1 },
        select: { id: true },
      });
      for (const r of recipients) {
        await sendPush({ userId: r.id, title: title ?? "", body, data: pushData });
      }
    }
  } catch (e) {
    console.error("[mobile] chat push failed", e);
  }

  // Admin live feed (existing SSE infra).
  feedEvent("chat.message", { conversation_id: conv.id, sender_id: me, type: message.type });

  return data(res, "Message sent successfully", {
    id: message.id,
    conversation_id: message.conversationId,
    message: message.message,
    type: message.type,
    media_url: message.mediaUrl,
    thumbnail_url: message.thumbnailUrl,
    sender_id: message.senderId,
    created_at: message.createdAt.toISOString(),
    is_read: message.isRead,
    is_edited: message.isEdited,
    reply_to_message_id: message.replyToMessageId,
  });
}

/** POST /chat/conversations — ChatController::createOrGetConversation. */
async function createOrGetConversation(req: Request, res: Response) {
  const me = session(req).userId;
  const otherUserId = optStr(params(req).other_user_id);
  if (!otherUserId) return fail(res, "The other user id field is required.");
  if (otherUserId === me) return fail(res, "Cannot create conversation with yourself");

  const other = await db.user.findUnique({ where: { id: otherUserId }, select: { id: true } });
  if (!other) return fail(res, "The selected other user id is invalid.");

  const existing = await db.conversation.findFirst({
    where: {
      type: 1,
      deletedAt: null,
      OR: [
        { user1Id: me, user2Id: otherUserId },
        { user1Id: otherUserId, user2Id: me },
      ],
    },
  });
  if (existing) {
    return data(res, "Conversation already exists", {
      id: existing.id,
      type: 1,
      created_at: existing.createdAt.toISOString(),
    });
  }

  const conv = await db.conversation.create({
    data: { type: 1, user1Id: me, user2Id: otherUserId },
  });
  return data(res, "Conversation created successfully", {
    id: conv.id,
    type: 1,
    created_at: conv.createdAt.toISOString(),
  });
}

/** POST /chat/conversations/:conversationId/read — ChatController::markAsRead. */
async function markAsRead(req: Request, res: Response) {
  const me = session(req).userId;
  const conv = await db.conversation.findFirst({
    where: { id: req.params.conversationId, deletedAt: null },
  });
  if (!conv) return fail(res, "Conversation not found");
  if (!(await hasConversationAccess(conv, me))) return fail(res, "Access denied");

  await markConversationRead(conv, me);
  return ok(res, "Conversation marked as read");
}

/** POST /chat/conversations/:conversationId/mute — ChatController::muteConversation. */
async function muteConversation(req: Request, res: Response) {
  const me = session(req).userId;
  const conv = await db.conversation.findFirst({
    where: { id: req.params.conversationId, deletedAt: null },
  });
  if (!conv) return fail(res, "Conversation not found");
  if (!(await hasConversationAccess(conv, me))) {
    return fail(res, "You are not part of this conversation");
  }

  const mutedBy = jsonMap(conv.mutedBy);
  mutedBy[me] = true;
  await db.conversation.update({ where: { id: conv.id }, data: { mutedBy: JSON.stringify(mutedBy) } });
  return ok(res, "Conversation muted successfully");
}

/** POST /chat/conversations/:conversationId/unmute — ChatController::unmuteConversation. */
async function unmuteConversation(req: Request, res: Response) {
  const me = session(req).userId;
  const conv = await db.conversation.findFirst({
    where: { id: req.params.conversationId, deletedAt: null },
  });
  if (!conv) return fail(res, "Conversation not found");

  // Legacy unmute had no membership check — mirror it.
  const mutedBy = jsonMap(conv.mutedBy);
  if (me in mutedBy) {
    delete mutedBy[me];
    await db.conversation.update({ where: { id: conv.id }, data: { mutedBy: JSON.stringify(mutedBy) } });
  }
  return ok(res, "Conversation unmuted successfully");
}

/** POST /chat/conversations/:conversationId/clear — ChatController::clearConversation. */
async function clearConversation(req: Request, res: Response) {
  const me = session(req).userId;
  const conv = await db.conversation.findFirst({
    where: { id: req.params.conversationId, deletedAt: null },
  });
  if (!conv) return fail(res, "Conversation not found");
  if (!(await hasConversationAccess(conv, me))) {
    return fail(res, "You are not part of this conversation");
  }

  const clearedAt = jsonMap(conv.clearedAt);
  clearedAt[me] = legacyTimestamp();
  await db.conversation.update({ where: { id: conv.id }, data: { clearedAt: JSON.stringify(clearedAt) } });
  return ok(res, "Conversation cleared successfully");
}

/** DELETE /chat/conversations/:conversationId — ChatController::deleteConversation. */
async function deleteConversation(req: Request, res: Response) {
  const me = session(req).userId;
  const conv = await db.conversation.findFirst({
    where: { id: req.params.conversationId, deletedAt: null },
  });
  if (!conv) return fail(res, "Conversation not found");

  if (conv.type === 1) {
    if (conv.user1Id !== me && conv.user2Id !== me) {
      return fail(res, "You are not part of this conversation");
    }
    // 'd' prefix marks the conversation as deleted for this user.
    const clearedAt = jsonMap(conv.clearedAt);
    clearedAt[me] = `d${legacyTimestamp()}`;
    await db.conversation.update({ where: { id: conv.id }, data: { clearedAt: JSON.stringify(clearedAt) } });
  } else {
    const participant = await db.conversationParticipant.findFirst({
      where: { conversationId: conv.id, userId: me },
    });
    if (!participant) return fail(res, "You are not part of this conversation");
    await db.conversationParticipant.update({
      where: { id: participant.id },
      data: { isActive: false, leftAt: new Date() },
    });
  }

  return ok(res, "Conversation deleted successfully");
}

// ─── Audio spaces (AudioSpaceController) ──────────────────────────────────────

/** AudioSpace::find — soft-delete aware. */
function findSpace(id: string) {
  return db.audioSpace.findFirst({ where: { id, deletedAt: null } });
}

/** AudioSpace::getParticipant — any participant row regardless of is_left. */
function getSpaceParticipant(spaceId: string, userId: string) {
  return db.audioSpaceParticipant.findFirst({ where: { audioSpaceId: spaceId, userId } });
}

type ParticipantWithUser = {
  type: string;
  micStatus: string;
  isLeft: boolean;
  joinedAt: Date | null;
  createdAt: Date;
  user: { id: string; name: string; username: string | null; avatar: string | null; deviceToken: string | null; deviceType: number };
};

/** Legacy participant serialization (identical for active + left users). */
function audioUserShape(p: ParticipantWithUser) {
  return {
    id: p.user.id,
    full_name: p.user.name,
    username: p.user.username,
    profile: p.user.avatar,
    device_token: p.user.deviceToken ?? "",
    device_type: p.user.deviceType ?? 0,
    type: p.type,
    mic_status: p.micStatus,
    created_at: (p.joinedAt ?? p.createdAt).toISOString(),
  };
}

/** Legacy space serialization (getAudioSpaces / getAudioSpace / create). */
function spaceShape(
  space: { id: string; title: string | null; description: string | null; topics: string | null; type: string; agoraToken: string | null; createdAt: Date },
  participants: ParticipantWithUser[]
) {
  return {
    id: space.id,
    title: space.title,
    description: space.description,
    topics: space.topics,
    type: space.type,
    token: space.agoraToken ?? "",
    created_at: space.createdAt.toISOString(),
    users: participants.filter((p) => !p.isLeft).map(audioUserShape),
    leaved_users: participants.filter((p) => p.isLeft).map(audioUserShape),
  };
}

const PARTICIPANT_TYPES = ["admin", "host", "listener", "requested", "added", "kicked_out"];

/** GET /audio-spaces — AudioSpaceController::getAudioSpaces. */
async function getAudioSpaces(req: Request, res: Response) {
  const me = session(req).userId;
  const spaces = await db.audioSpace.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      OR: [{ type: "public" }, { participants: { some: { userId: me } } }],
    },
    include: { participants: { include: { user: true } } },
    orderBy: { createdAt: "desc" },
  });
  return data(res, "Audio spaces fetched successfully", spaces.map((s) => spaceShape(s, s.participants)));
}

/** GET /audio-spaces/:id — AudioSpaceController::getAudioSpace. */
async function getAudioSpace(req: Request, res: Response) {
  const me = session(req).userId;
  const space = await findSpace(req.params.id);
  if (!space) return fail(res, "Audio space not found");

  const participants = await db.audioSpaceParticipant.findMany({
    where: { audioSpaceId: space.id },
    include: { user: true },
  });
  if (space.type === "private" && !participants.some((p) => p.userId === me)) {
    return fail(res, "Access denied");
  }
  return data(res, "Audio space fetched successfully", spaceShape(space, participants));
}

/** POST /audio-spaces — AudioSpaceController::createAudioSpace (client-supplied UUID id). */
async function createAudioSpace(req: Request, res: Response) {
  const p = params(req);

  const id = optStr(p.id);
  if (!id) return fail(res, "The id field is required.");
  if (id.length > 100) return fail(res, "The id may not be greater than 100 characters.");
  if (await db.audioSpace.findUnique({ where: { id }, select: { id: true } })) {
    return fail(res, "The id has already been taken.");
  }

  const type = str(p.type).toLowerCase();
  if (type !== "public" && type !== "private") return fail(res, "The selected type is invalid.");

  const agoraToken = optStr(p.agora_token);
  if (agoraToken && agoraToken.length > 512) {
    return fail(res, "The agora token may not be greater than 512 characters.");
  }

  if (!Array.isArray(p.users) || p.users.length === 0) return fail(res, "The users field is required.");
  const usersData = p.users as Array<Record<string, unknown>>;

  // Bad participant ids would fail the FK — reject up front (PHP: 500 path).
  for (const u of usersData) {
    const uid = optStr(u?.id);
    if (!uid) return fail(res, "Failed to create audio space");
    const exists = await db.user.findUnique({ where: { id: uid }, select: { id: true } });
    if (!exists) return fail(res, "Failed to create audio space");
  }

  const space = await db.audioSpace.create({
    data: {
      id,
      title: optStr(p.title),
      description: optStr(p.description),
      topics: optStr(p.topics),
      type,
      agoraToken,
      isActive: true,
    },
  });

  const users: Array<Record<string, unknown>> = [];
  for (const u of usersData) {
    const participant = await db.audioSpaceParticipant.create({
      data: {
        audioSpaceId: space.id,
        userId: str(u.id),
        type: optStr(u.type) ?? "listener",
        micStatus: optStr(u.mic_status) ?? "muted",
        isLeft: false,
        joinedAt: new Date(),
      },
      include: { user: true },
    });
    users.push(audioUserShape(participant));
  }

  feedEvent("audio_space.created", { id: space.id, type: space.type });

  return res.status(201).json({
    status: true,
    message: "Audio space created successfully",
    data: {
      id: space.id,
      title: space.title,
      description: space.description,
      topics: space.topics,
      type: space.type,
      token: space.agoraToken ?? "",
      created_at: space.createdAt.toISOString(),
      users,
      leaved_users: [],
    },
  });
}

/** PUT /audio-spaces/:id — AudioSpaceController::updateAudioSpace (admin only). */
async function updateAudioSpace(req: Request, res: Response) {
  const me = session(req).userId;
  const p = params(req);

  const space = await findSpace(req.params.id);
  if (!space) return fail(res, "Audio space not found");

  const myParticipant = await getSpaceParticipant(space.id, me);
  if (!myParticipant || myParticipant.type !== "admin") {
    return fail(res, "Only admins can update the audio space");
  }

  if (!Array.isArray(p.users) || p.users.length === 0) return fail(res, "The users field is required.");
  const usersData = p.users as Array<Record<string, unknown>>;

  for (const u of usersData) {
    const uid = optStr(u?.id);
    if (!uid) return fail(res, "Failed to update audio space");
    const participant = await getSpaceParticipant(space.id, uid);
    if (participant) {
      const isLeft = u.is_left === undefined ? participant.isLeft : bool(u.is_left);
      await db.audioSpaceParticipant.update({
        where: { id: participant.id },
        data: {
          type: optStr(u.type) ?? participant.type,
          micStatus: optStr(u.mic_status) ?? participant.micStatus,
          isLeft,
          ...(bool(u.is_left) ? { leftAt: new Date() } : {}),
        },
      });
    } else {
      await db.audioSpaceParticipant.create({
        data: {
          audioSpaceId: space.id,
          userId: uid,
          type: optStr(u.type) ?? "listener",
          micStatus: optStr(u.mic_status) ?? "muted",
          isLeft: bool(u.is_left),
          joinedAt: new Date(),
          ...(bool(u.is_left) ? { leftAt: new Date() } : {}),
        },
      });
    }
  }

  return ok(res, "Audio space updated successfully");
}

/** DELETE /audio-spaces/:id — AudioSpaceController::deleteAudioSpace (admin only). */
async function deleteAudioSpace(req: Request, res: Response) {
  const me = session(req).userId;
  const space = await findSpace(req.params.id);
  if (!space) return fail(res, "Audio space not found");

  const myParticipant = await getSpaceParticipant(space.id, me);
  if (!myParticipant || myParticipant.type !== "admin") {
    return fail(res, "Only admins can end the audio space");
  }

  // AudioSpace::endSpace() + soft delete.
  await db.audioSpace.update({
    where: { id: space.id },
    data: { isActive: false, endedAt: new Date(), deletedAt: new Date() },
  });
  return ok(res, "Audio space ended successfully");
}

/** POST /audio-spaces/:id/join — AudioSpaceController::joinAudioSpace. */
async function joinAudioSpace(req: Request, res: Response) {
  const me = session(req).userId;
  const space = await findSpace(req.params.id);
  if (!space || !space.isActive) return fail(res, "Audio space not found or inactive");

  const participant = await getSpaceParticipant(space.id, me);
  if (participant && !participant.isLeft) return ok(res, "Already in audio space");

  if (participant) {
    // Rejoin.
    await db.audioSpaceParticipant.update({
      where: { id: participant.id },
      data: { isLeft: false, leftAt: null, joinedAt: new Date() },
    });
  } else {
    await db.audioSpaceParticipant.create({
      data: {
        audioSpaceId: space.id,
        userId: me,
        type: "listener",
        micStatus: "muted",
        isLeft: false,
        joinedAt: new Date(),
      },
    });
  }
  return ok(res, "Joined audio space successfully");
}

/** POST /audio-spaces/:id/leave — AudioSpaceController::leaveAudioSpace. */
async function leaveAudioSpace(req: Request, res: Response) {
  const me = session(req).userId;
  const space = await findSpace(req.params.id);
  if (!space) return fail(res, "Audio space not found");

  const participant = await getSpaceParticipant(space.id, me);
  if (!participant || participant.isLeft) return fail(res, "You are not in this audio space");

  // AudioSpaceParticipant::leave()
  await db.audioSpaceParticipant.update({
    where: { id: participant.id },
    data: { isLeft: true, leftAt: new Date() },
  });
  return ok(res, "Left audio space successfully");
}

/** POST /audio-spaces/:id/participants/:userId/type — changeParticipantType. */
async function changeParticipantType(req: Request, res: Response) {
  const me = session(req).userId;
  const p = params(req);

  const type = str(p.type).toLowerCase();
  if (p.type === undefined || p.type === null || p.type === "") {
    return fail(res, "The type field is required.");
  }
  if (!PARTICIPANT_TYPES.includes(type)) return fail(res, "The selected type is invalid.");

  const space = await findSpace(req.params.id);
  if (!space) return fail(res, "Audio space not found");

  const myParticipant = await getSpaceParticipant(space.id, me);
  if (!myParticipant || myParticipant.type !== "admin") {
    return fail(res, "Only admins can change participant types");
  }

  const participant = await getSpaceParticipant(space.id, req.params.userId);
  if (!participant) return fail(res, "User is not in this audio space");

  await db.audioSpaceParticipant.update({ where: { id: participant.id }, data: { type } });
  return ok(res, "Participant type changed successfully");
}

/** POST /audio-spaces/:id/participants/:userId/mic — toggleParticipantMic. */
async function toggleParticipantMic(req: Request, res: Response) {
  const me = session(req).userId;
  const p = params(req);

  const micStatus = str(p.mic_status).toLowerCase();
  if (p.mic_status === undefined || p.mic_status === null || p.mic_status === "") {
    return fail(res, "The mic status field is required.");
  }
  if (!["on", "muted"].includes(micStatus)) return fail(res, "The selected mic status is invalid.");

  const space = await findSpace(req.params.id);
  if (!space) return fail(res, "Audio space not found");

  const participant = await getSpaceParticipant(space.id, req.params.userId);
  if (!participant) return fail(res, "User is not in this audio space");

  // Self or admin only.
  if (req.params.userId !== me) {
    const myParticipant = await getSpaceParticipant(space.id, me);
    if (!myParticipant || myParticipant.type !== "admin") {
      return fail(res, "Only admins can toggle other users' mics");
    }
  }

  await db.audioSpaceParticipant.update({
    where: { id: participant.id },
    data: { micStatus },
  });
  return ok(res, "Mic status updated successfully");
}

/** POST /audio-spaces/:id/participants/:userId/kick — kickParticipant. */
async function kickParticipant(req: Request, res: Response) {
  const me = session(req).userId;
  const space = await findSpace(req.params.id);
  if (!space) return fail(res, "Audio space not found");

  const myParticipant = await getSpaceParticipant(space.id, me);
  if (!myParticipant || myParticipant.type !== "admin") {
    return fail(res, "Only admins can kick participants");
  }

  const participant = await getSpaceParticipant(space.id, req.params.userId);
  if (!participant) return fail(res, "User is not in this audio space");

  // changeType('kicked_out') + leave().
  await db.audioSpaceParticipant.update({
    where: { id: participant.id },
    data: { type: "kicked_out", isLeft: true, leftAt: new Date() },
  });
  return ok(res, "Participant kicked successfully");
}

/** GET /audio-spaces/:id/messages — AudioSpaceController::getMessages. */
async function getAudioSpaceMessages(req: Request, res: Response) {
  const me = session(req).userId;
  const space = await findSpace(req.params.id);
  if (!space) return fail(res, "Audio space not found");

  // hasParticipant: any participant row, even one that left.
  if (!(await getSpaceParticipant(space.id, me))) return fail(res, "Access denied");

  const limit = Math.min(1000, Math.max(1, num(params(req).limit, 100)));
  const rows = await db.audioSpaceMessage.findMany({
    where: { audioSpaceId: space.id },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  rows.reverse(); // legacy: ->get()->reverse()->values() (oldest first)

  return data(res, "Messages fetched successfully", rows.map((m) => ({
    id: m.id,
    content: m.content,
    user_id: m.userId,
    user: {
      id: m.user.id,
      full_name: m.user.name,
      username: m.user.username,
      profile: m.user.avatar,
    },
    time: m.createdAt.toISOString(),
  })));
}

/** POST /audio-spaces/:id/messages — AudioSpaceController::sendMessage. */
async function sendAudioSpaceMessage(req: Request, res: Response) {
  const me = session(req).userId;
  const p = params(req);

  const id = optStr(p.id);
  if (!id) return fail(res, "The id field is required.");
  if (id.length > 100) return fail(res, "The id may not be greater than 100 characters.");
  if (await db.audioSpaceMessage.findUnique({ where: { id }, select: { id: true } })) {
    return fail(res, "The id has already been taken.");
  }
  const content = optStr(p.content);
  if (!content) return fail(res, "The content field is required.");

  const space = await findSpace(req.params.id);
  if (!space || !space.isActive) return fail(res, "Audio space not found or inactive");

  const participant = await getSpaceParticipant(space.id, me);
  if (!participant || participant.isLeft) return fail(res, "You are not in this audio space");

  const message = await db.audioSpaceMessage.create({
    data: { id, audioSpaceId: space.id, userId: me, content },
  });

  // The legacy controller only persisted — no websocket broadcast here.
  feedEvent("audio_space.message", { space_id: space.id, user_id: me });

  const meUser = await db.user.findUnique({ where: { id: me } });
  return res.status(201).json({
    status: true,
    message: "Message sent successfully",
    data: {
      id: message.id,
      content: message.content,
      user_id: me,
      user: {
        id: me,
        full_name: meUser?.name ?? null,
        username: meUser?.username ?? null,
        profile: meUser?.avatar ?? null,
      },
      time: message.createdAt.toISOString(),
    },
  });
}

// ─── Common (SettingsController / FAQsController) ────────────────────────────
// Legacy routes/api.php protected these with the apikey gate ONLY — no user
// auth — so they are deliberately not behind mobileAuth.

/** POST /generateAgoraToken — SettingsController::generateAgoraToken. */
async function generateAgoraToken(req: Request, res: Response) {
  const channelName = optStr(params(req).channelName);
  if (!channelName) return fail(res, "The channel name field is required.");

  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERT;
  if (!appId || !appCertificate) return fail(res, "Agora is not configured");

  // RolePublisher, privilegeExpiredTs = now + 7200, uid 0 — as in the PHP.
  const expireTs = Math.floor(Date.now() / 1000) + 7200;
  const token = buildRtcToken(appId, appCertificate, channelName, 0, expireTs, "publisher");
  return ok(res, "generated successfully", { token });
}

/**
 * POST /fetchSetting — SettingsController::fetchSetting.
 * Reads the "mobile.app" Setting KV row (JSON) and nests the related lists the
 * Flutter Settings model parses: interests (+totalRoomOfInterest), documentType
 * (from the "mobile.documentTypes" KV row), reportReasons, restrictedUsernames.
 */
async function fetchSetting(req: Request, res: Response) {
  const row = await db.setting.findUnique({ where: { key: "mobile.app" } });
  if (!row) return fail(res, "Settings not configured");

  let settings: Record<string, unknown>;
  try {
    const parsed = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    settings = parsed;
  } catch {
    return fail(res, "Settings not configured");
  }

  const [interests, reasons, restrictions, docTypesRow] = await Promise.all([
    db.communityInterest.findMany({ orderBy: { id: "asc" } }),
    db.reportReason.findMany({ orderBy: { id: "asc" } }),
    db.usernameRestriction.findMany({ orderBy: { id: "asc" } }),
    db.setting.findUnique({ where: { key: "mobile.documentTypes" } }),
  ]);

  let documentType: Array<Record<string, unknown>> = [];
  try {
    const docs = JSON.parse(docTypesRow?.value ?? "[]");
    if (Array.isArray(docs)) {
      documentType = docs.map((t, i) => ({ id: i, title: str(t), created_at: null, updated_at: null }));
    }
  } catch {
    // missing/corrupt KV row → empty list
  }

  return data(res, "Fetch Setting", {
    ...settings,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    interests: interests.map((i) => ({
      id: i.id,
      title: i.title,
      created_at: i.createdAt.toISOString(),
      updated_at: i.updatedAt.toISOString(),
      totalRoomOfInterest: 0,
    })),
    documentType,
    reportReasons: reasons.map((r) => ({
      id: r.id,
      title: r.title,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    })),
    restrictedUsernames: restrictions.map((r) => ({
      id: r.id,
      title: r.title,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    })),
  });
}

/**
 * POST /pushNotificationToSingleUser — SettingsController::pushNotificationToSingleUser.
 * The Flutter caller posts a raw FCM-v1-shaped body ({message:{token|topic,
 * notification, data}}) and ignores the response; here it is mapped onto
 * sendPush() so the row lands in the shared Notification stream and FCM
 * delivery happens when configured. Accepts an explicit user_id too.
 */
async function pushNotificationToSingleUser(req: Request, res: Response) {
  try {
    const p = params(req);
    const fcmMessage =
      p.message && typeof p.message === "object" && !Array.isArray(p.message)
        ? (p.message as Record<string, unknown>)
        : null;
    const notif =
      fcmMessage?.notification && typeof fcmMessage.notification === "object"
        ? (fcmMessage.notification as Record<string, unknown>)
        : null;
    const dataPayload =
      fcmMessage?.data && typeof fcmMessage.data === "object"
        ? (fcmMessage.data as Record<string, unknown>)
        : null;

    // Resolve the recipient: explicit user_id, else the device token in the
    // FCM payload (fcm/apns/legacy device columns).
    let userId = optStr(p.user_id ?? p.userId);
    if (!userId && typeof fcmMessage?.token === "string") {
      const token = fcmMessage.token;
      const user = await db.user.findFirst({
        where: { OR: [{ fcmToken: token }, { apnsToken: token }, { deviceToken: token }] },
        select: { id: true },
      });
      userId = user?.id ?? null;
    }

    if (!userId) {
      return res.json({
        status: false,
        message: "FCM Send Error",
        error: "No recipient user resolved from the request",
      });
    }

    const row = await sendPush({
      userId,
      title: str(notif?.title ?? dataPayload?.title ?? p.title),
      body: str(notif?.body ?? dataPayload?.body ?? p.body),
      data: dataPayload ?? null,
    });

    return ok(res, "Push Notification Sent Successfully", {
      result: { notification_id: row.id, sent_via: row.sentVia },
      fields: p,
    });
  } catch (e) {
    console.error("[mobile] pushNotificationToSingleUser failed", e);
    return res.json({
      status: false,
      message: "FCM Send Error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** POST /fetchFAQs — FAQsController::fetchFAQs (FAQ types with nested faqs). */
async function fetchFAQs(_req: Request, res: Response) {
  const types = await db.faqType.findMany({
    where: { isDeleted: 0 },
    include: { faqs: true },
    orderBy: { id: "asc" },
  });

  return data(res, "Fetching FAQs successfully", types.map((t) => ({
    id: t.id,
    title: t.title,
    is_deleted: t.isDeleted,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
    faqs: t.faqs.map((f) => ({
      id: f.id,
      faqs_type_id: f.faqsTypeId,
      question: f.question,
      answer: f.answer,
      created_at: f.createdAt.toISOString(),
      updated_at: f.updatedAt.toISOString(),
    })),
  })));
}

// ─── Route table ──────────────────────────────────────────────────────────────

// Auth — every /chat/* and /audio-spaces/* route carried checkHeader + AuthorUser
// in routes/api.php, so apply it as group middleware (mobileAuth short-circuits
// with 401 when the authtoken is missing/expired).
router.use("/chat", mobileAuth);
router.use("/audio-spaces", mobileAuth);

// Chat
wrap(router, "get", "/chat/conversations", getConversations);
wrap(router, "get", "/chat/conversations/:conversationId/messages", getMessages);
router.post("/chat/messages", multipart, (req, res) =>
  sendMessage(req, res).catch((e) => mobileErrorHandler(e, res))
);
wrap(router, "post", "/chat/conversations", createOrGetConversation);
wrap(router, "post", "/chat/conversations/:conversationId/read", markAsRead);
wrap(router, "post", "/chat/conversations/:conversationId/mute", muteConversation);
wrap(router, "post", "/chat/conversations/:conversationId/unmute", unmuteConversation);
wrap(router, "post", "/chat/conversations/:conversationId/clear", clearConversation);
wrap(router, "delete", "/chat/conversations/:conversationId", deleteConversation);

// Audio spaces
wrap(router, "get", "/audio-spaces", getAudioSpaces);
wrap(router, "get", "/audio-spaces/:id", getAudioSpace);
wrap(router, "post", "/audio-spaces", createAudioSpace);
wrap(router, "put", "/audio-spaces/:id", updateAudioSpace);
wrap(router, "delete", "/audio-spaces/:id", deleteAudioSpace);
wrap(router, "post", "/audio-spaces/:id/join", joinAudioSpace);
wrap(router, "post", "/audio-spaces/:id/leave", leaveAudioSpace);
wrap(router, "post", "/audio-spaces/:id/participants/:userId/type", changeParticipantType);
wrap(router, "post", "/audio-spaces/:id/participants/:userId/mic", toggleParticipantMic);
wrap(router, "post", "/audio-spaces/:id/participants/:userId/kick", kickParticipant);
wrap(router, "get", "/audio-spaces/:id/messages", getAudioSpaceMessages);
wrap(router, "post", "/audio-spaces/:id/messages", sendAudioSpaceMessage);

// Common (apikey gate only — legacy had no user auth on these)
wrap(router, "post", "/generateAgoraToken", generateAgoraToken);
wrap(router, "post", "/fetchSetting", fetchSetting);
wrap(router, "post", "/pushNotificationToSingleUser", pushNotificationToSingleUser);
wrap(router, "post", "/fetchFAQs", fetchFAQs);
