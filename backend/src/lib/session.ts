import type { Request, Response } from "express";
import crypto from "crypto";
import type { CookieOptions } from "express";
import { logger } from "@/lib/logger";
// The shared error hierarchy interops with the legacy ApiError: handleError
// recognizes both so services may throw either without changing responses.
import { AppError as SharedAppError } from "@/shared/errors/app-error";

const COOKIE_NAME = "uar_session";

// No hardcoded fallback: a known/public secret would let anyone forge a
// session token (including role: "ADMIN") and fully bypass authentication.
// Fail fast instead of silently signing with a guessable key.
const SECRET = (() => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.trim().length < 16) {
    throw new Error(
      "SESSION_SECRET environment variable must be set to a random value of at least 16 characters."
    );
  }
  return s;
})();

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

// ─── Session (real JWT — HS256 — via cookie AND/OR bearer token) ────────────
/*
 * The app is embedded in the sandbox preview iframe (cross-site context),
 * where SameSite=Lax cookies are never sent. To keep auth working in every
 * embedding context we accept the signed token from EITHER the cookie OR an
 * `Authorization: Bearer <token>` header. The cookie is still set (with
 * SameSite=None; Secure over HTTPS so it also works inside iframes).
 *
 * Token format is a standards-compliant JWT (RFC 7519):
 *   base64url(header) "." base64url(payload) "." base64url(HMAC-SHA256 signature)
 * header  = { "alg": "HS256", "typ": "JWT" }
 * payload = { sub, role, name, email, iat, exp } — `sub`/`iat`/`exp` are the
 * standard registered claims; `role`/`name`/`email` are UAR-specific claims.
 */

const JWT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — matches the session cookie maxAge

interface JwtClaims {
  sub: string;
  role: string;
  name: string;
  email: string;
  iat: number;
  exp: number;
  /** Issue time in milliseconds (UAR extension) — gives the tokenValidAfter
   *  revocation watermark sub-second precision. Legacy tokens without it
   *  fall back to iat*1000. */
  ms?: number;
}

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function signInput(input: string): string {
  return crypto.createHmac("sha256", SECRET).update(input).digest("base64url");
}

const JWT_HEADER = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

export function issueToken(s: Session): string {
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const claims: JwtClaims = {
    sub: s.userId,
    role: s.role,
    name: s.name,
    email: s.email,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
    ms: nowMs, // sub-second issue time — exact revocation ordering
  };
  const payload = b64url(JSON.stringify(claims));
  const signingInput = `${JWT_HEADER}.${payload}`;
  return `${signingInput}.${signInput(signingInput)}`;
}

export function decodeTokenUnsafe(raw: string): JwtClaims | null {
  try {
    const [, payload] = raw.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as JwtClaims;
  } catch {
    return null;
  }
}

/** Verified parse — returns the session AND the issue time (ms — `ms` claim
 *  when present, else iat*1000), needed by validateSession for the
 *  tokenValidAfter revocation watermark. */
function parseTokenFull(raw: string | undefined | null): { session: Session; issuedAtMs: number } | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  if (!header || !payload || !sig) return null;

  const signingInput = `${header}.${payload}`;
  const expected = signInput(signingInput);
  let sigBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, "base64url");
    expectedBuf = Buffer.from(expected, "base64url");
  } catch {
    return null;
  }
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf))
    return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as JwtClaims;
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null; // expired
    if (!claims.sub) return null;
    return {
      session: { userId: claims.sub, role: claims.role, name: claims.name, email: claims.email },
      issuedAtMs: typeof claims.ms === "number" ? claims.ms : claims.iat * 1000,
    };
  } catch {
    return null;
  }
}

function parseToken(raw: string | undefined | null): Session | null {
  return parseTokenFull(raw)?.session ?? null;
}

// ─── Cookie plumbing (Express equivalents of next/headers cookies()) ───────

function serializeCookie(name: string, value: string, opts: CookieOptions & { maxAge?: number }): string {
  let out = `${name}=${value}`;
  out += `; Path=${opts.path ?? "/"}`;
  if (opts.maxAge != null) out += `; Max-Age=${Math.floor(opts.maxAge)}`;
  if (opts.httpOnly) out += "; HttpOnly";
  if (opts.secure) out += "; Secure";
  if (opts.sameSite) {
    const s = String(opts.sameSite);
    out += `; SameSite=${s.charAt(0).toUpperCase()}${s.slice(1)}`;
  }
  return out;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function setSession(res: Response, s: Session): void {
  const token = issueToken(s);
  const req = res.req;
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol ?? "http";
  const isHttps = proto === "https";
  res.setHeader(
    "Set-Cookie",
    serializeCookie(COOKIE_NAME, token, {
      httpOnly: true,
      // None+Secure keeps the cookie alive inside cross-site preview iframes
      // served over HTTPS; Lax is correct (and required) for plain HTTP.
      sameSite: isHttps ? "none" : "lax",
      secure: isHttps,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    })
  );
}

export function clearSession(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(COOKIE_NAME, "", { path: "/", maxAge: 0, httpOnly: true })
  );
}

/** Extracts the raw session token from the bearer header or cookie. */
function extractToken(req: Request): string | null {
  // 1) Authorization: Bearer token (works inside cross-site iframes)
  const auth = req.headers.authorization;
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  // 2) Cookie
  return parseCookies(req)[COOKIE_NAME] ?? null;
}

/**
 * Sync, DB-free session read — verifies the JWT signature/expiry ONLY. It
 * does NOT consult the database, so it CANNOT see token revocation
 * (User.tokenValidAfter).
 *
 * Reserve this for OPTIONAL-session routes where the session only enriches a
 * public response (GET /api/auth/me, guest /api/notifications, the assistant
 * role hint) — never as the sole gate on privileged data. Privileged routes
 * must use the async `validateSession`/`requireAuth`/`requireRole`, which
 * additionally reject tokens issued before the user's `tokenValidAfter`
 * watermark (set on logout and password reset).
 */
export function getSession(req: Request): Session | null {
  try {
    return parseToken(extractToken(req));
  } catch {
    return null;
  }
}

/**
 * Fully-validated session for AUTHED routes — signature + expiry (as above)
 * PLUS one small DB read enforcing the revocation watermark: a token whose
 * `iat` predates User.tokenValidAfter (set by POST /api/auth/logout and by
 * password resets) is rejected. Returns null for no session, revoked
 * sessions, or a missing user row — callers turn that into a 401.
 */
export async function validateSession(req: Request): Promise<Session | null> {
  try {
    const parsed = parseTokenFull(extractToken(req));
    if (!parsed) return null;
    const { db } = await import("@/lib/db");
    const user = await db.user.findUnique({
      where: { id: parsed.session.userId },
      select: { tokenValidAfter: true },
    });
    if (!user) return null;
    // Exact revocation ordering: `ms` claim gives millisecond issue time
    // (legacy tokens fall back to iat*1000), so a logout at T.500ms revokes
    // every token issued before it without falsely rejecting re-login
    // tokens issued milliseconds later.
    if (user.tokenValidAfter && parsed.issuedAtMs < user.tokenValidAfter.getTime())
      return null; // token predates the revocation watermark
    return parsed.session;
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

/** Typed access to the validated JSON body (express.json() populates it). */
export function body<T = Record<string, unknown>>(req: Request): T {
  return (req.body ?? {}) as T;
}

export function json(res: Response, data: unknown, status = 200): Response {
  return res.status(status).json(data);
}

export function handleError(e: unknown, res: Response): Response {
  if (e instanceof ApiError || e instanceof SharedAppError) {
    const status = e.status;
    if (status >= 500)
      logger.error("api_error", { status, error: e.message });
    return res.status(status).json({ error: e.message });
  }
  logger.error("unhandled_route_error", {
    error: e instanceof Error ? e : String(e),
  });
  const msg = e instanceof Error ? e.message : "Internal server error";
  return res.status(500).json({ error: msg });
}

/**
 * AUTHED-route gate — revocation-aware (async; one small user lookup per
 * request, see validateSession). MUST be awaited by every call site:
 * `const session = await requireAuth(req);`
 */
export async function requireAuth(req: Request): Promise<Session> {
  const s = await validateSession(req);
  if (!s) throw new ApiError("Please sign in to continue", 401);
  return s;
}

/**
 * True when the current request carries a signature-valid (but NOT
 * revocation-checked) session. Sync-pure by design — only for
 * optional-session public responses; never gate privileged data on it.
 */
export function isAuthenticated(req: Request): boolean {
  return getSession(req) !== null;
}

/** Role gate on top of the revocation-aware requireAuth. MUST be awaited. */
export async function requireRole(req: Request, ...roles: string[]): Promise<Session> {
  const s = await requireAuth(req);
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
