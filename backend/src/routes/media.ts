/**
 * Media routes — /api/media: presigned direct video uploads, the local-driver
 * PUT receiver, the transcode polling endpoint and public playback serving
 * (HLS segments / MP4 / poster) with HTTP Range support.
 *
 * Flow: POST /uploads → presigned PUT → POST /:id/complete → the transcoder
 * worker (lib/media/transcoder.ts) moves the asset to "ready" → playback URLs
 * resolve through (await getStorage()).publicUrl.
 */
import { promises as fs, createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import { db } from "@/lib/db";
import { requireAuth, json, handleError, ApiError } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { UPLOAD_DIR } from "@/lib/files";
import { getStorage, validateStorageKey } from "@/lib/storage";
import { verifyUploadToken } from "@/lib/media/signing";
import { mediaJson } from "@/lib/media/media-asset";
import { getCachedMedia, setCachedMedia } from "@/lib/cache";
import { markMediaUploaded } from "@/lib/media/transcoder";

export const router = Router();

const ALLOWED_VIDEO_MIMES: ReadonlySet<string> = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
]);
const EXTENSION_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/webm": "webm",
};

const MAX_VIDEO_UPLOAD_BYTES = Number(process.env.MAX_VIDEO_UPLOAD_BYTES || 200 * 1024 * 1024);
const UPLOAD_URL_TTL_SEC = 15 * 60;
const MAX_CONCURRENT_ASSETS = 5;

// Content types for the public playback files (kept here — local serving only).
const MIME_BY_EXTENSION: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/** Long-immutable outputs; playlists change when the ladder changes. */
function cacheControlFor(key: string): string {
  return key.endsWith(".m3u8") ? "public, max-age=60" : "public, max-age=31536000, immutable";
}

// POST /api/media/uploads — presign a direct video upload (session required).
router.post("/uploads", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;

    const purpose = String(b.purpose ?? "").trim();
    if (purpose !== "reel" && purpose !== "post") throw new ApiError("purpose must be reel or post", 400);

    const contentType = String(b.contentType ?? "").trim().toLowerCase();
    if (!ALLOWED_VIDEO_MIMES.has(contentType)) {
      throw new ApiError("contentType must be one of video/mp4, video/quicktime, video/x-m4v, video/webm", 400);
    }

    const size = Number(b.size);
    if (!Number.isInteger(size) || size <= 0) throw new ApiError("size must be a positive integer", 400);
    if (size > MAX_VIDEO_UPLOAD_BYTES) {
      throw new ApiError(`Video exceeds the ${Math.round(MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024))} MB upload limit`, 400);
    }

    const rl = checkRateLimit(`media-upload:${session.userId}`, 20, 60 * 60 * 1000);
    if (!rl.allowed) {
      throw new ApiError("Too many uploads. Please try again later.", 429);
    }

    // Cap the pipeline queue per user — non-terminal = awaiting upload/processing.
    // Stale pending_upload rows (URL expired past the TTL, upload abandoned)
    // don't count — otherwise a user who cancels 5 uploads is blocked forever.
    const stalePendingBefore = new Date(Date.now() - UPLOAD_URL_TTL_SEC * 1000);
    const inFlight = await db.mediaAsset.count({
      where: {
        ownerId: session.userId,
        status: { in: ["pending_upload", "uploaded", "processing"] },
        OR: [{ status: { not: "pending_upload" } }, { createdAt: { gte: stalePendingBefore } }],
      },
    });
    if (inFlight >= MAX_CONCURRENT_ASSETS) {
      throw new ApiError("You already have several videos processing. Wait for them to finish first.", 429);
    }

    const asset = await db.mediaAsset.create({
      data: {
        ownerId: session.userId,
        purpose,
        sourceKey: "",
        sourceMime: contentType,
        sourceSize: size,
      },
    });
    const sourceKey = `media/${asset.id}/source.${EXTENSION_BY_MIME[contentType] ?? "bin"}`;
    await db.mediaAsset.update({ where: { id: asset.id }, data: { sourceKey } });

    // Direct to the object store. The phone PUTs the bytes to RustFS itself;
    // the API only hands out the signed URL.
    const presigned = await (await getStorage()).presignPut(sourceKey, {
      contentType,
      contentLength: size,
      expiresInSec: UPLOAD_URL_TTL_SEC,
      mediaId: asset.id,
    });

    return json(res, { mediaId: asset.id, upload: { url: presigned.url, method: presigned.method, headers: presigned.headers }, expiresAt: presigned.expiresAt }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PUT /api/media/upload/:token — local-driver receiver. The token IS the auth
// (no session): it is HMAC-signed and carries key + contentType + contentLength
// + expiry. The body is the raw file bytes — streamed straight to disk, never
// buffered in memory and never touched by express.json (video/mp4 does not
// match the JSON parser).
router.put("/upload/:token", async (req, res) => {
  try {
    const claims = verifyUploadToken(String((req.params as Record<string, string>).token ?? ""));
    if (!claims) throw new ApiError("Invalid or expired upload token", 400);
    validateStorageKey(claims.key);

    const asset = await db.mediaAsset.findUnique({ where: { id: claims.mediaId } });
    if (!asset || asset.sourceKey !== claims.key) throw new ApiError("Invalid or expired upload token", 400);
    if (asset.status !== "pending_upload") {
      throw new ApiError("This upload was already finalized", 409);
    }

    // Content-Type must equal the presigned one (mime portion, params ignored).
    const got = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (got !== claims.contentType.toLowerCase()) throw new ApiError("Content-Type does not match the presigned upload", 400);

    const declared = Number(claims.contentLength);
    const key = claims.key;
    const target = path.join(UPLOAD_DIR, "media-store", key);
    if (!path.resolve(target).startsWith(path.join(UPLOAD_DIR, "media-store") + path.sep)) {
      throw new ApiError("Invalid storage key", 400);
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmpPath = path.join(UPLOAD_DIR, "media-store", `tmp-${randomUUID()}.part`);

    // Stream the request body to a temp file (counting bytes), then atomically
    // rename into place — the body never passes through a body parser.
    let received = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length;
        if (received > declared) {
          cb(new ApiError("Upload exceeds the presigned size", 413));
          return;
        }
        cb(null, chunk);
      },
    });

    try {
      await pipeline(req, counter, createWriteStream(tmpPath));
    } catch (e) {
      await fs.unlink(tmpPath).catch(() => {});
      throw e;
    }

    if (received !== declared) {
      await fs.unlink(tmpPath).catch(() => {});
      throw new ApiError("Uploaded size does not match the presigned content length", 400);
    }

    await fs.rename(tmpPath, target);
    return json(res, { ok: true });
  } catch (e) {
    // Drain (or discard) the request body before erroring — answering without
    // consuming it can reset the client socket before it reads the response.
    req.resume();
    return handleError(e, res);
  }
});

// POST /api/media/:id/complete — owner confirms the bytes landed. Verifies the
// stored object exists with the declared size, then hands the asset to the
// transcoder queue (idempotent for already-uploaded/processing/ready assets).
router.post("/:id/complete", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const id = String((req.params as Record<string, string>).id ?? "").trim();
    if (!id) throw new ApiError("Media id is required", 400);

    const asset = await db.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new ApiError("Media asset not found", 404);
    if (asset.ownerId !== session.userId) throw new ApiError("You do not have permission for this action", 403);

    if (asset.status === "pending_upload") {
      const head = await (await getStorage()).headObject(asset.sourceKey);
      if (!head) throw new ApiError("Upload has not reached the storage yet", 400);
      if (head.size !== asset.sourceSize) {
        throw new ApiError("Stored size does not match the declared upload size", 400);
      }
      // Records the uploaded state, announces it, and queues the id.
      const updated = await markMediaUploaded(asset.id);
      return json(res, await mediaJson(updated));
    }

    // uploaded / processing / ready — already complete, return the current state.
    return json(res, await mediaJson(asset));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/media/:id — owner-only polling endpoint (upload + transcode progress).
router.get("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const id = String((req.params as Record<string, string>).id ?? "").trim();
    if (!id) throw new ApiError("Media id is required", 400);

    // The publish screen polls this every few seconds, so answer from the
    // cache the worker writes on each state change. A miss (or a cache that
    // only holds ready videos) falls back to Postgres.
    const cached = await getCachedMedia(id);
    if (cached && cached.status !== "ready") {
      if (cached.ownerId !== session.userId) throw new ApiError("You do not have permission for this action", 403);
      return json(res, { id: cached.id, status: cached.status, error: cached.error, attempts: cached.attempts });
    }

    const asset = await db.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new ApiError("Media asset not found", 404);
    if (asset.ownerId !== session.userId) throw new ApiError("You do not have permission for this action", 403);

    return json(res, await mediaJson(asset));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/media/files/* — public playback serving (local driver only). Only
// outputs of READY assets are exposed (never source.*), with Range support so
// players can seek.
router.get("/files/*", async (req, res) => {
  try {
    if ((process.env.STORAGE_DRIVER || "local").trim().toLowerCase() !== "local") {
      throw new ApiError("Not found", 404);
    }

    const wildcard = (req.params as Record<string, string | string[]>)[0];
    const key = decodeURIComponent(Array.isArray(wildcard) ? wildcard.join("/") : String(wildcard ?? ""));
    validateStorageKey(key);

    // Keys are media/<assetId>/… — the asset must exist and be ready.
    // One playback is a playlist plus a request per segment, and a ready
    // asset's outputs never change, so that check is cached. A miss, or
    // Redis being down, falls through to Postgres as before.
    const segments = key.split("/");
    if (segments.length < 3 || segments[0] !== "media") throw new ApiError("Not found", 404);
    const mediaId = segments[1];
    const cached = await getCachedMedia(mediaId);
    if (!cached) {
      const asset = await db.mediaAsset.findUnique({
        where: { id: mediaId },
        select: { id: true, status: true },
      });
      if (!asset || asset.status !== "ready") throw new ApiError("Not found", 404);
      await setCachedMedia(asset);
    }
    // Never serve the raw source publicly — playback uses the transcoded outputs.
    if (segments[segments.length - 1].startsWith("source.")) throw new ApiError("Not found", 404);

    const storeRoot = path.join(UPLOAD_DIR, "media-store");
    const filePath = path.resolve(storeRoot, key);
    if (!filePath.startsWith(storeRoot + path.sep)) throw new ApiError("Invalid storage key", 400);

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      throw new ApiError("Not found", 404);
    }
    if (!stat.isFile()) throw new ApiError("Not found", 404);

    const ext = path.extname(key).toLowerCase();
    const mime = MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", cacheControlFor(key));
    res.setHeader("X-Content-Type-Options", "nosniff");

    const range = String(req.headers.range ?? "");
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (range && !match) {
      res.status(416).setHeader("Content-Range", `bytes */${stat.size}`);
      return res.end();
    }

    if (match && (match[1] !== "" || match[2] !== "")) {
      let start: number;
      let end: number;
      if (match[1] === "") {
        // suffix range: bytes=-N → the last N bytes
        start = Math.max(0, stat.size - Number(match[2]));
        end = stat.size - 1;
      } else {
        start = Number(match[1]);
        end = match[2] === "" ? stat.size - 1 : Number(match[2]);
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        res.status(416).setHeader("Content-Range", `bytes */${stat.size}`);
        return res.end();
      }
      end = Math.min(end, stat.size - 1);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      res.setHeader("Content-Length", String(end - start + 1));
      const stream = createReadStream(filePath, { start, end });
      stream.on("error", () => res.end());
      return stream.pipe(res);
    }

    res.status(200);
    res.setHeader("Content-Length", String(stat.size));
    const stream = createReadStream(filePath);
    stream.on("error", () => res.end());
    return stream.pipe(res);
  } catch (e) {
    return handleError(e, res);
  }
});
