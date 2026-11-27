/**
 * Minimal in-process rate limiter for sensitive unauthenticated endpoints
 * (login, register) to blunt brute-force / credential-stuffing and signup
 * abuse. This is a single-instance, best-effort control — it resets on
 * restart and does not share state across horizontally-scaled instances —
 * but the app currently runs as a single standalone Node process (see
 * package.json `start` script), so it meaningfully raises the cost of
 * automated attacks without adding external infra (Redis, etc.).
 */
import { logger } from "@/lib/logger";

const log = logger.child("rate-limit");

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodically drop expired buckets so this never grows unbounded.
function sweep(now: number) {
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

let lastSweep = 0;

/**
 * Returns true and records an attempt if the caller is still within
 * `limit` attempts per `windowMs` for the given key; returns false
 * (and does not record) once the limit is exceeded, until the window
 * resets.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  if (now - lastSweep > windowMs) {
    sweep(now);
    lastSweep = now;
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    log.warn("rate_limit_exceeded", {
      key,
      limit,
      retryAfterMs: existing.resetAt - now,
    });
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

/** Drops one bucket — used when a configured limit changes so the new limit
 *  takes effect immediately instead of after the current window expires. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Best-effort client IP from standard proxy headers set by Caddyfile.
 *  Accepts either a fetch `Headers` object or Express `req.headers`. */
export function clientIp(h: Headers | Record<string, string | string[] | undefined>): string {
  const get = (k: string): string | undefined => {
    if (typeof (h as Headers).get === "function") return (h as Headers).get(k) ?? undefined;
    const v = (h as Record<string, string | string[] | undefined>)[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const xff = get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return get("x-real-ip")?.trim() ?? "unknown";
}
