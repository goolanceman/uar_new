import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  getSession,
  requireAuth,
  ApiError,
  json,
  handleError,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/notifications?limit=20 — latest notifications for the signed-in
// user, always merged with global announcements (userId = null). Without a
// session only global rows are returned.
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const limitRaw = parseInt(sp.get("limit") ?? "20", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

    const session = await getSession();
    const where = session
      ? { OR: [{ userId: session.userId }, { userId: null }] }
      : { userId: null };

    const rows = await db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return json(rows);
  } catch (e) {
    return handleError(e);
  }
}

// PATCH /api/notifications — { id, isRead } marks one row, { all: true }
// marks every unread row of the signed-in user as read.
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      isRead?: boolean;
      all?: boolean;
    };

    if (body.all === true) {
      const res = await db.notification.updateMany({
        where: { userId: session.userId, isRead: false },
        data: { isRead: true },
      });
      return json({ ok: true, updated: res.count });
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

    return json(updated);
  } catch (e) {
    return handleError(e);
  }
}
