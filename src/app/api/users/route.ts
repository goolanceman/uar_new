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

// GET /api/users?q&role&status — admin directory
export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMIN");

    const sp = new URL(req.url).searchParams;
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

    return json(users);
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/users — admin creates a user
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json().catch(() => ({}));

    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const role = String(body?.role ?? "DONOR");
    const phone = body?.phone ? String(body.phone).trim() : null;
    const city = body?.city ? String(body.city).trim() : null;

    if (!name || !email || !password || !role)
      throw new ApiError("Name, email, password and role are required", 400);
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
    return json(userSafe, 201);
  } catch (e) {
    return handleError(e);
  }
}
