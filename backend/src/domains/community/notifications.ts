/**
 * Community notifications service — the saved-notification feed shared by the
 * generic /api/notifications router (web + mobile).
 *
 * Ported from the legacy mobile handler (fetchUserNotification): a merge of
 * SavedNotification rows (follows, likes, comments, rooms, reels) and chat
 * push rows (Notification rows written by sendPush with data.type =
 * "chat_message"). Stories/posts/rooms/reels belong to other slices — only
 * their ids are embedded for now.
 */
import { db } from "@/infrastructure/database/prisma";
import { communityAuthor, communityUserSelect } from "@/domains/community/serializers";

/**
 * Wire type for chat-message notifications — SavedNotification types use 1-10
 * (see the SavedNotification model comment), so chat pushes take the next slot.
 */
export const CHAT_NOTIFICATION_TYPE = 11;

type FeedItem = Record<string, unknown> & { createdAt: string };

/** One merged, newest-first page of the notification feed for [myUserId]. */
export async function communityNotificationFeed(myUserId: string, skip: number, take: number) {
  const window = skip + take;
  const [rows, chatRows] = await Promise.all([
    db.savedNotification.findMany({
      where: { myUserId },
      orderBy: { createdAt: "desc" },
      take: window,
    }),
    // Chat pushes are Notification rows (type MOBILE, data.type = "chat_message")
    // written by sendPush — pull the newest window of them too.
    db.notification.findMany({
      where: { userId: myUserId, type: "MOBILE", data: { contains: '"type":"chat_message"' } },
      orderBy: { createdAt: "desc" },
      take: window,
    }),
  ]);

  const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
  const [users, rooms] = await Promise.all([
    userIds.length
      ? db.user.findMany({ where: { id: { in: userIds } }, select: communityUserSelect })
      : Promise.resolve([]),
    // Room/post/reel resources belong to other slices — ids only for now.
    (async () => {
      const roomIds = [...new Set(rows.map((r) => r.roomId).filter((v): v is string => !!v))];
      return roomIds.length
        ? db.communityRoom.findMany({ where: { id: { in: roomIds } }, select: { id: true, title: true } })
        : [];
    })(),
  ]);
  const userMap = new Map(users.map((u) => [u.id, communityAuthor(u)]));
  const roomMap = new Map(rooms.map((r) => [r.id, { id: r.id, title: r.title }]));

  const savedFeed: FeedItem[] = rows.map((r) => ({
    id: r.id,
    myUserId: r.myUserId,
    userId: r.userId,
    postId: r.postId,
    roomId: r.roomId,
    commentId: r.commentId,
    reelId: r.reelId,
    reelCommentId: r.reelCommentId,
    type: r.type,
    createdAt: r.createdAt.toISOString(),
    user: r.userId ? (userMap.get(r.userId) ?? null) : null,
    room: r.roomId ? (roomMap.get(r.roomId) ?? null) : null,
    post: null, // posts are served by the posts slice
    reel: null, // reels are served by the reels slice
  }));

  const chatParsed = chatRows
    .map((r) => {
      try {
        return { row: r, data: JSON.parse(r.data ?? "null") as { type?: string; conversationId?: string; messageId?: string } | null };
      } catch {
        return { row: r, data: null };
      }
    })
    .filter(
      (x): x is { row: (typeof chatRows)[number]; data: { type: string; conversationId: string; messageId: string } } =>
        x.data?.type === "chat_message" && !!x.data.conversationId && !!x.data.messageId
    );

  const messageIds = [...new Set(chatParsed.map((x) => x.data.messageId))];
  const conversationIds = [...new Set(chatParsed.map((x) => x.data.conversationId))];
  const [messages, conversations] = await Promise.all([
    messageIds.length
      ? db.message.findMany({ where: { id: { in: messageIds } }, select: { id: true, senderId: true } })
      : Promise.resolve([]),
    conversationIds.length
      ? db.conversation.findMany({ where: { id: { in: conversationIds } }, select: { id: true, deletedAt: true } })
      : Promise.resolve([]),
  ]);
  const messageMap = new Map(messages.map((m) => [m.id, m]));
  const aliveConversations = new Set(conversations.filter((c) => !c.deletedAt).map((c) => c.id));
  const senderIds = [...new Set(messages.map((m) => m.senderId))];
  const senders = senderIds.length
    ? await db.user.findMany({ where: { id: { in: senderIds } }, select: communityUserSelect })
    : [];
  const senderMap = new Map(senders.map((u) => [u.id, communityAuthor(u)]));

  const chatFeed: FeedItem[] = chatParsed.flatMap((x) => {
    if (!aliveConversations.has(x.data.conversationId)) return []; // conversation deleted → hide
    const msg = messageMap.get(x.data.messageId);
    const sender = msg ? senderMap.get(msg.senderId) : undefined;
    if (!msg || !sender) return [];
    return [
      {
        id: x.row.id,
        myUserId,
        userId: msg.senderId,
        postId: null,
        roomId: null,
        commentId: null,
        reelId: null,
        reelCommentId: null,
        type: CHAT_NOTIFICATION_TYPE,
        createdAt: x.row.createdAt.toISOString(),
        user: sender,
        post: null,
        room: null,
        reel: null,
        conversationId: x.data.conversationId,
        messageId: x.data.messageId,
        notificationId: x.row.id,
        message: x.row.message,
      },
    ];
  });

  return [...savedFeed, ...chatFeed]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(skip, skip + take);
}
