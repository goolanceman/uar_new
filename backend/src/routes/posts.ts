/**
 * Posts routes — /api/posts (shared by web + mobile).
 *
 * Generic REST port of the legacy mobile post endpoints
 * (src/routes/mobile/posts.ts + the post/comment Moderator handlers of
 * src/routes/mobile/auth-users.ts). The actor is ALWAYS the session user —
 * ids never come from the body.
 */
import { Router, type Request } from "express";
import { requireAuth, ApiError, json, handleError, body } from "@/lib/session";
import { paged, pageParams } from "@/lib/community/serializers";
import { multipart } from "@/lib/multipart";
import {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  getPost,
  likePost,
  listComments,
  listFeed,
  listPostLikers,
  listPostsByHashtag,
  listPostsByInterest,
  listUserPosts,
  reportPost,
  searchHashtags,
  searchPosts,
  toggleCommentLike,
  unlikePost,
} from "@/lib/community/posts";

export const router = Router();

/** :id path param — reject missing ids early. */
function idParam(req: Request, name = "id"): string {
  const id = String((req.params as Record<string, string>)[name] ?? "").trim();
  if (!id) throw new ApiError("Id is required", 400);
  return id;
}

/** Optional-session actor id — feeds/searches work signed-out? No: the app
 *  always sends the session (personalization: isLike, blocklists). */
async function actor(req: Request) {
  const session = await requireAuth(req);
  return session;
}

/** Number field from a JSON/multipart body. */
function numField(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// GET /api/posts?type=latest|random&page=&limit= — the main feed.
// (Suggested rooms live at GET /api/rooms/suggested — S4.)
router.get("/", async (req, res) => {
  try {
    const session = await actor(req);
    const { page, limit, skip } = pageParams(req.query);
    const type = String(req.query.type ?? "latest");
    const { items, total } = await listFeed(session.userId, { type, skip, take: limit });
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/posts/search?q= (legacy searchPost).
router.get("/search", async (req, res) => {
  try {
    const session = await actor(req);
    const { page, limit, skip } = pageParams(req.query);
    const { items, total } = await searchPosts(session.userId, String(req.query.q ?? ""), skip, limit);
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/posts/by-interest?ids=1,2&q= (legacy searchPostByInterestId).
router.get("/by-interest", async (req, res) => {
  try {
    const session = await actor(req);
    const { page, limit, skip } = pageParams(req.query);
    const ids = String(req.query.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const { items, total } = await listPostsByInterest(session.userId, ids, skip, limit);
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/posts/by-hashtag?tags=a,b (legacy fetchPostsByHashtag).
router.get("/by-hashtag", async (req, res) => {
  try {
    const session = await actor(req);
    const { page, limit, skip } = pageParams(req.query);
    const tags = String(req.query.tags ?? req.query.tag ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const { items, total } = await listPostsByHashtag(session.userId, tags, skip, limit);
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/posts/hashtags?q= → [{tag, postCount}] (legacy searchHashtag).
router.get("/hashtags", async (req, res) => {
  try {
    const session = await actor(req);
    const items = await searchHashtags(session.userId, String(req.query.q ?? ""));
    return json(res, { items });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/posts/user/:userId — a user's posts (legacy fetchPostByUser).
router.get("/user/:userId", async (req, res) => {
  try {
    const session = await actor(req);
    const { page, limit, skip } = pageParams(req.query);
    const { items, total } = await listUserPosts(
      session.userId,
      idParam(req, "userId"),
      skip,
      limit
    );
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/posts/comments/:commentId — owner OR moderator
// (deleteComment + Moderator/deleteCommentByModerator).
router.delete("/comments/:commentId", async (req, res) => {
  try {
    const session = await actor(req);
    const comment = await deleteComment(session.userId, session.role, idParam(req, "commentId"));
    return json(res, { ok: true, comment });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/posts/comments/:commentId/like — toggle (likeDislikeComment).
router.post("/comments/:commentId/like", async (req, res) => {
  try {
    const session = await actor(req);
    const result = await toggleCommentLike(session.userId, idParam(req, "commentId"));
    return json(res, result);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/posts — multipart media + text fields (legacy addPost).
router.post("/", multipart, async (req, res) => {
  try {
    const session = await actor(req);
    const b = { ...(req.body ?? {}) } as Record<string, unknown>;
    const post = await createPost(req, { id: session.userId, name: session.name }, {
      desc: b.desc != null && b.desc !== "" ? String(b.desc) : null,
      tags: b.tags != null && b.tags !== "" ? String(b.tags) : null,
      linkPreviewJson: b.linkPreviewJson != null && b.linkPreviewJson !== "" ? String(b.linkPreviewJson) : null,
      interestIds: b.interestIds != null && b.interestIds !== "" ? String(b.interestIds) : null,
      isEmergency: b.isEmergency === true || b.isEmergency === 1 || b.isEmergency === "1" || b.isEmergency === "true",
      contextLabel: b.contextLabel != null && b.contextLabel !== "" ? String(b.contextLabel) : null,
      impactLabel: b.impactLabel != null && b.impactLabel !== "" ? String(b.impactLabel) : null,
      communityLabel: b.communityLabel != null && b.communityLabel !== "" ? String(b.communityLabel) : null,
      contentType: numField(b.contentType),
      audioWaves: b.audioWaves != null && b.audioWaves !== "" ? String(b.audioWaves) : null,
    });
    return json(res, post, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/posts/:id — single feed post (legacy fetchPostByPostId).
router.get("/:id", async (req, res) => {
  try {
    const session = await actor(req);
    const post = await getPost(session.userId, idParam(req));
    return json(res, post);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/posts/:id — owner OR moderator (deleteMyPost + deletePostByModerator).
router.delete("/:id", async (req, res) => {
  try {
    const session = await actor(req);
    const post = await deletePost(session.userId, session.role, idParam(req));
    return json(res, { ok: true, post });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/posts/:id/report { reason, desc } (legacy reportPost).
router.post("/:id/report", async (req, res) => {
  try {
    const session = await actor(req);
    const b = body<{ reason?: string; desc?: string }>(req);
    const report = await reportPost(session.userId, idParam(req), String(b.reason ?? ""), String(b.desc ?? ""));
    return json(res, { ok: true, report });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/posts/:id/like { reaction } (legacy likePost).
router.post("/:id/like", async (req, res) => {
  try {
    const session = await actor(req);
    const b = body<{ reaction?: string }>(req);
    const { like, post, message } = await likePost(session.userId, idParam(req), b.reaction ?? null);
    return json(res, { ok: true, message, like, ...(post ? { post } : {}) });
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/posts/:id/like (legacy dislikePost).
router.delete("/:id/like", async (req, res) => {
  try {
    const session = await actor(req);
    const like = await unlikePost(session.userId, idParam(req));
    return json(res, { ok: true, like });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/posts/:id/likes — users who liked the post (fetchUsersWhoLikedPost).
router.get("/:id/likes", async (req, res) => {
  try {
    const session = await actor(req);
    const { page, limit, skip } = pageParams(req.query);
    const { items, total } = await listPostLikers(session.userId, idParam(req), skip, limit);
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/posts/:id/comments (legacy fetchComments).
router.get("/:id/comments", async (req, res) => {
  try {
    const session = await actor(req);
    const { page, limit, skip } = pageParams(req.query);
    const { items, total } = await listComments(session.userId, idParam(req), skip, limit);
    return json(res, paged(items, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/posts/:id/comments { desc } (legacy addComment).
router.post("/:id/comments", async (req, res) => {
  try {
    const session = await actor(req);
    const b = body<{ desc?: string }>(req);
    const comment = await addComment(session.userId, idParam(req), String(b.desc ?? ""));
    return json(res, comment, 201);
  } catch (e) {
    return handleError(e, res);
  }
});