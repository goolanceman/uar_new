import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  requireAuth,
  verifyPassword,
  hashPassword,
  ApiError,
  json,
  handleError,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await req.json().catch(() => ({}));

    const data: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("Name cannot be empty", 400);
      data.name = name;
    }
    if (body?.phone !== undefined) data.phone = body.phone ? String(body.phone).trim() : null;
    if (body?.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body?.pan !== undefined) data.pan = body.pan ? String(body.pan).trim().toUpperCase() : null;
    if (body?.about !== undefined) data.about = body.about ? String(body.about) : null;

    if (body?.password) {
      const { current, next } = body.password;
      const user = await db.user.findUnique({ where: { id: session.userId } });
      if (!user) throw new ApiError("Account not found", 404);
      if (!current || !verifyPassword(String(current), user.password))
        throw new ApiError("Current password is incorrect", 400);
      if (!next || String(next).length < 6)
        throw new ApiError("New password must be at least 6 characters", 400);
      data.password = hashPassword(String(next));
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const updated = await db.user.update({
      where: { id: session.userId },
      data,
    });

    const { password: _pw, ...userSafe } = updated;
    return json({ user: userSafe });
  } catch (e) {
    return handleError(e);
  }
}
