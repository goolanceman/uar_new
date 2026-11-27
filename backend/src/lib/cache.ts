/**
 * Optional Redis cache. Used to keep repeated reads off Postgres: immutable
 * file and ready-video lookups, plus catalog responses (campaigns, chat
 * lists, settings, FAQs, …) that many clients ask for unchanged.
 *
 * REDIS_URL unset, or Redis unreachable, is a no-op: callers fall through to
 * the database. Tests never set REDIS_URL, so they keep hitting Postgres.
 *
 * TTLs (seconds) are env-configurable. A missing or invalid value falls back
 * to the default in parentheses:
 *   CACHE_TTL_FILE (3600)        file + media asset rows
 *   CACHE_TTL_CAMPAIGN (60)      campaign list + detail
 *   CACHE_TTL_CHAT (15)          conversation list + message pages
 *   CACHE_TTL_SETTINGS (120)     settings map, public org, app config
 *   CACHE_TTL_CATALOG (300)      faqs, testimonials, masters, interests, music
 *   CACHE_TTL_CAUSES (60)        medical-cause list + detail
 *   CACHE_TTL_STATS (30)         public aggregate snapshot
 *   CACHE_LOCK_SEC (5)           stampede lock while a response is rebuilt
 *
 * Writes invalidate by prefix (SCAN + DEL). A missed invalidation is bounded
 * by the TTL — it never serves a deleted row forever.
 */
import Redis from "ioredis";
import { logger } from "@/lib/logger";

const log = logger.child("cache");

const URL = process.env.REDIS_URL?.trim() || "";

/** Read on every call so a process can change TTLs without a restart
 *  (tests set them before exercising a route). Invalid values fall back. */
export function ttl(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

const fileTtl = () => ttl("CACHE_TTL_FILE", 60 * 60);
const lockSec = () => Math.max(1, ttl("CACHE_LOCK_SEC", 5));

/** Public file row needed to stream /api/files/:id/file without a DB hit. */
export interface CachedFileAsset {
  id: string;
  name: string;
  storedName: string;
  mime: string;
  uploadedById: string | null;
}

/** Ready media row needed to stream /api/media/files/* without a DB hit. */
export interface CachedMediaAsset {
  id: string;
  status: string;
  /** Present once the worker has written a non-ready state. */
  ownerId?: string;
  attempts?: number;
  error?: string | null;
}

let client: Redis | null = null;
let connecting: Promise<Redis | null> | null = null;
let failed = false;

function redis(): Promise<Redis | null> {
  if (!URL || failed) return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  if (connecting) return connecting;
  // Connect once and wait for it. Commands issued before the socket is
  // ready are rejected (enableOfflineQueue is off), which used to make
  // every read miss and fall through to Postgres.
  const conn = new Redis(URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    lazyConnect: true,
  });
  conn.on("error", (err) => {
    // One log per outage — a dead Redis must not flood the API logs or
    // block a file request.
    if (!failed) log.error("redis_unavailable", { error: err.message });
    failed = true;
  });
  connecting = conn
    .connect()
    .then(() => {
      client = conn;
      return conn;
    })
    .catch(() => {
      failed = true;
      return null;
    })
    .finally(() => {
      connecting = null;
    });
  return connecting;
}

async function read<T>(key: string): Promise<T | null> {
  const conn = await redis();
  if (!conn) return null;
  try {
    const raw = await conn.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function write(key: string, value: unknown, ttlSec: number): Promise<void> {
  const conn = await redis();
  if (!conn) return;
  try {
    await conn.set(key, JSON.stringify(value), "EX", ttlSec);
  } catch {
    // Cache write failure is not a request failure.
  }
}

async function drop(key: string): Promise<void> {
  const conn = await redis();
  if (!conn) return;
  try {
    await conn.del(key);
  } catch {
    // Best-effort invalidation; the TTL is the backstop.
  }
}

/** Drop every key under a prefix. SCAN (not KEYS) so a large catalog does
 *  not block Redis. Used when a write changes a whole list, not one row. */
async function dropPrefix(prefix: string): Promise<void> {
  const conn = await redis();
  if (!conn) return;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await conn.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
      cursor = next;
      if (keys.length) await conn.del(...keys);
    } while (cursor !== "0");
  } catch {
    // Best-effort. The TTL expires whatever this scan missed.
  }
}

/** Stable cache-key fragment for a query object. Key order does not matter. */
export function cacheKeyPart(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${cacheKeyPart(v)}`).join("&");
}

/**
 * Read-through cache. `loader` runs only on a miss. A short lock stops a
 * burst of identical misses from all hitting Postgres at once; the waiters
 * re-read, and fall through to `loader` if the lock holder failed.
 *
 * ttlSec 0 disables the cache for that call (still a valid env override).
 * Redis down, or a loader throw, never hides the database result.
 */
export async function cached<T>(key: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
  if (ttlSec <= 0) return loader();
  const hit = await read<T>(key);
  if (hit !== null) return hit;

  const conn = await redis();
  if (!conn) return loader();

  const lockKey = `lock:${key}`;
  let gotLock = false;
  try {
    const set = await conn.set(lockKey, "1", "EX", lockSec(), "NX");
    gotLock = set === "OK";
  } catch {
    return loader();
  }

  if (!gotLock) {
    // Someone else is rebuilding. Give them a moment, then take whatever
    // they wrote — or load it ourselves if they didn't finish.
    await new Promise((r) => setTimeout(r, 40));
    const again = await read<T>(key);
    if (again !== null) return again;
  }

  try {
    const value = await loader();
    await write(key, value, ttlSec);
    return value;
  } finally {
    if (gotLock) {
      try {
        await conn.del(lockKey);
      } catch {
        // The lock expires on its own.
      }
    }
  }
}

const fileKey = (id: string) => `file:${id}`;
const mediaKey = (id: string) => `media:${id}`;

export function getCachedFile(id: string): Promise<CachedFileAsset | null> {
  return read<CachedFileAsset>(fileKey(id));
}

export function setCachedFile(asset: CachedFileAsset): Promise<void> {
  return write(fileKey(asset.id), asset, fileTtl());
}

export function invalidateFile(id: string): Promise<void> {
  return drop(fileKey(id));
}

export function getCachedMedia(id: string): Promise<CachedMediaAsset | null> {
  return read<CachedMediaAsset>(mediaKey(id));
}

/** Status of many videos in one round trip. Missing ids are absent from the
 *  map — the caller loads those from Postgres and caches them. */
export async function getCachedMediaMany(ids: string[]): Promise<Map<string, CachedMediaAsset>> {
  const found = new Map<string, CachedMediaAsset>();
  if (ids.length === 0) return found;
  const conn = await redis();
  if (!conn) return found;
  try {
    const raws = await conn.mget(...ids.map(mediaKey));
    raws.forEach((raw, i) => {
      if (!raw) return;
      try {
        found.set(ids[i], JSON.parse(raw) as CachedMediaAsset);
      } catch {
        // A corrupt entry is a miss.
      }
    });
  } catch {
    // Redis down — the caller falls back to the database.
  }
  return found;
}

export function setCachedMedia(asset: CachedMediaAsset): Promise<void> {
  return write(mediaKey(asset.id), asset, fileTtl());
}

/** A video that is no longer ready (deleted, failed, swept) must not keep
 *  serving from the cache. */
export function invalidateMedia(id: string): Promise<void> {
  return drop(mediaKey(id));
}

// ─── Transcode queue ─────────────────────────────────────────────────────────
// Ids of videos waiting to be transcoded. The worker checks this set instead
// of polling app_media_assets, so an empty queue never touches Postgres.
// Redis down is reported as "unknown" and the caller falls back to the
// database — a missing cache must not stall a video forever.
const TRANSCODE_QUEUE = "transcode:waiting";

export type QueueState = "empty" | "pending" | "unknown";

/** Add a video id to the waiting set. Called when an upload completes and
 *  when a failed attempt is put back for retry. */
export async function enqueueTranscode(id: string): Promise<void> {
  const conn = await redis();
  if (!conn) return;
  try {
    await conn.sadd(TRANSCODE_QUEUE, id);
  } catch {
    // Best-effort. The worker reconciles against the database.
  }
}

/** Drop a video id once it has been claimed, failed for good, or deleted. */
export async function dequeueTranscode(id: string): Promise<void> {
  const conn = await redis();
  if (!conn) return;
  try {
    await conn.srem(TRANSCODE_QUEUE, id);
  } catch {
    // The TTL-free set is reconciled by the worker, so a missed remove
    // costs one extra claim attempt, not a stuck video.
  }
}

/** Whether anything is waiting. `unknown` means Redis can't answer, and the
 *  caller should ask the database. */
export async function transcodeQueueState(): Promise<QueueState> {
  const conn = await redis();
  if (!conn) return "unknown";
  try {
    const count = await conn.scard(TRANSCODE_QUEUE);
    return count > 0 ? "pending" : "empty";
  } catch {
    return "unknown";
  }
}

/** One waiting id, or null. The worker still claims it in Postgres — this
 *  only decides whether that claim is worth running. */
export async function nextWaitingTranscode(): Promise<string | null> {
  const conn = await redis();
  if (!conn) return null;
  try {
    return await conn.spop(TRANSCODE_QUEUE);
  } catch {
    return null;
  }
}

// ─── Response cache (campaigns, chat, catalogs) ─────────────────────────────
// Prefixes are the invalidation unit: a create/update/delete drops every
// variant of that resource (filters, pages, admin vs public) in one scan.

const P = {
  campaign: "resp:campaign:",
  chat: "resp:chat:",
  settings: "resp:settings:",
  catalog: "resp:catalog:",
  causes: "resp:causes:",
  stats: "resp:stats:",
} as const;

export const cacheTtl = {
  get campaign() {
    return ttl("CACHE_TTL_CAMPAIGN", 60);
  },
  get chat() {
    return ttl("CACHE_TTL_CHAT", 15);
  },
  get settings() {
    return ttl("CACHE_TTL_SETTINGS", 120);
  },
  get catalog() {
    return ttl("CACHE_TTL_CATALOG", 300);
  },
  get causes() {
    return ttl("CACHE_TTL_CAUSES", 60);
  },
  get stats() {
    return ttl("CACHE_TTL_STATS", 30);
  },
};

export function campaignListKey(variant: string): string {
  return `${P.campaign}list:${variant}`;
}
export function campaignDetailKey(idOrSlug: string): string {
  return `${P.campaign}detail:${idOrSlug}`;
}

/** Conversation list for one user, or a message page of one conversation. */
export function chatListKey(userId: string): string {
  return `${P.chat}list:${userId}`;
}
export function chatMessagesKey(conversationId: string, userId: string, before: string, limit: number): string {
  return `${P.chat}msgs:${conversationId}:${userId}:${before || "-"}:${limit}`;
}

export function settingsKey(kind: "map" | "public" | "app" | "admin"): string {
  return `${P.settings}${kind}`;
}

export function catalogKey(name: string, variant: string): string {
  return `${P.catalog}${name}:${variant}`;
}

export function causesListKey(variant: string): string {
  return `${P.causes}list:${variant}`;
}
export function causeDetailKey(id: string): string {
  return `${P.causes}detail:${id}`;
}

export function statsKey(variant: string): string {
  return `${P.stats}${variant}`;
}

/** Drop every cached campaign list and detail. Called on campaign writes and
 *  whenever a donation changes raisedAmount. */
export function invalidateCampaigns(): Promise<void> {
  return dropPrefix(P.campaign);
}

/** Drop one user's conversation list, or every chat page when a message
 *  lands (both participants, plus any group member list). */
export function invalidateChatUser(userId: string): Promise<void> {
  return dropPrefix(`${P.chat}list:${userId}`);
}
export function invalidateChatConversation(conversationId: string): Promise<void> {
  return dropPrefix(`${P.chat}msgs:${conversationId}:`);
}
export function invalidateChatAll(): Promise<void> {
  return dropPrefix(P.chat);
}

export function invalidateSettings(): Promise<void> {
  return dropPrefix(P.settings);
}

/** `name` is faqs | testimonials | masters | interests | music. Omit to drop
 *  the whole catalog (a settings change can affect several of them). */
export function invalidateCatalog(name?: string): Promise<void> {
  return dropPrefix(name ? `${P.catalog}${name}:` : P.catalog);
}

export function invalidateCauses(): Promise<void> {
  return dropPrefix(P.causes);
}

export function invalidateStats(): Promise<void> {
  return dropPrefix(P.stats);
}
