/**
 * Reels routes — /api/reels (shared by web + mobile).
 *
 * Generic REST port of the legacy mobile reel endpoints (ReelController via
 * src/routes/mobile/reels-rooms.ts + the Moderator reel deletions in
 * auth-users.ts). The actor is ALWAYS the session user — ids never come from
 * the body; moderation (delete reel / delete comment) additionally accepts
 * ADMIN/MODERATOR roles and the DB `user.isModerator` flag.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth, ApiError, json, handleError } from "@/lib/session";
import { logger } from "@/lib/logger";
import { multipart, multipartErrorHandler } from "@/lib/multipart";
import { saveUpload } from "@/lib/files";
import { assertAttachableMedia } from "@/lib/media/media-asset";
import { paged, pageParams } from "@/lib/community/serializers";
import {
  createReel,
  getReel,
  deleteReel,
  updateReel,
  listExploreReels,
  listReelsByUser,
  searchReelsByInterest,
  listReelsByHashtag,
  listReelsByMusic,
  listSavedReels,
  toggleReelLike,
  addReelView,
  reportReel,
  listReelComments,
  addReelComment,
  deleteReelComment,
} from "@/lib/community/reels";

export const router = Router();

const log = logger.child("reels");

/** :id path param — reject missing ids early. */
function reelId(req: Request): string {
  const id = String((req.params as Record<string, string>).id ?? "").trim();
  if (!id) throw new ApiError("Reel id is required", 400);
  return id;
}

/** Uploaded file for a multipart field (multer any() ran upstream), or null. */
function fieldFile(req: Request, fieldname: string): File | null {
  const files = (req.files as Array<{ fieldname: string; buffer: Buffer; originalname: string; mimetype: string }> | undefined) ?? [];
  const f = files.find((x) => x.fieldname === fieldname);
  if (!f) return null;
  return new File([f.buffer], f.originalname, { type: f.mimetype || "application/octet-stream" });
}

/** Store an upload and return its absolute public URL. */
async function saveFieldFile(req: Request, fieldname: string, uploaderId: string, uploaderName: string): Promise<string> {
  const file = fieldFile(req, fieldname);
  if (!file) throw new ApiError(`The ${fieldname} field is required`, 400);
  const asset = await saveUpload(file, { folder: "reels", uploadedBy: { id: uploaderId, name: uploaderName } });
  const host = req.get("host") ?? "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol ?? "http";
  return `${proto}://${host}/api/files/${asset.id}/file`;
}

/** CSV query param → trimmed non-empty list. */
function csvParam(raw: unknown): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// GET /api/reels?feed=foryou|following — explore (legacy fetchReelsOnExplore).
router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const feedParam = String(req.query.feed ?? "foryou").toLowerCase();
    if (feedParam !== "foryou" && feedParam !== "following") throw new ApiError("Invalid feed provided", 400);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await listExploreReels(session.userId, feedParam, page, limit, skip);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/reels — multipart video (content) + thumbnail + caption/hashtags/
// interests/musicId (legacy uploadReel). Direct-upload mode: application/json
// (or multipart text fields) with `mediaId` and NO content file — the video
// was uploaded through POST /api/media/uploads; the transcoder fills the
// playback URLs once the asset is ready. thumbnail file / thumbnailUrl stay
// optional in that mode.
router.post("/", multipart, multipartErrorHandler, async (req: Request, res: Response) => {
  try {
    const session = await requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const content = fieldFile(req, "content");
    const thumbnail = fieldFile(req, "thumbnail");
    const mediaId = typeof body.mediaId === "string" && body.mediaId.trim() ? body.mediaId.trim() : null;

    if (content && mediaId) throw new ApiError("Send either a content file or a mediaId, not both", 400);
    if (!content && !mediaId) throw new ApiError("The content field is required", 400);

    const musicIdRaw = body.musicId === undefined || body.musicId === null || body.musicId === "" ? null : Number(body.musicId);
    if (musicIdRaw !== null && !Number.isFinite(musicIdRaw)) throw new ApiError("Invalid musicId provided", 400);

    // interestIds arrives as a CSV string (mobile) or an array (web) — normalize to CSV.
    const interestIds = Array.isArray(body.interestIds)
      ? body.interestIds.map((v) => String(v).trim()).filter(Boolean).join(",")
      : typeof body.interestIds === "string"
        ? body.interestIds.trim() || null
        : null;

    let contentUrl: string | null = null;
    let thumbnailUrl: string | null = null;
    if (content) {
      // legacy multipart path — both files required
      if (!thumbnail) throw new ApiError("The thumbnail field is required", 400);
      contentUrl = await saveFieldFile(req, "content", session.userId, session.name);
      thumbnailUrl = await saveFieldFile(req, "thumbnail", session.userId, session.name);
    } else {
      // direct-upload mode — thumbnailUrl validated first (input format),
      // then the media asset (owner/purpose/status/attach)
      if (thumbnail) {
        thumbnailUrl = await saveFieldFile(req, "thumbnail", session.userId, session.name);
      } else if (body.thumbnailUrl !== undefined && body.thumbnailUrl !== null && body.thumbnailUrl !== "") {
        // validated like parseUrlList does for a single entry
        const u = String(body.thumbnailUrl).trim();
        if (u.length > 500 || !/^(\/(api\/files\/|public\/|uploads?\/)|https?:\/\/)/i.test(u)) {
          throw new ApiError("thumbnailUrl contains an unsupported url", 400);
        }
        thumbnailUrl = u;
      }
      await assertAttachableMedia(session.userId, mediaId, "reel");
    }

    log.debug("reel_upload_mode", {
      actor: session.userId,
      mode: content ? "multipart" : "direct",
      mediaId,
    });

    const reel = await createReel(session.userId, {
      description: typeof body.description === "string" ? body.description : null,
      hashtags: typeof body.hashtags === "string" ? body.hashtags : null,
      interestIds,
      musicId: musicIdRaw,
      causeId: typeof body.causeId === "string" && body.causeId ? body.causeId : null,
      contentUrl,
      thumbnailUrl,
      mediaId,
    });
    if (reel) {
      log.info("reel_created", {
        reelId: (reel as { id: string }).id,
        actor: session.userId,
        musicId: musicIdRaw,
        mode: content ? "multipart" : "direct",
      });
    }
    return json(res, reel, 201); // POST /api/posts parity
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/reels/saved — the session user's saved reels (legacy fetchSavedReels).
router.get("/saved", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await listSavedReels(session.userId, skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/reels/by-interest?ids=1,2&q= (legacy searchReelsByInterestId).
router.get("/by-interest", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await searchReelsByInterest(
      session.userId,
      csvParam(req.query.ids),
      String(req.query.q ?? ""),
      skip,
      limit
    );
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/reels/by-hashtag?tags=a,b (legacy fetchReelsByHashtag).
router.get("/by-hashtag", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const tags = csvParam(req.query.tags);
    if (!tags.length) throw new ApiError("The tags field is required", 400);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await listReelsByHashtag(session.userId, tags, skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/reels/by-music/:musicId (legacy fetchReelsByMusic).
router.get("/by-music/:musicId", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const musicId = Number((req.params as Record<string, string>).musicId);
    if (!Number.isFinite(musicId)) throw new ApiError("Music id is required", 400);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await listReelsByMusic(session.userId, musicId, skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/reels/user/:userId — a profile's reels (legacy fetchReelsByUserId).
router.get("/user/:userId", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const userId = String((req.params as Record<string, string>).userId ?? "").trim();
    if (!userId) throw new ApiError("User id is required", 400);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await listReelsByUser(session.userId, userId, skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/reels/comments/:commentId — comment author, reel owner OR moderator
// (legacy deleteReelComment + Moderator/deleteReelCommentByModerator). Mounted
// before the /:id routes so "comments" is not swallowed as an id.
router.delete("/comments/:commentId", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const commentId = String((req.params as Record<string, string>).commentId ?? "").trim();
    if (!commentId) throw new ApiError("Comment id is required", 400);
    await deleteReelComment(session.userId, session.role, commentId);
    log.info("reel_comment_deleted", { commentId, actor: session.userId });
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/reels/:id — single reel (legacy fetchReelById).
router.get("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const reel = await getReel(session.userId, reelId(req));
    return json(res, reel);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/reels/:id — owner OR moderator (legacy deleteReel +
// Moderator/deleteReelByModerator).
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const reel = await deleteReel(session.userId, session.role, reelId(req));
    log.info("reel_deleted", { reelId: reel.id, actor: session.userId });
    return json(res, { ok: true, reel });
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/reels/:id — edit metadata (description/hashtags/interests/
// thumbnail/content/music). The owner may always edit; a moderator may edit
// anyone's (legacy reels/update from the admin portal).
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const numOrNull = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const reelIdStr = reelId(req);
    const patch = {
      description: b.description !== undefined ? String(b.description) : b.desc !== undefined ? String(b.desc) : undefined,
      hashtags: b.hashtags !== undefined ? String(b.hashtags) : undefined,
      interestIds:
        b.interestIds !== undefined ? String(b.interestIds) : b.interest_ids !== undefined ? String(b.interest_ids) : undefined,
      thumbnail: b.thumbnail !== undefined ? String(b.thumbnail) : undefined,
      content: b.content !== undefined ? String(b.content) : b.media !== undefined ? String(b.media) : undefined,
      musicId: numOrNull(b.musicId ?? b.music_id),
    };
    const reel = await updateReel(session.userId, session.role, reelIdStr, patch);
    log.info("reel_updated", {
      reelId: reelIdStr,
      actor: session.userId,
      fields: Object.entries(patch).filter(([, v]) => v !== undefined).map(([k]) => k),
    });
    return json(res, { ok: true, reel });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/reels/:id/like — toggle (legacy likeDislikeReel).
router.post("/:id/like", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const reel = await toggleReelLike(session.userId, reelId(req));
    log.info("reel_like_toggled", {
      reelId: reel.id,
      actor: session.userId,
      isLike: reel.isLike,
      likesCount: reel.likesCount,
    });
    return json(res, reel);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/reels/:id/view (legacy increaseReelViewCount).
router.post("/:id/view", async (req, res) => {
  try {
    await requireAuth(req);
    const result = await addReelView(reelId(req));
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/reels/:id/report { reason, desc } (legacy reportReel).
router.post("/:id/report", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const report = await reportReel(
      session.userId,
      reelId(req),
      String(body.reason ?? ""),
      String(body.desc ?? "")
    );
    log.info("reel_reported", { reelId: report.reelId, actor: session.userId, reason: report.reason });
    return json(res, { ok: true, report });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/reels/:id/comments (legacy fetchReelComments).
router.get("/:id/comments", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await listReelComments(session.userId, reelId(req), skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/reels/:id/comments { description } (legacy addReelComment).
router.post("/:id/comments", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const comment = await addReelComment(session.userId, reelId(req), String(body.description ?? ""));
    log.info("reel_comment_added", { reelId: comment.reelId, commentId: comment.id, actor: session.userId });
    return json(res, comment);
  } catch (e) {
    return handleError(e, res);
  }
});
