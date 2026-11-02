import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  setSession,
  verifyPassword,
  hashPassword,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    if (!email || !password)
      throw new ApiError("Email and password are required", 400);

    const user = await db.user.findFirst({
      where: { email: { equals: email } },
    });

    if (!user || !verifyPassword(password, user.password))
      throw new ApiError("Invalid email or password", 401);

    if (user.status === "SUSPENDED")
      throw new ApiError("Account suspended", 403);

    await setSession({
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    });

    // Upgrade legacy plain-text password to scrypt hash
    if (!user.password.includes(":")) {
      await db.user.update({
        where: { id: user.id },
        data: { password: hashPassword(password) },
      });
    }

    await logActivity(user.name, "LOGIN", "USER", undefined, user.id);

    const { password: _pw, ...userSafe } = user;
    return json({ user: userSafe });
  } catch (e) {
    return handleError(e);
  }
}
