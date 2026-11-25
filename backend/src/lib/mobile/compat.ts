/**
 * Mobile wire-compatibility toolkit.
 *
 * Ports the legacy Laravel "chatter" mobile API contract onto the uarnew
 * Express backend so the existing Flutter app works once its baseURL points
 * here. Reuses the platform's existing infrastructure everywhere it exists:
 *   - auth        → session.ts (JWT via `requireAuth`, revocation watermark)
 *   - passwords   → session.ts (hashPassword / verifyPassword)
 *   - rate limit  → rate-limit.ts
 *   - validation  → validators.ts
 *   - uploads     → files.ts (saveUpload) served by routes/files.ts
 *   - push rows   → the existing Notification model (userId = User.id)
 *   - SSE feed    → events.ts broadcastEvent (admin live feed)
 *
 * Wire contract (extracted from the Flutter app — lib/common/api_service/*):
 *  - Every request carries an `apikey` header; authenticated ones add
 *    `authtoken` (the same JWT the web app stores).
 *  - Responses use the envelope  { status: boolean, message: string, data?: any }
 *    with snake_case field names, matching the legacy Eloquent serialization.
 *  - Business failures (validation, not-found) are HTTP 200 with status:false —
 *    only auth failures use 401 (the app clears its session on 401).
 */
import type { Request, Response, NextFunction } from "express";
import { requireAuth, type Session } from "@/lib/session";
import { db } from "@/lib/db";
import { broadcastEvent } from "@/lib/events";

// ─── API key gate ─────────────────────────────────────────────────────────────
// The Flutter app sends its apikey header on EVERY request; the uarnew admin
// frontend never does. The compat router therefore only claims requests that
// carry an apikey header — everything else falls through to the existing
// routers untouched (this is what keeps /api/auth/login etc. working for both).

function allowedApiKeys(): string[] | null {
  const raw = process.env.MOBILE_API_KEYS;
  if (!raw || !raw.trim()) return null; // unset → accept any non-empty key
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Mount-level middleware: forward non-mobile requests to the legacy routers,
 * reject mobile requests with a bad apikey exactly like CheckHeader.php.
 */
export function mobileGate(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header("apikey");
  if (!apiKey) return next(); // not a mobile request → legacy router handles it

  const allowed = allowedApiKeys();
  if (allowed && !allowed.includes(apiKey)) {
    return res.status(401).json({ status: false, message: "Enter Right Api key" });
  }
  return next();
}

// ─── Response envelope (GlobalFunction::sendSimpleResponse / sendDataResponse) ──

export function ok(res: Response, message: string, extra: Record<string, unknown> = {}) {
  return res.json({ status: true, message, ...extra });
}

export function data(res: Response, message: string, payload: unknown) {
  return res.json({ status: true, message, data: payload });
}

/** Business failure — HTTP 200 + status:false (matches Laravel sendSimpleResponse). */
export function fail(res: Response, message: string) {
  return res.json({ status: false, message });
}

/** Auth failure — HTTP 401, the app clears its session on this. */
export function unauthorized(res: Response, reason: string) {
  return res.status(401).json({ status: false, message: "Unauthorized Access", reason });
}

// ─── Auth — thin adapter over the existing session JWT ────────────────────────

/**
 * Existing-session auth for mobile requests: the app sends its JWT in the
 * `authtoken` header (legacy wire format) instead of `Authorization: Bearer`,
 * so lift it into the header the session lib already understands, then reuse
 * `requireAuth` as-is — revocation watermark, expiry and all.
 */
export async function mobileAuth(req: Request, res: Response, next: NextFunction) {
  const authtoken = req.header("authtoken");
  if (authtoken && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${authtoken}`;
  }
  try {
    const session = await requireAuth(req);
    (req as Request & { session?: Session }).session = session;
    return next();
  } catch {
    return unauthorized(res, "Invalid or expired token");
  }
}

export function session(req: Request): Session {
  const s = (req as Request & { session?: Session }).session;
  if (!s) throw new Error("session missing — mobileAuth not applied?");
  return s;
}

/** Moderator gate — mirrors the legacy isAdmin checks. */
export function requireModerator(req: Request, res: Response, next: NextFunction) {
  const s = (req as Request & { session?: Session }).session;
  if (!s) return unauthorized(res, "Invalid or expired token");
  if (s.role !== "ADMIN" && s.role !== "MODERATOR") {
    return unauthorized(res, "Moderator access required");
  }
  return next();
}

/**
 * Serialize the existing User row into the legacy wire shape the Flutter
 * models parse (registration.dart User). Aliases: full_name←name, bio←about,
 * profile←avatar, identity←email.
 */
export function legacyUser(u: {
  id: string;
  email: string | null;
  name: string | null;
  about: string | null;
  avatar: string | null;
  username: string | null;
  backgroundImage: string | null;
  interestIds: string | null;
  isPushNotifications: number;
  isInvitedToRoom: number;
  isVerified: number;
  isBlock: number;
  blockUserIds: string | null;
  savedMusicIds: string | null;
  savedReelIds: string | null;
  followingCount: number;
  followersCount: number;
  isModerator: number;
  loginType: number;
  deviceType: number;
  deviceToken: string | null;
  emailVerifiedAt?: Date | null;
  userType?: string | null;
  volunteerStatus?: string | null;
  volunteerRequestedAt?: Date | null;
  volunteerApprovedAt?: Date | null;
  volunteerApprovedBy?: string | null;
  volunteerRejectionReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: u.id,
    identity: u.email,
    email: u.email,
    username: u.username ?? "",
    full_name: u.name,
    bio: u.about,
    interest_ids: u.interestIds,
    profile: u.avatar,
    background_image: u.backgroundImage,
    is_push_notifications: u.isPushNotifications,
    is_invited_to_room: u.isInvitedToRoom,
    is_verified: u.isVerified,
    is_block: u.isBlock,
    block_user_ids: u.blockUserIds,
    saved_music_ids: u.savedMusicIds,
    saved_reel_ids: u.savedReelIds,
    following: u.followingCount,
    followers: u.followersCount,
    is_moderator: u.isModerator,
    login_type: u.loginType,
    device_type: u.deviceType,
    device_token: u.deviceToken,
    email_verified_at: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
    user_type: u.userType,
    volunteer_status: u.volunteerStatus,
    volunteer_requested_at: u.volunteerRequestedAt ? u.volunteerRequestedAt.toISOString() : null,
    volunteer_approved_at: u.volunteerApprovedAt ? u.volunteerApprovedAt.toISOString() : null,
    volunteer_approved_by: u.volunteerApprovedBy,
    volunteer_rejection_reason: u.volunteerRejectionReason,
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
  };
}

// ─── Param helpers ────────────────────────────────────────────────────────────

/** Merge JSON body + query params (the app sends both depending on method). */
export function params(req: Request): Record<string, unknown> {
  return { ...((req.query ?? {}) as Record<string, unknown>), ...((req.body ?? {}) as Record<string, unknown>) };
}

export function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

export function optStr(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  return String(v);
}

export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function optNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function bool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

/** Comma-separated int list → number[] (legacy CSV columns like interest_ids). */
export function csvToInts(v: unknown): number[] {
  return str(v)
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
}

export function intsToCsv(ids: Array<number | string>): string {
  return ids.map(String).join(",");
}

/** Does a CSV column contain this id? */
export function csvHas(csv: string | null | undefined, id: number | string): boolean {
  if (!csv) return false;
  return csv.split(",").map((s) => s.trim()).includes(String(id));
}

export function page(req: Request, defaultLimit = 20): { start: number; limit: number; skip: number } {
  const p = params(req);
  const start = Math.max(0, num(p.start));
  const limit = Math.min(100, Math.max(1, num(p.limit, defaultLimit)));
  return { start, limit, skip: start };
}

// ─── Serialization (mirror Laravel Eloquent JSON) ─────────────────────────────
// Dates → ISO strings (JSON.stringify does this automatically); Floats →
// numbers. Nested includes keep their Prisma keys, which we name exactly like
// the legacy relation attributes (user, content, comments, ...).

// ─── File uploads (legacy saveFileAndGivePath) ────────────────────────────────

/**
 * Store an uploaded file through the existing FileAsset infrastructure and
 * return its absolute public URL (the app treats returned URLs as complete;
 * media mimes are publicly served by routes/files.ts).
 */
export async function storeUpload(req: Request, file: File, folder = "mobile"): Promise<string> {
  const { saveUpload } = await import("@/lib/files");
  const s = (req as Request & { session?: Session }).session;
  const asset = await saveUpload(file, {
    folder,
    uploadedBy: s ? { id: s.userId, name: s.name } : undefined,
  });
  const host = req.get("host") ?? "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol ?? "http";
  return `${proto}://${host}/api/files/${asset.id}/file`;
}

// ─── Push notification (legacy GlobalFunction::sendPushNotificationToUser) ────
// Persists into the existing Notification model (userId = User.id) so the
// mobile notification list and the admin dashboard read the same stream.
// FCM delivery runs when FCM_SERVER_KEY is configured; the row is the source
// of truth either way.

export async function sendPush(opts: {
  userId: string;
  title: string;
  body: string;
  type?: string | null;
  data?: Record<string, unknown> | null;
}) {
  const user = await db.user.findUnique({
    where: { id: opts.userId },
    select: { fcmToken: true, apnsToken: true, deviceToken: true },
  });
  const deviceToken = user?.fcmToken || user?.apnsToken || user?.deviceToken || null;
  const platform = user?.fcmToken ? "android" : user?.apnsToken ? "ios" : null;

  const row = await db.notification.create({
    data: {
      userId: opts.userId,
      title: opts.title,
      message: opts.body,
      type: opts.type ?? "MOBILE",
      data: opts.data ? JSON.stringify(opts.data) : null,
      platform,
      deviceToken,
      sentVia: deviceToken ? "fcm" : "none",
    },
  });

  if (deviceToken && process.env.FCM_SERVER_KEY) {
    try {
      await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: {
          Authorization: `key=${process.env.FCM_SERVER_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: deviceToken,
          notification: { title: opts.title, body: opts.body },
          data: (opts.data ?? {}) as Record<string, string>,
        }),
      });
    } catch (e) {
      console.error("[mobile] FCM delivery failed", e);
    }
  }
  return row;
}

/** Publish to the admin live feed (existing SSE infra) so the dashboard sees
 *  community activity without polling. */
export function feedEvent(eventName: string, payload: unknown) {
  broadcastEvent(eventName, payload);
}

// ─── Shared error handler for compat routes ───────────────────────────────────

export function mobileErrorHandler(err: unknown, res: Response) {
  console.error("[mobile] route error:", err);
  if (!res.headersSent) return fail(res, "Something went wrong");
  return undefined;
}

/** Helper for wrapping async handlers on a compat router. */
export function wrap(
  router: import("express").Router,
  method: "get" | "post" | "put" | "delete",
  path: string,
  ...handlers: Array<(req: Request, res: Response) => Promise<unknown>>
) {
  router[method](
    path,
    ...handlers.map((h) => (req: Request, res: Response) =>
      Promise.resolve(h(req, res)).catch((e) => mobileErrorHandler(e, res))
    )
  );
}
