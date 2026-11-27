/**
 * Community users routes — /api/community/users (shared by web + mobile).
 *
 * Generic REST port of the legacy mobile user endpoints (UserController.php
 * via src/routes/mobile/auth-users.ts): profile fetch, search, random,
 * follow/unfollow, followers/following, block/unblock, report. The actor is
 * ALWAYS the session user — ids never come from the body.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireAuth,
  ApiError,
  json,
  handleError,
} from "@/lib/session";
import { paged, pageParams, communityUser } from "@/lib/community/serializers";
import { syncPostCommentCounts } from "@/lib/community/counters";
import { isActorModerator } from "@/lib/community/posts";
import {
  getUserProfile,
  searchUsers,
  searchChatUsers,
  getRandomUser,
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
  blockUser,
  unblockUser,
  listBlocked,
  reportUser,
} from "@/lib/community/users";

export const router = Router();

const log = logger.child("community-users");

/** Target :id path param — reject missing ids early. */
function targetId(req: Request): string {
  const id = String((req.params as Record<string, string>).id ?? "").trim();
  if (!id) throw new ApiError("User id is required", 400);
  return id;
}

// GET /api/community/users/me/blocked — users I blocked (legacy fetchBlockedUserList).
// NOTE: mounted before /:id so "me" is not swallowed by the param route.
router.get("/me/blocked", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await listBlocked(session.userId, skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/community/users/search?q= — visible-profile search (legacy searchProfile).
router.get("/search", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await searchUsers(session.userId, String(req.query.q ?? ""), skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/community/users/search-chat?q= — contacts picker (legacy searchUsersForChat).
router.get("/search-chat", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await searchChatUsers(session.userId, String(req.query.q ?? ""), skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/community/users/random — random profile sharing my interests
// (legacy fetchRandomProfile). Single resource → the object (or null).
router.get("/random", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const user = await getRandomUser(session.userId);
    return json(res, user);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/community/users/:id — profile + follow status + block flags
// (legacy fetchProfile). Story ids only until the stories slice lands.
router.get("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const profile = await getUserProfile(session.userId, targetId(req));
    return json(res, profile);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/community/users/:id/follow (legacy followUser).
router.post("/:id/follow", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const follow = await followUser(session.userId, targetId(req));
    log.info("community_user_followed", {
      targetId: (req.params as Record<string, string>).id,
      actor: session.userId,
    });
    return json(res, { ok: true, following: true, follow });
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/community/users/:id/follow (legacy unfollowUser).
router.delete("/:id/follow", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const follow = await unfollowUser(session.userId, targetId(req));
    log.info("community_user_unfollowed", {
      targetId: (req.params as Record<string, string>).id,
      actor: session.userId,
    });
    return json(res, { ok: true, following: false, follow });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/community/users/:id/followers?q= (legacy fetchFollowersList).
router.get("/:id/followers", async (req, res) => {
  try {
    await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await listFollowers(targetId(req), String(req.query.q ?? ""), skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/community/users/:id/following (legacy fetchFollowingList).
router.get("/:id/following", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const { page, limit, skip } = pageParams(req.query);
    const { rows, total } = await listFollowing(targetId(req), session.userId, skip, limit);
    return json(res, paged(rows, page, limit, total));
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/community/users/:id/block (legacy UserBlockedByUser).
router.post("/:id/block", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const blockedUserIds = await blockUser(session.userId, targetId(req));
    log.info("community_user_blocked", {
      targetId: (req.params as Record<string, string>).id,
      count: blockedUserIds.length,
      actor: session.userId,
    });
    return json(res, { ok: true, blockedUserIds });
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/community/users/:id/block (legacy UserUnblockedByUser).
router.delete("/:id/block", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const blockedUserIds = await unblockUser(session.userId, targetId(req));
    log.info("community_user_unblocked", {
      targetId: (req.params as Record<string, string>).id,
      count: blockedUserIds.length,
      actor: session.userId,
    });
    return json(res, { ok: true, blockedUserIds });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/community/users/:id/report { reason, desc } (legacy reportUser).
router.post("/:id/report", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const report = await reportUser(
      session.userId,
      targetId(req),
      String(body.reason ?? ""),
      String(body.desc ?? "")
    );
    log.info("community_user_reported", {
      targetId: (req.params as Record<string, string>).id,
      reason: String(body.reason ?? ""),
      actor: session.userId,
    });
    return json(res, { ok: true, report });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/community/users/:id/moderator-block — moderator only
// (legacy Moderator/userBlockByModerator): sets isBlock on the target user,
// clears the reports about them and re-syncs their comment counts.
router.post("/:id/moderator-block", async (req, res) => {
  try {
    const session = await requireAuth(req);
    if (!(await isActorModerator(session.userId, session.role))) {
      log.warn("community_moderator_block_forbidden", { actor: session.userId });
      throw new ApiError("User is not a Moderator", 403);
    }
    const toUserId = targetId(req);
    if (toUserId === session.userId) throw new ApiError("Lol, You can not block yourself", 400);

    const toUser = await db.user.findUnique({ where: { id: toUserId } });
    if (!toUser) {
      log.warn("community_moderator_block_not_found", {
        targetId: toUserId,
        actor: session.userId,
      });
      throw new ApiError("User not found", 404);
    }

    const updated = await db.user.update({ where: { id: toUserId }, data: { isBlock: 1 } });
    await db.communityReport.deleteMany({ where: { userId: toUserId } }); // reports about the user
    await syncPostCommentCounts({ commenterId: toUserId });
    log.info("community_user_moderator_blocked", {
      targetId: toUserId,
      actor: session.userId,
    });

    return json(res, { ok: true, user: communityUser(updated) });
  } catch (e) {
    return handleError(e, res);
  }
});
