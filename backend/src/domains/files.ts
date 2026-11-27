import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FileAsset } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { ApiError } from "@/infrastructure/auth/session";

// ─── Security-first configuration ────────────────────────────────────────────
// Allowlist only: no .svg (stored XSS), no .html/.js/.exe/.sh/.bat.
export const ALLOWED_MIMES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "application/pdf",
  "text/csv",
  "application/json",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "audio/mpeg",
  "audio/wav",
  "video/mp4",
]);

// Extensions each mime may carry — used for extension-vs-mime consistency.
const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "image/avif": [".avif"],
  "image/heic": [".heic", ".heif"],
  "application/pdf": [".pdf"],
  "text/csv": [".csv"],
  "application/json": [".json"],
  "text/plain": [".txt", ".log", ".md"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "audio/mpeg": [".mp3"],
  "audio/wav": [".wav"],
  "video/mp4": [".mp4"],
};

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILENAME_LENGTH = 120;
const FOLDER_PATTERN = /^[a-z0-9-_]{1,60}$/;

/** Reverse lookup: mime that owns this extension, from the allowlist only. */
function inferMimeFromExtension(ext: string): string | undefined {
  for (const [mime, exts] of Object.entries(MIME_EXTENSIONS)) {
    if (exts.includes(ext)) return mime;
  }
  return undefined;
}

export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(process.cwd(), "upload");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip path separators/control characters, collapse whitespace, keep the extension, cap length. */
export function sanitizeFileName(raw: string): string {
  // Drop every directory component ("a/b/c.jpg", "..\\..\\x") in one move.
  let name = raw.split(/[\\/]+/).pop() ?? "";
  // Remove control characters (including newlines that could spoof headers).
  name = Array.from(name)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("");
  name = name.replace(/\s+/g, " ").trim();
  // Never start with a dot (hidden files / traversal tricks).
  name = name.replace(/^[.\s]+/, "");
  if (!name) return "file";
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  const maxStem = Math.max(1, MAX_FILENAME_LENGTH - ext.length);
  return `${stem.slice(0, maxStem)}${ext}`;
}

/** Lowercase and strip everything outside [a-z0-9-_]; falls back to "general". */
export function sanitizeFolder(raw: string | null | undefined): string {
  const cleaned = (raw ?? "").toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 60);
  return cleaned || "general";
}

/** Strict check for client-supplied folder values (PATCH). */
export function validFolder(raw: string): boolean {
  return FOLDER_PATTERN.test(raw);
}

/**
 * Resolve a stored name to an absolute path, refusing anything that escapes
 * the upload directory (defense in depth against path traversal).
 */
export function resolveStoredPath(storedName: string): string {
  // Stored names never contain separators, but never trust that blindly.
  const safeName = path.basename(storedName);
  const resolved = path.resolve(UPLOAD_DIR, safeName);
  const dirWithSep = UPLOAD_DIR.endsWith(path.sep) ? UPLOAD_DIR : UPLOAD_DIR + path.sep;
  if (resolved !== UPLOAD_DIR && !resolved.startsWith(dirWithSep)) {
    throw new ApiError("Invalid file path", 400);
  }
  return resolved;
}

/** Human-readable byte size, e.g. "1.5 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${i === 0 ? Math.round(value) : Math.round(value * 10) / 10} ${units[i]}`;
}

/** Canonical URL for serving a stored file. */
export function fileUrl(id: string): string {
  return `/api/files/${id}/file`;
}

// ─── Upload / delete ─────────────────────────────────────────────────────────

export interface UploadedBy {
  id?: string;
  name?: string;
}

export interface SaveUploadOptions {
  folder?: string;
  uploadedBy?: UploadedBy;
}

/**
 * Validate + persist one uploaded file to disk and register it in the DB.
 * The disk write happens before the DB row; if the DB insert fails the bytes
 * are removed so nothing is orphaned.
 */
export async function saveUpload(file: File, opts: SaveUploadOptions = {}): Promise<FileAsset> {
  const name = sanitizeFileName(file.name || "file");
  const ext = path.extname(name).toLowerCase();

  // Clients that cannot sniff content (curl, some OSes) send the generic
  // octet-stream type — fall back to the extension via the allowlist.
  let mime = file.type;
  if (!mime || mime === "application/octet-stream") {
    const inferred = inferMimeFromExtension(ext);
    if (!inferred) {
      throw new ApiError(
        `File type "${file.type || "unknown"}" is not allowed. Allowed: images, PDF, CSV, JSON, text, Office documents, audio and MP4 video.`,
        400
      );
    }
    mime = inferred;
  } else if (!ALLOWED_MIMES.has(mime)) {
    throw new ApiError(
      `File type "${mime}" is not allowed. Allowed: images, PDF, CSV, JSON, text, Office documents, audio and MP4 video.`,
      400
    );
  }

  if (file.size <= 0) throw new ApiError("File is empty", 400);
  if (file.size > MAX_FILE_BYTES) {
    throw new ApiError(`"${file.name}" exceeds the ${formatBytes(MAX_FILE_BYTES)} limit`, 400);
  }

  const allowedExts = MIME_EXTENSIONS[mime];
  if (allowedExts && ext && !allowedExts.includes(ext)) {
    throw new ApiError(`Extension "${ext}" does not match the file type ${mime}`, 400);
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const storedName = `${randomUUID()}-${name}`;
  const target = resolveStoredPath(storedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(target, buffer);

  try {
    return await db.fileAsset.create({
      data: {
        name,
        storedName,
        mime,
        size: file.size,
        folder: opts.folder ?? "general",
        uploadedById: opts.uploadedBy?.id ?? null,
        uploadedByName: opts.uploadedBy?.name ?? null,
      },
    });
  } catch (e) {
    // DB write failed — do not orphan the bytes on disk.
    await fs.unlink(target).catch(() => {});
    throw e;
  }
}

/** Remove a stored file from disk; a missing file is not an error. */
export async function deleteStored(storedName: string): Promise<void> {
  try {
    await fs.unlink(resolveStoredPath(storedName));
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
  }
}

const MAX_URL_ITEMS = 20;
const MAX_URL_LENGTH = 500;

/**
 * Validate a client-supplied list of asset URLs (accepts a JSON string array
 * or a raw array of strings) and re-serialize it for a JSON string column.
 * Returns null for empty/absent input; throws ApiError(400) when malformed —
 * keeps size and entry count bounded.
 */
export function parseUrlList(value: unknown, label = "urls"): string | null {
  if (value === undefined || value === null || value === "") return null;
  let raw: unknown[];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) throw new Error("not an array");
    raw = parsed;
  } catch {
    throw new ApiError(`${label} must be a JSON array of strings`, 400);
  }
  if (raw.length > MAX_URL_ITEMS)
    throw new ApiError(`${label} accepts at most ${MAX_URL_ITEMS} entries`, 400);
  const urls = raw
    .map((u) => String(u ?? "").trim())
    .filter(Boolean)
    .map((u) => {
      if (u.length > MAX_URL_LENGTH)
        throw new ApiError(`${label} entries must be ≤ ${MAX_URL_LENGTH} characters`, 400);
      // Only relative asset urls or absolute http(s) urls are accepted.
      if (!/^(\/(api\/files\/|public\/|uploads?\/)|https?:\/\/)/i.test(u))
        throw new ApiError(`${label} contains an unsupported url`, 400);
      return u;
    });
  return urls.length > 0 ? JSON.stringify(urls) : null;
}
