import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  setSession,
  hashPassword,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["DONOR", "VOLUNTEER", "BENEFICIARY"];

function tempPassword(): string {
  return `UAR${Math.floor(10000 + Math.random() * 90000)}@`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const phone = String(body?.phone ?? "").trim();
    const city = body?.city ? String(body.city).trim() : null;
    const role = ALLOWED_ROLES.includes(String(body?.role)) ? String(body.role) : "DONOR";

    if (!name || !email || !phone)
      throw new ApiError("Name, email and phone are required", 400);
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);

    const existing = await db.user.findFirst({
      where: { email: { equals: email } },
    });
    if (existing)
      throw new ApiError("An account with this email already exists", 409);

    const password = tempPassword();
    const user = await db.user.create({
      data: {
        name,
        email,
        phone,
        city,
        role,
        password: hashPassword(password),
        status: role === "VOLUNTEER" ? "PENDING" : "ACTIVE",
        isActive: role !== "VOLUNTEER",
      },
    });

    await setSession({
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    });

    await logActivity(name, "REGISTER", "USER", role, user.id);

    const { password: _pw, ...userSafe } = user;
    return json({
      user: userSafe,
      tempCreds: { email, password, fullName: name },
    });
  } catch (e) {
    return handleError(e);
  }
}
