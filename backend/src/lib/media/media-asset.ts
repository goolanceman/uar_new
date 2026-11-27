/**
 * MediaAsset serializers — the /api/media polling shape (mediaJson) and the
 * playback fields embedded into reels / post contents (mediaWire). URLs come
 * from the active storage driver and are null unless the asset is ready.
 */
import type { MediaAsset } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ApiError } from "@/lib/session";
import { activeDriverName, getStorage } from "@/lib/storage";

const log = logger.child("media:asset");

/** How long a playback URL stays valid. Players re-fetch the reel to renew. */
const PLAYBACK_URL_TTL_SEC = 60 * 60;

/**
 * A URL the player can GET. Local storage serves the file itself, so the
 * plain URL is enough. S3 keeps the bucket private and signs a GET instead,
 * which still supports HTTP Range so the player can seek.
 */
async function playable(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const driver = await getStorage();
  return (await activeDriverName()) === "s3" ? driver.presignGet(key, PLAYBACK_URL_TTL_SEC) : driver.publicUrl(key);
}

/** Full asset shape for GET /api/media/:id + the complete response. */
export async function mediaJson(a: MediaAsset) {
  const ready = a.status === "ready";
  return {
    id: a.id,
    status: a.status,
    purpose: a.purpose,
    durationMs: a.durationMs ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
    aspectRatio: a.width && a.height ? a.width / a.height : null,
    hlsUrl: ready ? await playable(a.hlsKey) : null,
    mp4Url: ready ? await playable(a.mp4Key) : null,
    posterUrl: ready ? await playable(a.posterKey) : null,
    error: a.error ?? null,
  };
}

/** Playback fields spread into reel/post wires — status "ready" for rows with no media (legacy uploads). */
export async function mediaWire(a: MediaAsset | null | undefined) {
  const ready = !a || a.status === "ready";
  return {
    status: a ? a.status : "ready",
    durationMs: a?.durationMs ?? null,
    width: a?.width ?? null,
    height: a?.height ?? null,
    aspectRatio: a?.width && a.height ? a.width / a.height : null,
    hlsUrl: ready ? await playable(a?.hlsKey) : null,
    mp4Url: ready ? await playable(a?.mp4Key) : null,
    posterUrl: ready ? await playable(a?.posterKey) : null,
  };
}

const ATTACHABLE_STATUSES = ["uploaded", "processing", "ready"];

/** Validate that `mediaId` is attachable by `ownerId` for the given purpose —
 *  exists, owned, right purpose, non-terminal-but-progressed status, and not
 *  already attached to another reel / post content. Returns the asset or null
 *  when mediaId is absent. Throws ApiError otherwise. */
export async function assertAttachableMedia(
  ownerId: string,
  mediaId: string | null | undefined,
  purpose: "reel" | "post"
): Promise<MediaAsset | null> {
  if (!mediaId) return null;
  const asset = await db.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!asset || asset.ownerId !== ownerId) {
    log.warn("media_not_found", { mediaId, actor: ownerId, purpose });
    throw new ApiError("Media asset not found", 404);
  }
  if (asset.purpose !== purpose) {
    log.warn("media_purpose_mismatch", { mediaId, actor: ownerId, purpose, assetPurpose: asset.purpose });
    throw new ApiError(`This media was uploaded for a ${asset.purpose}, not a ${purpose}`, 400);
  }
  if (!ATTACHABLE_STATUSES.includes(asset.status)) {
    log.warn("media_not_uploaded_yet", { mediaId, actor: ownerId, status: asset.status });
    throw new ApiError("This media has not finished uploading yet", 400);
  }
  const attached =
    purpose === "reel"
      ? await db.communityReel.findFirst({ where: { mediaId }, select: { id: true } })
      : await db.communityPostContent.findFirst({ where: { mediaId }, select: { id: true } });
  if (attached) {
    log.warn("media_already_attached", { mediaId, actor: ownerId });
    throw new ApiError("This media is already attached to another reel or post", 400);
  }
  return asset;
}
