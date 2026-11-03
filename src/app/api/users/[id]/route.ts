import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  requireRole,
  hashPassword,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/users/:id — admin edits a user
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new ApiError("User not found", 404);

    const data: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("Name cannot be empty", 400);
      data.name = name;
    }
    if (body?.role !== undefined) data.role = String(body.role);
    if (body?.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email))
        throw new ApiError("Please enter a valid email address", 400);
      const taken = await db.user.findFirst({ where: { email, id: { not: id } } });
      if (taken) throw new ApiError("Another account already uses this email", 409);
      data.email = email;
    }
    if (body?.phone !== undefined) data.phone = body.phone ? String(body.phone).trim() : null;
    if (body?.city !== undefined) data.city = body.city ? String(body.city).trim() : null;
    if (body?.pan !== undefined) {
      const v = body.pan ? String(body.pan).trim().toUpperCase() : null;
      if (v && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(v))
        throw new ApiError("PAN must look like ABCDE1234F", 400);
      data.pan = v;
    }
    if (body?.about !== undefined) data.about = body.about ? String(body.about) : null;
    if (body?.avatar !== undefined) data.avatar = body.avatar ? String(body.avatar) : null;
    if (body?.password) {
      const pw = String(body.password);
      if (pw.length < 6)
        throw new ApiError("Password must be at least 6 characters", 400);
      data.password = hashPassword(pw);
    }

    // Status drives isActive: PENDING → false, ACTIVE → true, SUSPENDED → false
    if (body?.status !== undefined) {
      const status = String(body.status);
      data.status = status;
      if (body?.isActive === undefined) data.isActive = status === "ACTIVE";
    }
    if (body?.isActive !== undefined) data.isActive = Boolean(body.isActive);

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const user = await db.user.update({ where: { id }, data });

    await logActivity(
      session.name,
      "USER_UPDATE",
      "USER",
      `${user.email} → ${Object.keys(data).join(", ")}`,
      session.userId
    );

    const { password: _pw, ...userSafe } = user;
    return json(userSafe);
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/users/:id — admin removes a user
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await requireRole("ADMIN");
    const { id } = await ctx.params;

    if (id === session.userId)
      throw new ApiError("You cannot delete your own account", 409);

    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new ApiError("User not found", 404);

    if (target.role === "ADMIN") {
      const adminCount = await db.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1)
        throw new ApiError("You cannot delete the only administrator account", 409);
    }

    // Detach FK children before deleting
    await db.donation.updateMany({ where: { donorId: id }, data: { donorId: null } });
    await db.notification.updateMany({ where: { userId: id }, data: { userId: null } });
    await db.activityLog.updateMany({ where: { userId: id }, data: { userId: null } });
    await db.beneficiary.updateMany({ where: { userId: id }, data: { userId: null } });
    await db.volunteer.deleteMany({ where: { userId: id } });

    await db.user.delete({ where: { id } });

    await logActivity(
      session.name,
      "USER_DELETE",
      "USER",
      `${target.email} (${target.role})`,
      session.userId
    );

    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
