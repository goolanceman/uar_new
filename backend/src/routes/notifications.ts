/**
 * Notifications routes — /api/notifications
 * Converted 1:1 from src/app/api/notifications/route.ts (Next.js route handler) to Express.
 * Extended with the generic mobile-parity endpoints: ?feed=all (the community
 * saved-notification feed), /platform (global announcements) and /push
 * (admin/moderator push, plus chat-type pushes between conversation
 * participants).
 */
import { Router } from "express";
import { db } from "@/lib/db";
import {
  ApiError,
  handleError,
  json,
  requireAuth,
  validateSession,
} from "@/lib/session";
import { paged, pageParams } from "@/lib/community/serializers";
import { communityNotificationFeed } from "@/lib/community/notifications";
import { sendPush } from "@/lib/community/push";

export const router = Router();

// GET /api/notifications?limit=20 — latest notifications for the signed-in
// user, always merged with global announcements (userId = null). Without a
// session only global rows are returned.
// Optional pagination (gap A-8): with ?page (and optional ?limit) the
// response becomes { items, total, page, pages }; without it the legacy
// array shape is returned exactly as before.
// ?feed=all switches to the COMMUNITY feed (saved notifications + chat
// pushes — the legacy fetchUserNotification shape, camelCase).
router.get("/", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;
    const limitRaw = parseInt(sp.get("limit") ?? "20", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

    const session = await validateSession(req);

    // Community feed (legacy fetchUserNotification / notifications/list).
    if (sp.get("feed") === "all") {
      if (!session) throw new ApiError("Please sign in to continue", 401);
      const { page, limit: feedLimit, skip } = pageParams(req.query);
      const items = await communityNotificationFeed(session.userId, skip, feedLimit);
      return json(res, paged(items, page, feedLimit));
    }

    const where = session
      ? { OR: [{ userId: session.userId }, { userId: null }] }
      : { userId: null };

    const pageRaw = sp.get("page");
    if (pageRaw) {
      const page = Math.max(1, Math.trunc(Number(pageRaw) || 1));
      const [items, total] = await Promise.all([
        db.notification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.notification.count({ where }),
      ]);
      return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
    }

    const rows = await db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/notifications — { id, isRead } marks one row, { all: true }
// marks every unread row of the signed-in user as read.
router.patch("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = (req.body ?? {}) as {
      id?: string;
      isRead?: boolean;
      all?: boolean;
    };

    if (body.all === true) {
      const result = await db.notification.updateMany({
        where: { userId: session.userId, isRead: false },
        data: { isRead: true },
      });
      return json(res, { ok: true, updated: result.count });
    }

    if (!body.id) throw new ApiError("Provide { id, isRead } or { all: true }", 400);

    const row = await db.notification.findUnique({ where: { id: String(body.id) } });
    if (!row) throw new ApiError("Notification not found", 404);
    if (row.userId && row.userId !== session.userId)
      throw new ApiError("You cannot modify this notification", 403);

    const updated = await db.notification.update({
      where: { id: row.id },
      data: { isRead: body.isRead !== false },
    });

    return json(res, updated);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/notifications/platform — global announcements (Notification rows
// with userId = null) in the legacy fetchPlatformNotification shape.
router.get("/platform", async (req, res) => {
  try {
    const { page, limit, skip } = pageParams(req.query);
    const where = { userId: null };
    const [rows, total] = await Promise.all([
      db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.notification.count({ where }),
    ]);
    return json(
      res,
      paged(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.message,
          actionUrl: r.actionUrl,
          createdAt: r.createdAt,
        })),
        page,
        limit,
        total
      )
    );
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/notifications/push — persist + deliver one push notification
// (replaces the legacy pushNotificationToSingleUser).
//  · ADMIN/MODERATOR (role or DB isModerator) may push to any user.
//  · Regular users may only send chat-type pushes (data.type =
//    "chat_message") to the OTHER participant of a conversation they belong
//    to; the recipient is resolved from userId or a device token.
router.post("/push", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

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
    let userId = body.userId ? String(body.userId) : body.user_id ? String(body.user_id) : null;
    let recipient = userId ? await db.user.findUnique({ where: { id: userId } }) : null;
    if (userId && !recipient) throw new ApiError("User not found", 404);
    if (!recipient) {
      const token = body.token ? String(body.token) : null;
      if (token) {
        const byToken = await db.user.findFirst({
          where: { OR: [{ fcmToken: token }, { apnsToken: token }, { deviceToken: token }] },
        });
        if (byToken) recipient = byToken;
      }
    }
    if (!recipient) throw new ApiError("No recipient user resolved from the request", 400);

    // Gate: moderators may push to anyone; regular users only chat-type
    // pushes inside a conversation they participate in.
    const actor = await db.user.findUnique({ where: { id: session.userId }, select: { isModerator: true } });
    const isModerator = session.role === "ADMIN" || session.role === "MODERATOR" || actor?.isModerator === 1;
    if (!isModerator) {
      const conversationId = data?.conversationId ?? data?.conversation_id;
      if (data?.type !== "chat_message" || !conversationId)
        throw new ApiError("Only chat notifications to your own conversations are allowed", 403);

      const conversation = await db.conversation.findUnique({
        where: { id: String(conversationId) },
        select: { user1Id: true, user2Id: true, deletedAt: true },
      });
      if (!conversation || conversation.deletedAt)
        throw new ApiError("Conversation not found", 404);
      const otherId =
        conversation.user1Id === session.userId
          ? conversation.user2Id
          : conversation.user2Id === session.userId
            ? conversation.user1Id
            : null;
      if (!otherId)
        throw new ApiError("Only chat notifications to your own conversations are allowed", 403);
      if (recipient.id !== otherId)
        throw new ApiError("You can only notify the other participant of this conversation", 403);
    }

    const row = await sendPush({
      userId: recipient.id,
      title,
      body: message,
      type,
      data,
    });
    return json(res, { ok: true, notificationId: row.id, sentVia: row.sentVia });
  } catch (e) {
    return handleError(e, res);
  }
});
