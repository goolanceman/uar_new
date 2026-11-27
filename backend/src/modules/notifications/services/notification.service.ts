/**
 * Notification service — the signed-in notification feed, read-marking and
 * the push pipeline. Depends on the repository contract and the shared
 * push/feed helpers, throws application errors, never touches HTTP.
 *
 * The legacy handlers validated body fields mid-handler after the auth gate,
 * so those checks and their exact messages live here instead of in a
 * route-level Zod schema.
 */
import { logger } from "@/lib/logger";
import { ApiError } from "@/shared/errors";
import { paged } from "@/lib/community/serializers";
import { communityNotificationFeed } from "@/lib/community/notifications";
import { sendPush } from "@/lib/community/push";
import type { Session } from "@/lib/session";
import type {
  NotificationRepository,
  NotificationRow,
  NotificationScope,
} from "../repositories/notification.repository.interface";
import type {
  ListNotificationsQuery,
  PushNotificationBody,
  UpdateNotificationBody,
} from "../schemas/notification.schema";

const log = logger.child("notifications");

export class NotificationService {
  constructor(private readonly notificationRepository: NotificationRepository) {}

  /**
   * GET /api/notifications?limit=20 — latest notifications for the signed-in
   * user, always merged with global announcements (userId = null). Without a
   * session only global rows are returned.
   * Optional pagination (gap A-8): with ?page (and optional ?limit) the
   * response becomes { items, total, page, pages }; without it the legacy
   * array shape is returned exactly as before.
   * ?feed=all switches to the COMMUNITY feed (saved notifications + chat
   * pushes — the legacy fetchUserNotification shape, camelCase).
   */
  async list(query: ListNotificationsQuery, session: Session | null): Promise<unknown> {
    // Community feed (legacy fetchUserNotification / notifications/list).
    // feedPage/feedLimit are the schema's verbatim pageParams() computation.
    if (query.feed) {
      if (!session) throw new ApiError("Please sign in to continue", 401);
      const skip = (query.feedPage - 1) * query.feedLimit;
      const items = await communityNotificationFeed(session.userId, skip, query.feedLimit);
      return paged(items, query.feedPage, query.feedLimit);
    }

    const scope: NotificationScope = session
      ? { userId: session.userId }
      : { userId: null };

    if (query.page) {
      const page = Math.max(1, Math.trunc(Number(query.page) || 1));
      const { rows, total } = await this.notificationRepository.listPaged(
        scope,
        (page - 1) * query.limit,
        query.limit
      );
      return { items: rows, total, page, pages: Math.max(1, Math.ceil(total / query.limit)) };
    }

    return this.notificationRepository.list(scope, query.limit);
  }

  /**
   * PATCH /api/notifications — { id, isRead } marks one row, { all: true }
   * marks every unread row of the signed-in user as read.
   */
  async markRead(body: UpdateNotificationBody, actor: Session): Promise<unknown> {
    if (body.all === true) {
      const updated = await this.notificationRepository.markAllRead(actor.userId);
      log.info("notifications_marked_read", {
        userId: actor.userId,
        count: updated,
      });
      return { ok: true, updated };
    }

    if (!body.id) throw new ApiError("Provide { id, isRead } or { all: true }", 400);

    const row = await this.notificationRepository.findById(String(body.id));
    if (!row) {
      log.warn("notification_update_not_found", {
        notificationId: String(body.id),
        actor: actor.userId,
      });
      throw new ApiError("Notification not found", 404);
    }
    if (row.userId && row.userId !== actor.userId) {
      log.warn("notification_update_forbidden", {
        notificationId: row.id,
        ownerId: row.userId,
        actor: actor.userId,
      });
      throw new ApiError("You cannot modify this notification", 403);
    }

    const updated = await this.notificationRepository.update(row.id, {
      isRead: body.isRead !== false,
    });
    log.info("notification_updated", {
      notificationId: row.id,
      isRead: body.isRead !== false,
      actor: actor.userId,
    });
    return updated;
  }

  /**
   * GET /api/notifications/platform — global announcements (Notification rows
   * with userId = null) in the legacy fetchPlatformNotification shape.
   */
  async platform(page: number, limit: number): Promise<unknown> {
    const { rows, total } = await this.notificationRepository.listPaged(
      { userId: null },
      (page - 1) * limit,
      limit
    );
    return paged(
      rows.map((r: NotificationRow) => ({
        id: r.id,
        title: r.title,
        description: r.message,
        actionUrl: r.actionUrl,
        createdAt: r.createdAt,
      })),
      page,
      limit,
      total
    );
  }

  /**
   * POST /api/notifications/push — persist + deliver one push notification
   * (replaces the legacy pushNotificationToSingleUser).
   *  · ADMIN/MODERATOR (role or DB isModerator) may push to any user.
   *  · Regular users may only send chat-type pushes (data.type =
   *    "chat_message") to the OTHER participant of a conversation they belong
   *    to; the recipient is resolved from userId or a device token.
   */
  async push(body: PushNotificationBody, actor: Session): Promise<unknown> {
    const title = String(body.title ?? "").trim();
    const message = String(body.body ?? body.message ?? "").trim();
    if (!title || !message) throw new ApiError("title and body are required", 400);

    const data =
      body.data && typeof body.data === "object" && !Array.isArray(body.data)
        ? (body.data as Record<string, unknown>)
        : null;
    const type = body.type ? String(body.type) : "MOBILE";

    // Recipient — explicit user id, else the device token in the payload
    // (fcm/apns/legacy device columns).
    const userId = body.userId ? String(body.userId) : body.user_id ? String(body.user_id) : null;
    let recipient = userId ? await this.notificationRepository.findUserById(userId) : null;
    if (userId && !recipient) {
      log.warn("push_recipient_not_found", { userId, actor: actor.userId });
      throw new ApiError("User not found", 404);
    }
    if (!recipient) {
      const token = body.token ? String(body.token) : null;
      if (token) {
        const byToken = await this.notificationRepository.findUserByDeviceToken(token);
        if (byToken) recipient = byToken;
      }
    }
    if (!recipient) throw new ApiError("No recipient user resolved from the request", 400);

    // Gate: moderators may push to anyone; regular users only chat-type
    // pushes inside a conversation they participate in.
    const flag = await this.notificationRepository.findModeratorFlag(actor.userId);
    const isModerator = actor.role === "ADMIN" || actor.role === "MODERATOR" || flag?.isModerator === 1;
    if (!isModerator) {
      const conversationId = data?.conversationId ?? data?.conversation_id;
      if (data?.type !== "chat_message" || !conversationId) {
        log.warn("push_forbidden_non_chat", { type, actor: actor.userId });
        throw new ApiError("Only chat notifications to your own conversations are allowed", 403);
      }

      const conversation = await this.notificationRepository.findConversationById(
        String(conversationId)
      );
      if (!conversation || conversation.deletedAt) {
        log.warn("push_conversation_not_found", {
          conversationId: String(conversationId),
          actor: actor.userId,
        });
        throw new ApiError("Conversation not found", 404);
      }
      const otherId =
        conversation.user1Id === actor.userId
          ? conversation.user2Id
          : conversation.user2Id === actor.userId
            ? conversation.user1Id
            : null;
      if (!otherId) {
        log.warn("push_forbidden_not_participant", {
          conversationId: String(conversationId),
          actor: actor.userId,
        });
        throw new ApiError("Only chat notifications to your own conversations are allowed", 403);
      }
      if (recipient.id !== otherId) {
        log.warn("push_forbidden_not_other_participant", {
          conversationId: String(conversationId),
          recipientId: recipient.id,
          actor: actor.userId,
        });
        throw new ApiError("You can only notify the other participant of this conversation", 403);
      }
    }

    const row = await sendPush({
      userId: recipient.id,
      title,
      body: message,
      type,
      data,
    });
    log.info("push_notification_sent", {
      notificationId: row.id,
      recipientId: recipient.id,
      type,
      sentVia: row.sentVia,
      actor: actor.userId,
    });
    return { ok: true, notificationId: row.id, sentVia: row.sentVia };
  }
}
