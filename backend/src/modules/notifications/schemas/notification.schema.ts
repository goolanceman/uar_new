/**
 * Notification schemas — /api/notifications input.
 *
 * The legacy GET handler parsed the query with URLSearchParams over the raw
 * URL (limit = parseInt(sp.get("limit") ?? "20", 10) clamped to [1, 100],
 * NaN → 20; feed = sp.get("feed") === "all"; pagination triggered by a
 * truthy sp.get("page")) while the feed/platform envelopes used the shared
 * pageParams() helper (parseInt(String(q.page ?? "1"), 10) || 1). Every
 * transform below reproduces those expressions verbatim and rejects nothing
 * the legacy accepted.
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?limit[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── GET /api/notifications ──────────────────────────────────────────────────

export const listNotificationsQuerySchema = z.object({
  /** parseInt(sp.get("limit") ?? "20", 10), clamped to [1, 100]; NaN → 20. */
  limit: spGet.transform((v) => {
    const n = parseInt(v ?? "20", 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1), 100) : 20;
  }),
  /** Community feed switch — legacy `sp.get("feed") === "all"`. */
  feed: spGet.transform((v) => v === "all"),
  /** Raw page value — a truthy value switches the response to the
   *  { items, total, page, pages } envelope (legacy `if (sp.get("page"))`),
   *  an empty string does NOT (searchParams.get() returns "" — falsy). */
  page: spGet.transform((v) => v || undefined),
  /** Shared pageParams() page for the feed=all envelope:
   *  Math.max(1, parseInt(String(q.page ?? "1"), 10) || 1). */
  feedPage: spGet.transform((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1)),
  /** Shared pageParams() limit for the feed=all envelope:
   *  Math.min(100, Math.max(1, parseInt(String(q.limit ?? "20"), 10) || 20)). */
  feedLimit: spGet.transform((v) => Math.min(100, Math.max(1, parseInt(String(v ?? "20"), 10) || 20))),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

// ─── GET /api/notifications/platform ─────────────────────────────────────────

/** pageParams(req.query) semantics — page/limit envelopes of the global
 *  announcements feed (defaults 1/20, hard cap 100, parseInt coercion). */
export const platformNotificationsQuerySchema = z.object({
  page: spGet.transform((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1)),
  limit: spGet.transform((v) => Math.min(100, Math.max(1, parseInt(String(v ?? "20"), 10) || 20))),
});
export type PlatformNotificationsQuery = z.infer<typeof platformNotificationsQuerySchema>;

// ─── PATCH /api/notifications ────────────────────────────────────────────────

/** Permissive body envelope: legacy read `(req.body ?? {})` and validated
 *  fields mid-handler (body.all === true, truthy body.id, body.isRead !==
 *  false). The service applies the exact legacy checks in the original
 *  order. */
export const updateNotificationBodySchema = z.any();
export type UpdateNotificationBody = Record<string, unknown>;

// ─── POST /api/notifications/push ────────────────────────────────────────────

/** Permissive body envelope: legacy read `(req.body ?? {}) as Record<string,
 *  unknown>` and validated title/body, recipient resolution and the chat-only
 *  gate mid-handler. The service applies the exact legacy checks. */
export const pushNotificationBodySchema = z.any();
export type PushNotificationBody = Record<string, unknown>;
