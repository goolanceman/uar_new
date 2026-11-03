import { cookies, headers } from "next/headers";
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

// ─── Passwords (scrypt; verifies legacy plain-text values too) ──────────────

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  try {
    if (!stored) return false;
    if (stored.includes(":")) {
      const [salt, hash] = stored.split(":");
      const test = crypto.scryptSync(pw, salt, 32).toString("hex");
      return crypto.timingSafeEqual(
        Buffer.from(hash, "hex"),
        Buffer.from(test, "hex")
      );
    }
    // legacy plain-text (pre-hash seed) accounts
    return crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(stored));
  } catch {
    return false;
  }
}

// ─── Session (HMAC-signed token via cookie AND/OR bearer header) ────────────
/*
 * The app is embedded in the sandbox preview iframe (cross-site context),
 * where SameSite=Lax cookies are never sent. To keep auth working in every
 * embedding context we accept the signed token from EITHER the cookie OR an
 * `Authorization: Bearer <token>` header. The cookie is still set (with
 * SameSite=None; Secure over HTTPS so it also works inside iframes).
 */

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex")
    .slice(0, 32);
}

export function issueToken(s: Session): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function parseToken(raw: string | undefined | null): Session | null {
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || sig.length !== 32) return null;
  const expected = sign(payload);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
  } catch {
    return null;
  }
}

export async function setSession(s: Session): Promise<void> {
  const token = issueToken(s);
  const store = await cookies();
  const h = await headers();
  const proto =
    h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "http";
  const isHttps = proto === "https";
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    // None+Secure keeps the cookie alive inside cross-site preview iframes
    // served over HTTPS; Lax is correct (and required) for plain HTTP.
    sameSite: isHttps ? "none" : "lax",
    secure: isHttps,
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
    // 1) Authorization: Bearer header (works inside cross-site iframes)
    const h = await headers();
    const auth = h.get("authorization");
    if (auth?.toLowerCase().startsWith("bearer ")) {
      const s = parseToken(auth.slice(7).trim());
      if (s) return s;
    }
    // 2) Cookie
    const store = await cookies();
    return parseToken(store.get(COOKIE_NAME)?.value);
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

/** True when the current request carries a valid session (cookie or bearer). */
export async function isAuthenticated(): Promise<boolean> {
  return (await getSession()) !== null;
}

export async function requireRole(...roles: string[]): Promise<Session> {
  const s = await requireAuth();
  if (!roles.includes(s.role))
    throw new ApiError("You do not have permission for this action", 403);
  return s;
}

export function publicUser(u: {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  isActive: boolean;
  phone?: string | null;
  city?: string | null;
  avatar?: string | null;
  pan?: string | null;
  about?: string | null;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.isActive ? u.status : "SUSPENDED",
    phone: u.phone,
    city: u.city,
    avatar: u.avatar,
    pan: u.pan,
    about: u.about,
  };
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
        actorName,
        action,
        entityType: entity ?? "SYSTEM",
        details: detail,
      },
    });
  } catch {
    // logging must never break the API
  }
}
