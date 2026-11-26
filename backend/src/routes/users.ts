/**
 * Users routes — /api/users, /api/users/:id
 * Converted 1:1 from src/app/api/users/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireRole,
  hashPassword,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";
import { USER_STATUSES } from "@/lib/user-status";
import { deleteUserCascade } from "@/lib/community/users";

export const router = Router();

const ROLES = ["ADMIN", "VOLUNTEER", "DONOR", "BENEFICIARY"];
const STATUSES: readonly string[] = USER_STATUSES;

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  isActive: true,
  phone: true,
  city: true,
  pan: true,
  about: true,
  avatar: true,
  createdAt: true,
  updatedAt: true,
} as const;

// GET /api/users?q&role&status — admin directory
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");

    const sp = new URL(req.url, "http://localhost").searchParams;
    const q = sp.get("q")?.trim();
    const role = sp.get("role");
    const status = sp.get("status");

    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        { city: { contains: q } },
      ];
    }

    const users = await db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        isActive: true,
        phone: true,
        city: true,
        pan: true,
        about: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return json(res, users);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/users — admin creates a user
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = req.body ?? {};

    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const role = String(body?.role ?? "DONOR");
    const phone = body?.phone ? String(body.phone).trim() : null;
    const city = body?.city ? String(body.city).trim() : null;
    const about = body?.about ? String(body.about) : null;

    if (!name || !email || !password || !role)
      throw new ApiError("Name, email, password and role are required", 400);
    if (!ROLES.includes(role)) throw new ApiError("Invalid role", 400);
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);
    if (password.length < 6)
      throw new ApiError("Password must be at least 6 characters", 400);

    const existing = await db.user.findFirst({
      where: { email: { equals: email } },
    });
    if (existing)
      throw new ApiError("An account with this email already exists", 409);

    const user = await db.user.create({
      data: {
        name,
        email,
        password: hashPassword(password),
        role,
        phone,
        city,
        about,
        status: role === "VOLUNTEER" ? "PENDING" : "ACTIVE",
        isActive: role !== "VOLUNTEER",
      },
    });

    await logActivity(
      session.name,
      "USER_CREATE",
      "USER",
      `${user.email} (${role})`,
      session.userId
    );

    const { password: _pw, ...userSafe } = user;
    return json(res, userSafe, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/users/:id (ADMIN) — full record + recent audit-trail entries for
// the detail sheet's Activity tab.
router.get("/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const { id } = req.params;

    const user = await db.user.findUnique({
      where: { id },
      select: userSelect,
    });
    if (!user) throw new ApiError("User not found", 404);

    const activityLogs = await db.activityLog.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    return json(res, { user, activityLogs });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/users/:id — admin edits a user
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new ApiError("User not found", 404);

    const data: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError("Name cannot be empty", 400);
      data.name = name;
    }
    if (body?.role !== undefined) {
      const role = String(body.role);
      if (!ROLES.includes(role)) throw new ApiError("Invalid role", 400);
      // Guard: never demote the last remaining ADMIN out of the console.
      if (target.role === "ADMIN" && role !== "ADMIN") {
        const adminCount = await db.user.count({ where: { role: "ADMIN" } });
        if (adminCount <= 1)
          throw new ApiError("You cannot change the role of the only administrator", 409);
      }
      data.role = role;
    }
    if (body?.status !== undefined) {
      const status = String(body.status);
      if (!STATUSES.includes(status)) throw new ApiError("Invalid status", 400);
    }
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

    // Guard: an admin cannot lock themselves out of the console.
    if (data.isActive === false && id === session.userId)
      throw new ApiError("You cannot deactivate your own account", 409);
    const user = await db.user.update({ where: { id }, data });

    await logActivity(
      session.name,
      data.password ? "PASSWORD_RESET" : "USER_UPDATE",
      "USER",
      `${user.email} → ${Object.keys(data).join(", ")}`,
      session.userId
    );

    const { password: _pw, ...userSafe } = user;
    return json(res, userSafe);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/users/:id — admin removes a user (community cascade via
// deleteUserCascade — likes, follows, rooms, reels, posts, stories,
// verifications, reports, saved notifications — plus the CRM detachments the
// admin flow needs: donations, activity logs, beneficiary/donor profiles).
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;

    if (id === session.userId)
      throw new ApiError("You cannot delete your own account", 409);

    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new ApiError("User not found", 404);

    if (target.role === "ADMIN") {
      const adminCount = await db.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1)
        throw new ApiError("You cannot delete the only administrator account", 409);
    }

    // Detach CRM children that point back at the user before the cascade.
    await db.donation.updateMany({ where: { donorId: id }, data: { donorId: null } });
    await db.activityLog.updateMany({ where: { userId: id }, data: { userId: null } });
    await db.beneficiary.updateMany({ where: { userId: id }, data: { userId: null } });

    // Full community cascade (also deletes the user row and their
    // notifications + volunteer profile).
    await deleteUserCascade(id);

    await logActivity(
      session.name,
      "USER_DELETE",
      "USER",
      `${target.email} (${target.role})`,
      session.userId
    );

    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
