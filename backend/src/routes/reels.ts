/**
 * Reels routes — /api/reels (shared by web + mobile).
 * Thin endpoint definitions; all logic lives in src/modules/reels
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/reels`) is preserved: tests and the app entry import
 * `router` from here.
 *
 * Generic REST port of the legacy mobile reel endpoints (ReelController via
 * src/routes/mobile/reels-rooms.ts + the Moderator reel deletions in
 * auth-users.ts). The actor is ALWAYS the session user — ids never come from
 * the body; moderation (delete reel / delete comment) additionally accepts
 * ADMIN/MODERATOR roles and the DB `user.isModerator` flag.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { multipart, multipartErrorHandler } from "@/lib/multipart";
import { reelController } from "@/modules/reels";

export const router = Router();

// GET /api/reels?feed=foryou|following — explore (legacy fetchReelsOnExplore).
router.get("/", authenticate, reelController.listFeed);

// POST /api/reels — multipart video (content) + thumbnail + caption/hashtags/
// interests/musicId (legacy uploadReel), or direct-upload mode with `mediaId`.
// multer parses BEFORE auth so a malformed multipart still 400s like legacy;
// requireAuth remains the first step of the (post-multer) flow.
router.post("/", multipart, multipartErrorHandler, authenticate, reelController.create);

// GET /api/reels/saved — the session user's saved reels (legacy fetchSavedReels).
router.get("/saved", authenticate, reelController.saved);

// GET /api/reels/by-interest?ids=1,2&q= (legacy searchReelsByInterestId).
router.get("/by-interest", authenticate, reelController.byInterest);

// GET /api/reels/by-hashtag?tags=a,b (legacy fetchReelsByHashtag).
router.get("/by-hashtag", authenticate, reelController.byHashtag);

// GET /api/reels/by-music/:musicId (legacy fetchReelsByMusic).
router.get("/by-music/:musicId", authenticate, reelController.byMusic);

// GET /api/reels/user/:userId — a profile's reels (legacy fetchReelsByUserId).
router.get("/user/:userId", authenticate, reelController.byUser);

// DELETE /api/reels/comments/:commentId — comment author, reel owner OR moderator
// (legacy deleteReelComment + Moderator/deleteReelCommentByModerator). Mounted
// before the /:id routes so "comments" is not swallowed as an id.
router.delete("/comments/:commentId", authenticate, reelController.deleteComment);

// GET /api/reels/:id — single reel (legacy fetchReelById).
router.get("/:id", authenticate, reelController.get);

// DELETE /api/reels/:id — owner OR moderator (legacy deleteReel +
// Moderator/deleteReelByModerator).
router.delete("/:id", authenticate, reelController.remove);

// PATCH /api/reels/:id — edit metadata (description/hashtags/interests/
// thumbnail/content/music). The owner may always edit; a moderator may edit
// anyone's (legacy reels/update from the admin portal).
router.patch("/:id", authenticate, reelController.update);

// POST /api/reels/:id/like — toggle (legacy likeDislikeReel).
router.post("/:id/like", authenticate, reelController.like);

// POST /api/reels/:id/view (legacy increaseReelViewCount).
router.post("/:id/view", authenticate, reelController.view);

// POST /api/reels/:id/report { reason, desc } (legacy reportReel).
router.post("/:id/report", authenticate, reelController.report);

// GET /api/reels/:id/comments (legacy fetchReelComments).
router.get("/:id/comments", authenticate, reelController.comments);

// POST /api/reels/:id/comments { description } (legacy addReelComment).
router.post("/:id/comments", authenticate, reelController.addComment);
