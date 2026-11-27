/**
 * Media service — presigning, upload verification, completion, polling and
 * the playback existence checks for /api/media. Depends on the repository
 * contract plus the storage/transcoder/cache infrastructure libs (contracts
 * unchanged); never touches HTTP. The byte streaming itself is transport and
 * lives in the controller.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { logger } from "@/infrastructure/logging/logger";
import type { Session } from "@/infrastructure/auth/session";
import { ApiError } from "@/shared/errors";
import { checkRateLimit } from "@/infrastructure/cache/rate-limit";
import { UPLOAD_DIR } from "@/domains/files";
import { getStorage, validateStorageKey } from "@/infrastructure/storage";
import { verifyUploadToken, type UploadTokenClaims } from "@/infrastructure/storage/signing";
import { mediaJson } from "@/infrastructure/media/media-asset";
import { getCachedMedia, setCachedMedia, type CachedMediaAsset } from "@/infrastructure/cache";
import { markMediaUploaded } from "@/jobs/workers/transcoder.worker";
import type { MediaRepository } from "../repositories/media.repository.interface";

const log = logger.child("media");

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

type MediaWire = Awaited<ReturnType<typeof mediaJson>>;

export interface UploadReceiverClaims extends UploadTokenClaims {}

export class MediaService {
  constructor(private readonly mediaRepository: MediaRepository) {}

  /** POST /api/media/uploads — presign a direct video upload. */
  async presignUpload(
    session: Session,
    rawBody: Record<string, unknown>
  ): Promise<{ mediaId: string; upload: { url: string; method: "PUT"; headers: Record<string, string> }; expiresAt: string }> {
    const b = (rawBody ?? {}) as Record<string, unknown>;

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
    const inFlight = await this.mediaRepository.countInFlight(session.userId, stalePendingBefore);
    if (inFlight >= MAX_CONCURRENT_ASSETS) {
      log.warn("media_upload_concurrency_rejected", { actor: session.userId, inFlight });
      throw new ApiError("You already have several videos processing. Wait for them to finish first.", 429);
    }

    const asset = await this.mediaRepository.create({
      ownerId: session.userId,
      purpose,
      sourceKey: "",
      sourceMime: contentType,
      sourceSize: size,
    });
    const sourceKey = `media/${asset.id}/source.${EXTENSION_BY_MIME[contentType] ?? "bin"}`;
    await this.mediaRepository.updateSourceKey(asset.id, sourceKey);

    // Direct to the object store. The phone PUTs the bytes to RustFS itself;
    // the API only hands out the signed URL.
    const presigned = await (await getStorage()).presignPut(sourceKey, {
      contentType,
      contentLength: size,
      expiresInSec: UPLOAD_URL_TTL_SEC,
      mediaId: asset.id,
    });

    log.info("media_upload_presigned", {
      mediaId: asset.id,
      purpose,
      contentType,
      size,
      actor: session.userId,
    });

    return {
      mediaId: asset.id,
      upload: { url: presigned.url, method: presigned.method, headers: presigned.headers },
      expiresAt: presigned.expiresAt,
    };
  }

  /**
   * PUT /api/media/upload/:token — verify the presigned-upload token and the
   * asset state BEFORE any bytes flow. The token IS the auth (HMAC-signed,
   * carries key + contentType + contentLength + expiry).
   */
  async verifyReceiver(rawToken: unknown): Promise<UploadReceiverClaims> {
    const claims = verifyUploadToken(String(rawToken ?? ""));
    if (!claims) throw new ApiError("Invalid or expired upload token", 400);
    validateStorageKey(claims.key);

    const asset = await this.mediaRepository.findById(claims.mediaId);
    if (!asset || asset.sourceKey !== claims.key) throw new ApiError("Invalid or expired upload token", 400);
    if (asset.status !== "pending_upload") {
      log.warn("media_upload_already_finalized", { mediaId: asset.id, status: asset.status });
      throw new ApiError("This upload was already finalized", 409);
    }
    return claims;
  }

  /** Transport-side completion event — logged after the bytes hit the disk. */
  async markReceived(mediaId: string, size: number): Promise<void> {
    log.info("media_upload_received", { mediaId, size });
  }

  /** POST /api/media/:id/complete — owner confirms the bytes landed. */
  async complete(session: Session, rawId: unknown): Promise<MediaWire> {
    const id = String(rawId ?? "").trim();
    if (!id) throw new ApiError("Media id is required", 400);

    const asset = await this.mediaRepository.findById(id);
    if (!asset) {
      log.warn("media_complete_not_found", { mediaId: id, actor: session.userId });
      throw new ApiError("Media asset not found", 404);
    }
    if (asset.ownerId !== session.userId) {
      log.warn("media_complete_not_owner", { mediaId: id, actor: session.userId });
      throw new ApiError("You do not have permission for this action", 403);
    }

    if (asset.status === "pending_upload") {
      const head = await (await getStorage()).headObject(asset.sourceKey);
      if (!head) throw new ApiError("Upload has not reached the storage yet", 400);
      if (head.size !== asset.sourceSize) {
        throw new ApiError("Stored size does not match the declared upload size", 400);
      }
      // Records the uploaded state, announces it, and queues the id.
      const updated = await markMediaUploaded(asset.id);
      log.info("media_completed", { mediaId: updated.id, status: updated.status, actor: session.userId });
      return mediaJson(updated);
    }

    // uploaded / processing / ready — already complete, return the current state.
    log.debug("media_complete_already_done", { mediaId: asset.id, status: asset.status });
    return mediaJson(asset);
  }

  /** GET /api/media/:id — owner-only polling (upload + transcode progress). */
  async poll(
    session: Session,
    rawId: unknown
  ): Promise<MediaWire | { id: string; status: string; error?: string | null; attempts?: number }> {
    const id = String(rawId ?? "").trim();
    if (!id) throw new ApiError("Media id is required", 400);

    // The publish screen polls this every few seconds, so answer from the
    // cache the worker writes on each state change. A miss (or a cache that
    // only holds ready videos) falls back to Postgres.
    const cached = await getCachedMedia(id);
    if (cached && cached.status !== "ready") {
      if (cached.ownerId !== session.userId) {
        log.warn("media_poll_not_owner", { mediaId: id, actor: session.userId });
        throw new ApiError("You do not have permission for this action", 403);
      }
      return { id: cached.id, status: cached.status, error: cached.error, attempts: cached.attempts };
    }

    const asset = await this.mediaRepository.findById(id);
    if (!asset) throw new ApiError("Media asset not found", 404);
    if (asset.ownerId !== session.userId) {
      log.warn("media_poll_not_owner", { mediaId: id, actor: session.userId });
      throw new ApiError("You do not have permission for this action", 403);
    }

    return mediaJson(asset);
  }

  /**
   * GET /api/media/files/* — resolve a playback key to a servable local file.
   * Only outputs of READY assets are exposed (never source.*); the driver
   * must be local. Returns the absolute path + size for the range streaming
   * the controller performs.
   */
  async resolvePlayback(key: string): Promise<{ filePath: string; size: number }> {
    if ((process.env.STORAGE_DRIVER || "local").trim().toLowerCase() !== "local") {
      throw new ApiError("Not found", 404);
    }

    validateStorageKey(key);

    // Keys are media/<assetId>/… — the asset must exist and be ready.
    // One playback is a playlist plus a request per segment, and a ready
    // asset's outputs never change, so that check is cached. A miss, or
    // Redis being down, falls through to Postgres as before.
    const segments = key.split("/");
    if (segments.length < 3 || segments[0] !== "media") throw new ApiError("Not found", 404);
    const mediaId = segments[1];
    const cached: CachedMediaAsset | null = await getCachedMedia(mediaId);
    if (!cached) {
      const asset = await this.mediaRepository.findPlaybackRef(mediaId);
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

    return { filePath, size: stat.size };
  }
}
