/**
 * Community users service — profile fetch/search/random, follow graph,
 * blocks, reports and the moderator-block flow. The actor is ALWAYS the
 * session user — ids never come from the body.
 *
 * Most flows delegate to the shared @/lib/community/users domain helpers;
 * this service owns the legacy targetId() gate ("User id is required", bare
 * 400) and the exact log events. Logged targetIds are the RAW :id param
 * values, exactly as the legacy routes logged them.
 */
import { logger } from "@/lib/logger";
import { ApiError, NotFoundError } from "@/shared/errors";
import type { Session } from "@/lib/session";
import { paged, communityUser } from "@/lib/community/serializers";
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
import type { CommunityUserRepository } from "../repositories/community-user.repository.interface";

const log = logger.child("community-users");

export class CommunityUserService {
  constructor(private readonly communityUserRepository: CommunityUserRepository) {}

  /** Target :id path param — reject missing ids early (legacy targetId()). */
  private targetId(rawId: string): string {
    const id = String(rawId ?? "").trim();
    if (!id) throw new ApiError("User id is required", 400);
    return id;
  }

  /** GET /me/blocked — users I blocked (legacy fetchBlockedUserList). */
  async listBlocked(actor: Session, page: number, limit: number, skip: number) {
    const { rows, total } = await listBlocked(actor.userId, skip, limit);
    return paged(rows, page, limit, total);
  }

  /** GET /search?q= — visible-profile search (legacy searchProfile). */
  async search(actor: Session, q: string, page: number, limit: number, skip: number) {
    const { rows, total } = await searchUsers(actor.userId, q, skip, limit);
    return paged(rows, page, limit, total);
  }

  /** GET /search-chat?q= — contacts picker (legacy searchUsersForChat). */
  async searchChat(actor: Session, q: string, page: number, limit: number, skip: number) {
    const { rows, total } = await searchChatUsers(actor.userId, q, skip, limit);
    return paged(rows, page, limit, total);
  }

  /** GET /random — random profile sharing my interests; single resource → object or null. */
  async random(actor: Session) {
    return getRandomUser(actor.userId);
  }

  /** GET /:id — profile + follow status + block flags (legacy fetchProfile). */
  async getProfile(actor: Session, rawTargetId: string) {
    return getUserProfile(actor.userId, this.targetId(rawTargetId));
  }

  /** POST /:id/follow (legacy followUser). */
  async follow(actor: Session, rawTargetId: string) {
    const follow = await followUser(actor.userId, this.targetId(rawTargetId));
    log.info("community_user_followed", {
      targetId: rawTargetId,
      actor: actor.userId,
    });
    return { ok: true, following: true, follow };
  }

  /** DELETE /:id/follow (legacy unfollowUser). */
  async unfollow(actor: Session, rawTargetId: string) {
    const follow = await unfollowUser(actor.userId, this.targetId(rawTargetId));
    log.info("community_user_unfollowed", {
      targetId: rawTargetId,
      actor: actor.userId,
    });
    return { ok: true, following: false, follow };
  }

  /** GET /:id/followers?q= (legacy fetchFollowersList). */
  async listFollowers(rawTargetId: string, q: string, page: number, limit: number, skip: number) {
    const { rows, total } = await listFollowers(this.targetId(rawTargetId), q, skip, limit);
    return paged(rows, page, limit, total);
  }

  /** GET /:id/following (legacy fetchFollowingList). */
  async listFollowing(actor: Session, rawTargetId: string, page: number, limit: number, skip: number) {
    const { rows, total } = await listFollowing(this.targetId(rawTargetId), actor.userId, skip, limit);
    return paged(rows, page, limit, total);
  }

  /** POST /:id/block (legacy UserBlockedByUser). */
  async block(actor: Session, rawTargetId: string) {
    const blockedUserIds = await blockUser(actor.userId, this.targetId(rawTargetId));
    log.info("community_user_blocked", {
      targetId: rawTargetId,
      count: blockedUserIds.length,
      actor: actor.userId,
    });
    return { ok: true, blockedUserIds };
  }

  /** DELETE /:id/block (legacy UserUnblockedByUser). */
  async unblock(actor: Session, rawTargetId: string) {
    const blockedUserIds = await unblockUser(actor.userId, this.targetId(rawTargetId));
    log.info("community_user_unblocked", {
      targetId: rawTargetId,
      count: blockedUserIds.length,
      actor: actor.userId,
    });
    return { ok: true, blockedUserIds };
  }

  /** POST /:id/report { reason, desc } (legacy reportUser). */
  async report(actor: Session, rawTargetId: string, body: Record<string, unknown>) {
    const report = await reportUser(
      actor.userId,
      this.targetId(rawTargetId),
      String(body.reason ?? ""),
      String(body.desc ?? "")
    );
    log.info("community_user_reported", {
      targetId: rawTargetId,
      reason: String(body.reason ?? ""),
      actor: actor.userId,
    });
    return { ok: true, report };
  }

  /**
   * POST /:id/moderator-block — moderator only (legacy
   * Moderator/userBlockByModerator): sets isBlock on the target user, clears
   * the reports about them and re-syncs their comment counts. Gate order is
   * the legacy one: moderator check → id gate → self-block → target lookup.
   */
  async moderatorBlock(actor: Session, rawTargetId: string) {
    if (!(await isActorModerator(actor.userId, actor.role))) {
      log.warn("community_moderator_block_forbidden", { actor: actor.userId });
      throw new ApiError("User is not a Moderator", 403);
    }
    const toUserId = this.targetId(rawTargetId);
    if (toUserId === actor.userId) throw new ApiError("Lol, You can not block yourself", 400);

    const toUser = await this.communityUserRepository.findUserById(toUserId);
    if (!toUser) {
      log.warn("community_moderator_block_not_found", {
        targetId: toUserId,
        actor: actor.userId,
      });
      throw new NotFoundError("User not found");
    }

    const updated = await this.communityUserRepository.setUserBlocked(toUserId);
    await this.communityUserRepository.deleteReportsAbout(toUserId); // reports about the user
    await syncPostCommentCounts({ commenterId: toUserId });
    log.info("community_user_moderator_blocked", {
      targetId: toUserId,
      actor: actor.userId,
    });

    return { ok: true, user: communityUser(updated) };
  }
}
