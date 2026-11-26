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
import { multipart, multipartErrorHandler } from "@/lib/multipart";
import { saveUpload } from "@/lib/files";
import { paged, pageParams } from "@/lib/community/serializers";
import {
  createReel,
  getReel,
  deleteReel,
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
// interests/musicId (legacy uploadReel).
router.post("/", multipart, multipartErrorHandler, async (req: Request, res: Response) => {
  try {
    const session = await requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const content = fieldFile(req, "content");
    if (!content) throw new ApiError("The content field is required", 400);
    const thumbnail = fieldFile(req, "thumbnail");
    if (!thumbnail) throw new ApiError("The thumbnail field is required", 400);

    const musicIdRaw = body.musicId === undefined || body.musicId === null || body.musicId === "" ? null : Number(body.musicId);
    if (musicIdRaw !== null && !Number.isFinite(musicIdRaw)) throw new ApiError("Invalid musicId provided", 400);

    // interestIds arrives as a CSV string (mobile) or an array (web) — normalize to CSV.
    const interestIds = Array.isArray(body.interestIds)
      ? body.interestIds.map((v) => String(v).trim()).filter(Boolean).join(",")
      : typeof body.interestIds === "string"
        ? body.interestIds.trim() || null
        : null;

    const contentUrl = await saveFieldFile(req, "content", session.userId, session.name);
    const thumbnailUrl = await saveFieldFile(req, "thumbnail", session.userId, session.name);

    const reel = await createReel(session.userId, {
      description: typeof body.description === "string" ? body.description : null,
      hashtags: typeof body.hashtags === "string" ? body.hashtags : null,
      interestIds,
      musicId: musicIdRaw,
      causeId: typeof body.causeId === "string" && body.causeId ? body.causeId : null,
      contentUrl,
      thumbnailUrl,
    });
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
    return json(res, comment);
  } catch (e) {
    return handleError(e, res);
  }
});
