/**
 * Posts routes — /api/posts (shared by web + mobile).
 * Thin endpoint definitions; all logic lives in src/modules/posts
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/posts`) is preserved: tests and the app entry import
 * `router` from here.
 *
 * Generic REST port of the legacy mobile post endpoints
 * (src/routes/mobile/posts.ts + the post/comment Moderator handlers of
 * src/routes/mobile/auth-users.ts). The actor is ALWAYS the session user —
 * ids never come from the body.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { multipart } from "@/infrastructure/uploads/multipart";
import {
  byHashtagQuerySchema,
  byInterestQuerySchema,
  commentIdParamSchema,
  hashtagsQuerySchema,
  listFeedQuerySchema,
  postBodySchema,
  postIdParamSchema,
  savedPostsQuerySchema,
  searchPostsQuerySchema,
  userIdParamSchema,
} from "@/modules/posts/schemas/post.schema";
import { postController } from "@/modules/posts";

export const router = Router();

// GET /api/posts?type=latest|random&page=&limit= — the main feed.
// (Suggested rooms live at GET /api/rooms/suggested — S4.)
router.get("/", authenticate, validate({ query: listFeedQuerySchema }), postController.list);

// GET /api/posts/saved — the session user's saved posts (ids edited via
// PATCH /api/profile savedPostIds).
router.get("/saved", authenticate, validate({ query: savedPostsQuerySchema }), postController.saved);

// GET /api/posts/search?q= (legacy searchPost).
router.get("/search", authenticate, validate({ query: searchPostsQuerySchema }), postController.search);

// GET /api/posts/by-interest?ids=1,2&q= (legacy searchPostByInterestId).
router.get("/by-interest", authenticate, validate({ query: byInterestQuerySchema }), postController.byInterest);

// GET /api/posts/by-hashtag?tags=a,b (legacy fetchPostsByHashtag).
router.get("/by-hashtag", authenticate, validate({ query: byHashtagQuerySchema }), postController.byHashtag);

// GET /api/posts/hashtags?q= → [{tag, postCount}] (legacy searchHashtag).
router.get("/hashtags", authenticate, validate({ query: hashtagsQuerySchema }), postController.hashtags);

// GET /api/posts/user/:userId — a user's posts (legacy fetchPostByUser).
router.get(
  "/user/:userId",
  authenticate,
  validate({ query: listFeedQuerySchema, params: userIdParamSchema }),
  postController.byUser
);

// DELETE /api/posts/comments/:commentId — owner OR moderator
// (deleteComment + Moderator/deleteCommentByModerator).
router.delete(
  "/comments/:commentId",
  authenticate,
  validate({ params: commentIdParamSchema }),
  postController.deleteComment
);

// POST /api/posts/comments/:commentId/like — toggle (likeDislikeComment).
router.post(
  "/comments/:commentId/like",
  authenticate,
  validate({ params: commentIdParamSchema }),
  postController.toggleCommentLike
);

// POST /api/posts — multipart media + text fields (legacy addPost).
router.post("/", multipart, authenticate, validate({ body: postBodySchema }), postController.create);

// GET /api/posts/:id — single feed post (legacy fetchPostByPostId).
router.get("/:id", authenticate, validate({ params: postIdParamSchema }), postController.get);

// DELETE /api/posts/:id — owner OR moderator (deleteMyPost + deletePostByModerator).
router.delete("/:id", authenticate, validate({ params: postIdParamSchema }), postController.remove);

// PATCH /api/posts/:id — edit desc/tags/interests/restriction. The owner may
// always edit; a moderator may edit anyone's (legacy feed/update).
router.patch(
  "/:id",
  authenticate,
  validate({ params: postIdParamSchema, body: postBodySchema }),
  postController.update
);

// POST /api/posts/:id/report { reason, desc } (legacy reportPost).
router.post(
  "/:id/report",
  authenticate,
  validate({ params: postIdParamSchema, body: postBodySchema }),
  postController.report
);

// POST /api/posts/:id/like { reaction } (legacy likePost).
router.post(
  "/:id/like",
  authenticate,
  validate({ params: postIdParamSchema, body: postBodySchema }),
  postController.like
);

// DELETE /api/posts/:id/like (legacy dislikePost).
router.delete("/:id/like", authenticate, validate({ params: postIdParamSchema }), postController.unlike);

// GET /api/posts/:id/likes — users who liked the post (fetchUsersWhoLikedPost).
router.get(
  "/:id/likes",
  authenticate,
  validate({ query: listFeedQuerySchema, params: postIdParamSchema }),
  postController.likers
);

// GET /api/posts/:id/comments (legacy fetchComments).
router.get(
  "/:id/comments",
  authenticate,
  validate({ query: listFeedQuerySchema, params: postIdParamSchema }),
  postController.comments
);

// POST /api/posts/:id/comments { desc } (legacy addComment).
router.post(
  "/:id/comments",
  authenticate,
  validate({ params: postIdParamSchema, body: postBodySchema }),
  postController.addComment
);
