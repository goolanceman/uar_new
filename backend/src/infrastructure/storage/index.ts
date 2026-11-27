/**
 * Storage driver abstraction — one interface, two backends:
 *  - "local" (default): files on disk under UPLOAD_DIR/media-store, uploads
 *    accepted through a signed PUT /api/media/upload/:token endpoint.
 *  - "s3": presigned S3 PUT URLs (@aws-sdk/client-s3) against any
 *    S3-compatible store (RustFS, Cloudflare R2, AWS S3).
 *
 * Selected by env STORAGE_DRIVER ("local" | "s3"). Keys are ALWAYS
 * server-generated (`media/<mediaId>/…`) and validated here so a driver can
 * never be handed a traversal path.
 */
import { ApiError } from "@/infrastructure/auth/session";
import { localStorage } from "./local";
import { s3Storage } from "./s3";

export interface PresignedUpload {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  /** ISO timestamp after which the presigned URL stops working. */
  expiresAt: string;
}

export interface HeadInfo {
  size: number;
  contentType?: string;
}

export interface StorageDriver {
  /** Presign a direct upload of exactly contentLength bytes with contentType. */
  presignPut(key: string, opts: { contentType: string; contentLength: number; expiresInSec: number; mediaId: string }): Promise<PresignedUpload>;
  /** Size (and best-effort content type) of the stored object, or null. */
  headObject(key: string): Promise<HeadInfo | null>;
  /** Download the object to a local file path. */
  downloadToFile(key: string, localPath: string): Promise<void>;
  /** Upload a local file into the store. */
  uploadFile(localPath: string, key: string, opts: { contentType: string; cacheControl?: string }): Promise<void>;
  /** Delete every object whose key starts with `prefix` (missing ones are fine). */
  deletePrefix(prefix: string): Promise<void>;
  /** Public playback URL for a stored object. */
  publicUrl(key: string): string;
  /**
   * A URL a player can GET, valid for `expiresInSec`. The local driver serves
   * publicly, so it returns the same URL as publicUrl. S3 returns a presigned
   * GET so private buckets (RustFS) stream without being world-readable.
   */
  presignGet(key: string, expiresInSec: number): Promise<string>;
}

/** Server-generated storage keys live under media/<id>/ — one strict charset,
 *  no "..", no leading slash. Throws ApiError(400) on anything else. */
export function validateStorageKey(key: string): string {
  if (!key || key.length > 500 || !/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new ApiError("Invalid storage key", 400);
  }
  return key;
}

/**
 * Which driver is active. The admin storage setting wins so the choice can be
 * changed from the web console without a redeploy; the env var is the fallback
 * for boot and for processes that never load settings (tests, the worker).
 */
export async function activeDriverName(): Promise<"local" | "s3"> {
  let fromSettings = "";
  try {
    // Lazy import: the settings layer imports db, and db imports storage.
    const { loadSettings } = await import("@/infrastructure/notifications/notify");
    const map = await loadSettings();
    fromSettings = map["storage.provider"] ?? "";
  } catch {
    // Settings unavailable — the env var decides.
  }
  const name = (fromSettings || process.env.STORAGE_DRIVER || "local").trim().toLowerCase();
  return name === "s3" ? "s3" : "local";
}

/** The driver for the current setting. Required S3 envs fail fast in ./s3. */
export async function getStorage(): Promise<StorageDriver> {
  return (await activeDriverName()) === "s3" ? s3Storage : localStorage;
}

// Env-selected driver for the transcoder and boot, which run before settings
// are loaded. Request paths use getStorage() so the admin setting applies.
export const storage: StorageDriver = (process.env.STORAGE_DRIVER || "local").trim().toLowerCase() === "s3" ? s3Storage : localStorage;

/**
 * Fail fast on a misconfigured driver — call from server startup so boot
 * crashes with a message naming the missing variables. The local driver has
 * no required vars (the signing secret is enforced when presigning); the s3
 * driver requires bucket + region and a PAIRED credential set.
 */
export function assertStorageConfig(): void {
  const driver = (process.env.STORAGE_DRIVER || "local").trim().toLowerCase();
  if (driver !== "s3") return;

  const missing: string[] = [];
  if (!process.env.S3_BUCKET?.trim()) missing.push("S3_BUCKET");
  if (!process.env.S3_REGION?.trim()) missing.push("S3_REGION");
  const hasKey = Boolean(process.env.S3_ACCESS_KEY_ID?.trim());
  const hasSecret = Boolean(process.env.S3_SECRET_ACCESS_KEY?.trim());
  if (hasKey !== hasSecret) missing.push(...(!hasKey ? ["S3_ACCESS_KEY_ID"] : ["S3_SECRET_ACCESS_KEY"]));
  if (missing.length > 0) {
    throw new Error(`STORAGE_DRIVER=s3 is misconfigured — missing environment variables: ${missing.join(", ")}`);
  }
}
