import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "uar_session";
const SECRET =
  process.env.SESSION_SECRET || "united-angel-reach-bengaluru-secret-2026";

export interface Session {
  userId: string;
  role: string;
  name: string;
  email: string;
}

// ─── Passwords (scrypt with salt; legacy plain-text supported) ───────────────

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  try {
    if (stored.includes(":")) {
      // new scrypt format
      const [salt, hash] = stored.split(":");
      const test = crypto.scryptSync(pw, salt, 32).toString("hex");
      return crypto.timingSafeEqual(
        Buffer.from(hash, "hex"),
        Buffer.from(test, "hex")
      );
    }
    // legacy plain-text (seeded accounts) — auto-upgraded on next profile save
    return stored === pw;
  } catch {
    return false;
  }
}

// ─── Cookie session (HMAC-signed) ────────────────────────────────────────────

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex")
    .slice(0, 32);
}

export async function setSession(s: Session): Promise<void> {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSession(): Promise<Session | null> {
  try {
    const store = await cookies();
    const raw = store.get(COOKIE_NAME)?.value;
    if (!raw) return null;
    const [payload, sig] = raw.split(".");
    if (!payload || !sig || sign(payload) !== sig) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
  } catch {
    return null;
  }
}

// ─── API helpers ─────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data as object, { status });
}

export function handleError(e: unknown): Response {
  if (e instanceof ApiError)
    return Response.json({ error: e.message }, { status: e.status });
  console.error("[api]", e);
  const msg = e instanceof Error ? e.message : "Internal server error";
  return Response.json({ error: msg }, { status: 500 });
}

export async function requireAuth(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new ApiError("Please sign in to continue", 401);
  return s;
}

export async function requireRole(...roles: string[]): Promise<Session> {
  const s = await requireAuth();
  if (!roles.includes(s.role))
    throw new ApiError("You do not have permission for this action", 403);
  return s;
}

export async function logActivity(
  actorName: string | null,
  action: string,
  entity?: string,
  detail?: string,
  userId?: string
): Promise<void> {
  try {
    const { db } = await import("@/lib/db");
    await db.activityLog.create({
      data: {
        userId: userId ?? null,
        actorName: actorName ?? "System",
        action,
        entityType: entity ?? "SYSTEM",
        entityId: null,
        details: detail ?? null,
      },
    });
  } catch {
    // logging must never break the API
  }
}
