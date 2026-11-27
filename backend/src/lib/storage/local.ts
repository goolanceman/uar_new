/**
 * Local filesystem storage driver — files under UPLOAD_DIR/media-store
 * (UPLOAD_DIR comes from lib/files.ts, so the test/dev/upload layout keeps
 * working). Direct uploads arrive at PUT /api/media/upload/:token where the
 * HMAC-signed token carries key + contentType + contentLength + expiry.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { UPLOAD_DIR } from "@/lib/files";
import { ApiError } from "@/lib/session";
import { signUploadToken } from "@/lib/media/signing";
import { validateStorageKey, type HeadInfo, type PresignedUpload, type StorageDriver } from "./index";

const ROOT = path.join(UPLOAD_DIR, "media-store");

/** Resolve a key under the store root, refusing anything that escapes it. */
function resolveKey(key: string): string {
  validateStorageKey(key);
  const resolved = path.resolve(ROOT, key);
  const dirWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (!resolved.startsWith(dirWithSep)) throw new ApiError("Invalid storage key", 400);
  return resolved;
}

export const localStorage: StorageDriver = {
  async presignPut(key, opts): Promise<PresignedUpload> {
    validateStorageKey(key);
    const exp = Date.now() + opts.expiresInSec * 1000;
    const token = signUploadToken({
      key,
      contentType: opts.contentType,
      contentLength: opts.contentLength,
      exp,
      mediaId: opts.mediaId,
    });
    const base = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, "") : "";
    return {
      url: `${base}/api/media/upload/${token}`,
      method: "PUT",
      headers: { "Content-Type": opts.contentType },
      expiresAt: new Date(exp).toISOString(),
    };
  },

  async headObject(key): Promise<HeadInfo | null> {
    try {
      const stat = await fs.stat(resolveKey(key));
      if (!stat.isFile()) return null;
      return { size: stat.size };
    } catch {
      return null;
    }
  },

  async downloadToFile(key, localPath): Promise<void> {
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.copyFile(resolveKey(key), localPath);
  },

  async uploadFile(localPath, key, _opts): Promise<void> {
    const target = resolveKey(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(localPath, target);
  },

  async deletePrefix(prefix): Promise<void> {
    // A prefix may be a single file (the source object) or a directory (media/<id>/).
    await fs.rm(resolveKey(prefix), { recursive: true, force: true });
  },

  publicUrl(key): string {
    validateStorageKey(key);
    const base = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, "") : "";
    return `${base}/api/media/files/${key}`;
  },

  // Local files are served by the API itself, so a signed read is unnecessary.
  async presignGet(key): Promise<string> {
    return this.publicUrl(key);
  },
};
