import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  requireAuth,
  verifyPassword,
  hashPassword,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/profile/password — self-service password change.
// Body: { current, next } — verifies the current password, enforces min length.
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await req.json().catch(() => ({}));

    const current = String(body?.current ?? "");
    const next = String(body?.next ?? "");

    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) throw new ApiError("Account not found", 404);

    if (!current || !verifyPassword(current, user.password))
      throw new ApiError("Current password is incorrect", 400);
    if (!next || next.length < 6)
      throw new ApiError("New password must be at least 6 characters", 400);
    if (next === current)
      throw new ApiError("New password must be different from the current one", 400);

    await db.user.update({
      where: { id: session.userId },
      data: { password: hashPassword(next) },
    });

    await logActivity(
      session.name,
      "PASSWORD_CHANGE",
      "USER",
      `${session.email} changed their password`,
      session.userId
    );

    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
