/**
 * Notifications routes — /api/notifications
 * Converted 1:1 from src/app/api/notifications/route.ts (Next.js route handler) to Express.
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

export const router = Router();

// GET /api/notifications?limit=20 — latest notifications for the signed-in
// user, always merged with global announcements (userId = null). Without a
// session only global rows are returned.
// Optional pagination (gap A-8): with ?page (and optional ?limit) the
// response becomes { items, total, page, pages }; without it the legacy
// array shape is returned exactly as before.
router.get("/", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;
    const limitRaw = parseInt(sp.get("limit") ?? "20", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

    const session = await validateSession(req);
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
