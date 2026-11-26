/**
 * Community chat service — conversations, messages, unread counters,
 * mute/clear/delete, realtime broadcast + push notifications. Shared by the
 * generic /api/chat router (web + mobile).
 *
 * Ported 1:1 from the legacy mobile handlers (ChatController.php via
 * src/routes/mobile/chat-audio.ts) onto the generic contract: camelCase wire
 * fields, embedded users via communityAuthor, ApiError failures. The realtime
 * broadcast keeps the exact legacy MessageSent payload — the Pusher-protocol
 * socket frames are their own wire contract, not the REST envelope.
 *
 * Legacy column shapes preserved (Conversation model helpers):
 *   muted_by   JSON {"<uid>": true}                       (mute)
 *   cleared_at JSON {"<uid>": "YYYY-MM-DD HH:MM:SS"}      (clear)
 *   cleared_at JSON {"<uid>": "dYYYY-MM-DD HH:MM:SS"}     (delete = 'd' prefix)
 */
import { db } from "@/lib/db";
import { ApiError } from "@/lib/session";
import { communityAuthor } from "@/lib/community/serializers";
import { sendPush, feedEvent } from "@/lib/community/push";
import { broadcastToChannel } from "@/lib/realtime/pusher";

// ─── Legacy column helpers ────────────────────────────────────────────────────

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

export function msgTypeText(type: number): string {
  return MESSAGE_TYPE_TEXT[type] ?? "sent a message";
}

export const MESSAGE_TYPES = [1, 2, 3, 4, 5, 6, 7];

// ─── Access + read state ──────────────────────────────────────────────────────

type ConversationRef = {
  id: string;
  type: number;
  user1Id: string | null;
  user2Id: string | null;
};

/** Conversation membership check used by every ChatController action. */
export async function hasConversationAccess(
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
export async function markConversationRead(
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

/** Fetch a live (not soft-deleted) conversation. */
export async function findConversation(id: string) {
  return db.conversation.findFirst({ where: { id, deletedAt: null } });
}

/** Load a conversation and enforce the caller's membership. */
export async function requireConversationAccess(id: string, userId: string) {
  const conv = await findConversation(id);
  if (!conv) throw new ApiError("Conversation not found", 404);
  if (!(await hasConversationAccess(conv, userId))) throw new ApiError("Access denied", 403);
  return conv;
}

// ─── Serialization (camelCase) ───────────────────────────────────────────────

type SenderRow = {
  id: string;
  name: string;
  username: string | null;
  avatar: string | null;
  isVerified: number;
  role: string;
};

type MessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  message: string | null;
  type: number;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  isRead: boolean;
  isEdited: boolean;
  replyToMessageId: string | null;
  storyId: string | null;
  createdAt: Date;
  sender: SenderRow;
};

/** Message wire shape — embedded sender via communityAuthor. */
export function messageWire(m: MessageRow) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    message: m.message,
    type: m.type,
    mediaUrl: m.mediaUrl,
    thumbnailUrl: m.thumbnailUrl,
    senderId: m.senderId,
    sender: communityAuthor(m.sender),
    createdAt: m.createdAt.toISOString(),
    isRead: m.isRead,
    isEdited: m.isEdited,
    replyToMessageId: m.replyToMessageId,
    storyId: m.storyId,
  };
}

/**
 * GET /chat/conversations — ChatController::getConversations. Returns the
 * caller's live conversations, newest activity first, with unread counters,
 * mute/block flags and the embedded other user / room link.
 */
export async function listConversations(me: string) {
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
    if (!other) continue; // legacy skipped conversations whose other side is gone

    const unreadCount = conv.user1Id === me ? conv.user1UnreadCount : conv.user2UnreadCount;
    const csvHas = (list: string | null | undefined, id: string) =>
      (list ?? "").split(",").map((s) => s.trim()).includes(id);

    const cleared = String(jsonMap(conv.clearedAt)[me] ?? "");
    if (cleared.startsWith("d")) continue; // 'd'-prefixed = deleted for this user

    conversations.push({
      id: conv.id,
      type: 1,
      title: other.name,
      profileImage: other.avatar,
      lastMessage: conv.lastMessage,
      lastMessageAt: conv.lastMessageAt ? conv.lastMessageAt.toISOString() : null,
      unreadCount,
      isMuted: jsonMap(conv.mutedBy)[me] === true,
      iBlocked: csvHas(meUser?.blockUserIds, other.id),
      iAmBlocked: csvHas(other.blockUserIds, me),
      otherUserId: other.id,
      otherUser: communityAuthor(other),
      createdAt: conv.createdAt.toISOString(),
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
      profileImage: conv.groupPhoto,
      lastMessage: conv.lastMessage,
      lastMessageAt: conv.lastMessageAt ? conv.lastMessageAt.toISOString() : null,
      unreadCount: mine ? mine.unreadCount : 0,
      isMuted: mine ? mine.isMuted : false,
      adminId: conv.adminId,
      participantsCount: conv.participants.filter((p) => p.isActive).length,
      roomId: room ? room.id : null, // room-linked group chats (Room list opens these)
      createdAt: conv.createdAt.toISOString(),
    });
  }

  // Legacy concatenated 1:1 then groups, each by lastMessageAt desc — merge
  // into one newest-first list.
  conversations.sort((a, b) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt as string).getTime() : 0;
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt as string).getTime() : 0;
    return tb - ta;
  });

  return conversations;
}

/**
 * POST /chat/conversations — ChatController::createOrGetConversation
 * (create-or-get 1:1 conversation with {userId}).
 */
export async function createOrGetConversation(me: string, otherUserId: string) {
  if (!otherUserId) throw new ApiError("The userId field is required", 400);
  if (otherUserId === me) throw new ApiError("Cannot create conversation with yourself", 400);

  const other = await db.user.findUnique({ where: { id: otherUserId }, select: { id: true } });
  if (!other) throw new ApiError("User not found", 404);

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
    return { id: existing.id, type: 1, createdAt: existing.createdAt.toISOString(), created: false };
  }

  const conv = await db.conversation.create({
    data: { type: 1, user1Id: me, user2Id: otherUserId },
  });
  return { id: conv.id, type: 1, createdAt: conv.createdAt.toISOString(), created: true };
}

/**
 * GET /chat/conversations/:id/messages — ChatController::getMessages with
 * cursor paging (?before=<messageId>&limit=). Returns a page of messages
 * oldest-first plus the nextCursor (oldest id of the page) when older
 * messages exist. Fetching marks the conversation read for the caller
 * (legacy auto-mark-read).
 */
export async function getMessagesPage(
  me: string,
  conversationId: string,
  beforeId: string | null,
  limit: number
) {
  const conv = await requireConversationAccess(conversationId, me);

  // Messages older than the caller's clear/delete timestamp stay hidden.
  const clearedRaw = String(jsonMap(conv.clearedAt)[me] ?? "").replace("d", "");
  const clearedAfter = parseLegacyTimestamp(clearedRaw);

  let beforeCreatedAt: Date | null = null;
  if (beforeId) {
    const before = await db.message.findUnique({
      where: { id: beforeId },
      select: { createdAt: true },
    });
    if (!before) throw new ApiError("The before message id is invalid", 400);
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
  rows.reverse(); // oldest-first, like the legacy ->get()->reverse()->values()

  await markConversationRead(conv, me);

  return {
    conversationId: conv.id,
    items: rows.map((m) => messageWire(m)),
    // A full page means older messages probably exist — the cursor is the
    // oldest id of this page.
    nextCursor: rows.length === limit && rows.length > 0 ? rows[0].id : null,
  };
}

/**
 * POST /chat/messages or /chat/conversations/:id/messages —
 * ChatController::sendMessage. `store` persists an uploaded multipart file
 * (media/thumbnail) and returns its public URL; inline mediaUrl/thumbnailUrl
 * fields are accepted as-is (the app pre-uploads some media).
 */
export async function sendChatMessage(
  me: string,
  senderName: string,
  opts: {
    conversationId: string;
    message?: string | null;
    type: number;
    mediaFile?: File | null;
    thumbnailFile?: File | null;
    mediaUrl?: string | null;
    thumbnailUrl?: string | null;
    replyToMessageId?: string | null;
    storyId?: string | null;
    store: (file: File) => Promise<string>;
  }
) {
  const { conversationId, type, store } = opts;
  if (!conversationId) throw new ApiError("The conversationId field is required", 400);
  if (!MESSAGE_TYPES.includes(type)) throw new ApiError("The selected type is invalid", 400);

  const messageText = opts.message ?? "";
  // The app also posts plain media URLs as fields (uploadFile pre-uploads,
  // then sendMessage carries mediaUrl/thumbnailUrl) — an image with an empty
  // caption must pass validation like a multipart media did.
  if (!opts.mediaFile && !opts.mediaUrl && !messageText) {
    throw new ApiError("The message field is required when media is not present", 400);
  }

  if (opts.replyToMessageId) {
    const exists = await db.message.findUnique({
      where: { id: opts.replyToMessageId },
      select: { id: true },
    });
    if (!exists) throw new ApiError("The replyToMessageId is invalid", 400);
  }

  const conv = await requireConversationAccess(conversationId, me);

  // Media upload — multipart files take priority; plain URLs are the fallback.
  let mediaUrl: string | null = null;
  let thumbnailUrl: string | null = null;
  if (opts.mediaFile) {
    mediaUrl = await store(opts.mediaFile);
    if (opts.thumbnailFile) thumbnailUrl = await store(opts.thumbnailFile);
  } else {
    mediaUrl = opts.mediaUrl ?? null;
    thumbnailUrl = opts.thumbnailUrl ?? null;
  }

  const message = await db.message.create({
    data: {
      conversationId: conv.id,
      senderId: me,
      message: messageText,
      type,
      mediaUrl,
      thumbnailUrl,
      replyToMessageId: opts.replyToMessageId ?? null,
      storyId: opts.storyId ?? null,
    },
    include: { sender: true },
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
  // the legacy public channel AND on private-conversation.<id>, the channel
  // websocket_service.dart subscribes/authorizes.
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

  // Push notifications — never crash the request (legacy wrapped in try/catch).
  try {
    const title = conv.type === 1 ? senderName : conv.groupName;
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
        await sendPush({ userId: r.id, title: title ?? "", body: messageText || msgTypeText(type), data: pushData });
      }
    }
  } catch (e) {
    console.error("[chat] push failed", e);
  }

  // Admin live feed (existing SSE infra).
  feedEvent("chat.message", { conversation_id: conv.id, sender_id: me, type: message.type });

  return messageWire(message);
}

/** POST /chat/conversations/:id/read — ChatController::markAsRead. */
export async function markRead(me: string, conversationId: string) {
  const conv = await requireConversationAccess(conversationId, me);
  await markConversationRead(conv, me);
  return { ok: true };
}

/** POST /chat/conversations/:id/mute — ChatController::muteConversation. */
export async function muteConversation(me: string, conversationId: string) {
  const conv = await requireConversationAccess(conversationId, me);
  const mutedBy = jsonMap(conv.mutedBy);
  mutedBy[me] = true;
  await db.conversation.update({ where: { id: conv.id }, data: { mutedBy: JSON.stringify(mutedBy) } });
  return { ok: true, isMuted: true };
}

/** DELETE /chat/conversations/:id/mute — ChatController::unmuteConversation. */
export async function unmuteConversation(me: string, conversationId: string) {
  const conv = await findConversation(conversationId);
  if (!conv) throw new ApiError("Conversation not found", 404);

  // Legacy unmute had no membership check — mirror it.
  const mutedBy = jsonMap(conv.mutedBy);
  if (me in mutedBy) {
    delete mutedBy[me];
    await db.conversation.update({ where: { id: conv.id }, data: { mutedBy: JSON.stringify(mutedBy) } });
  }
  return { ok: true, isMuted: false };
}

/** POST /chat/conversations/:id/clear — ChatController::clearConversation. */
export async function clearConversation(me: string, conversationId: string) {
  const conv = await requireConversationAccess(conversationId, me);
  const clearedAt = jsonMap(conv.clearedAt);
  clearedAt[me] = legacyTimestamp();
  await db.conversation.update({ where: { id: conv.id }, data: { clearedAt: JSON.stringify(clearedAt) } });
  return { ok: true };
}

/**
 * DELETE /chat/conversations/:id — ChatController::deleteConversation ('d'
 * prefix on cleared_at for 1:1, deactivate the participant row for groups).
 */
export async function deleteConversation(me: string, conversationId: string) {
  const conv = await findConversation(conversationId);
  if (!conv) throw new ApiError("Conversation not found", 404);

  if (conv.type === 1) {
    if (conv.user1Id !== me && conv.user2Id !== me) {
      throw new ApiError("You are not part of this conversation", 403);
    }
    const clearedAt = jsonMap(conv.clearedAt);
    clearedAt[me] = `d${legacyTimestamp()}`;
    await db.conversation.update({ where: { id: conv.id }, data: { clearedAt: JSON.stringify(clearedAt) } });
  } else {
    const participant = await db.conversationParticipant.findFirst({
      where: { conversationId: conv.id, userId: me },
    });
    if (!participant) throw new ApiError("You are not part of this conversation", 403);
    await db.conversationParticipant.update({
      where: { id: participant.id },
      data: { isActive: false, leftAt: new Date() },
    });
  }

  return { ok: true };
}
