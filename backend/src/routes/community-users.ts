/**
 * Community users routes — /api/community/users (shared by web + mobile).
 * Thin endpoint definitions; all logic lives in src/modules/community-users
 * (routes → controllers → services → repositories).
 * The historical export path (`@/routes/community-users`) is preserved.
 *
 * The actor is ALWAYS the session user — ids never come from the body.
 */
import { Router } from "express";
import { authenticate } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  communityUserIdParamSchema,
  listCommunityUsersQuerySchema,
  searchCommunityUsersQuerySchema,
} from "@/modules/community-users/schemas/community-user.schema";
import { communityUserController } from "@/modules/community-users";

export const router = Router();

// GET /api/community/users/me/blocked — users I blocked (legacy fetchBlockedUserList).
// NOTE: mounted before /:id so "me" is not swallowed by the param route.
router.get(
  "/me/blocked",
  authenticate,
  validate({ query: listCommunityUsersQuerySchema }),
  communityUserController.listBlocked
);

// GET /api/community/users/search?q= — visible-profile search (legacy searchProfile).
router.get(
  "/search",
  authenticate,
  validate({ query: searchCommunityUsersQuerySchema }),
  communityUserController.search
);

// GET /api/community/users/search-chat?q= — contacts picker (legacy searchUsersForChat).
router.get(
  "/search-chat",
  authenticate,
  validate({ query: searchCommunityUsersQuerySchema }),
  communityUserController.searchChat
);

// GET /api/community/users/random — random profile sharing my interests
// (legacy fetchRandomProfile). Single resource → the object (or null).
router.get("/random", authenticate, communityUserController.random);

// GET /api/community/users/:id — profile + follow status + block flags
// (legacy fetchProfile). Story ids only until the stories slice lands.
router.get(
  "/:id",
  authenticate,
  validate({ params: communityUserIdParamSchema }),
  communityUserController.getProfile
);

// POST /api/community/users/:id/follow (legacy followUser).
router.post(
  "/:id/follow",
  authenticate,
  validate({ params: communityUserIdParamSchema }),
  communityUserController.follow
);

// DELETE /api/community/users/:id/follow (legacy unfollowUser).
router.delete(
  "/:id/follow",
  authenticate,
  validate({ params: communityUserIdParamSchema }),
  communityUserController.unfollow
);

// GET /api/community/users/:id/followers?q= (legacy fetchFollowersList).
router.get(
  "/:id/followers",
  authenticate,
  validate({ params: communityUserIdParamSchema, query: searchCommunityUsersQuerySchema }),
  communityUserController.listFollowers
);

// GET /api/community/users/:id/following (legacy fetchFollowingList).
router.get(
  "/:id/following",
  authenticate,
  validate({ params: communityUserIdParamSchema, query: listCommunityUsersQuerySchema }),
  communityUserController.listFollowing
);

// POST /api/community/users/:id/block (legacy UserBlockedByUser).
router.post(
  "/:id/block",
  authenticate,
  validate({ params: communityUserIdParamSchema }),
  communityUserController.block
);

// DELETE /api/community/users/:id/block (legacy UserUnblockedByUser).
router.delete(
  "/:id/block",
  authenticate,
  validate({ params: communityUserIdParamSchema }),
  communityUserController.unblock
);

// POST /api/community/users/:id/report { reason, desc } (legacy reportUser).
router.post(
  "/:id/report",
  authenticate,
  validate({ params: communityUserIdParamSchema }),
  communityUserController.report
);

// POST /api/community/users/:id/moderator-block — moderator only
// (legacy Moderator/userBlockByModerator): sets isBlock on the target user,
// clears the reports about them and re-syncs their comment counts.
router.post(
  "/:id/moderator-block",
  authenticate,
  validate({ params: communityUserIdParamSchema }),
  communityUserController.moderatorBlock
);
