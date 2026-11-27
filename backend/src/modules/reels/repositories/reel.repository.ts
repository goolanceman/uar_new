/**
 * Reel repository implementation — adapts the existing shared community
 * domain layer (@/domains/community/reels + @/infrastructure/media/media-asset) behind the
 * module contract. The lib owns all persistence for reels and is NOT
 * modified; no new Prisma access is introduced by this module.
 */
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
} from "@/domains/community/reels";
import { assertAttachableMedia } from "@/infrastructure/media/media-asset";
import type { ReelRepository } from "./reel.repository.interface";

export class ReelLibRepository implements ReelRepository {
  assertAttachableMedia(
    ownerId: string,
    mediaId: string | null | undefined,
    purpose: "reel" | "post"
  ): Promise<unknown> {
    return assertAttachableMedia(ownerId, mediaId, purpose);
  }

  create(userId: string, input: Parameters<typeof createReel>[1]) {
    return createReel(userId, input);
  }

  get(viewerId: string, reelId: string) {
    return getReel(viewerId, reelId);
  }

  delete(actorId: string, actorRole: string | undefined, reelId: string) {
    return deleteReel(actorId, actorRole, reelId);
  }

  update(actorId: string, actorRole: string | undefined, reelId: string, input: Parameters<typeof updateReel>[3]) {
    return updateReel(actorId, actorRole, reelId, input);
  }

  listExplore(viewerId: string, feed: "foryou" | "following", page: number, limit: number, skip: number) {
    return listExploreReels(viewerId, feed, page, limit, skip);
  }

  listByUser(viewerId: string, targetUserId: string, skip: number, take: number) {
    return listReelsByUser(viewerId, targetUserId, skip, take);
  }

  searchByInterest(viewerId: string, interestIds: string[], q: string, skip: number, take: number) {
    return searchReelsByInterest(viewerId, interestIds, q, skip, take);
  }

  listByHashtag(viewerId: string, tags: string[], skip: number, take: number) {
    return listReelsByHashtag(viewerId, tags, skip, take);
  }

  listByMusic(viewerId: string, musicId: number, skip: number, take: number) {
    return listReelsByMusic(viewerId, musicId, skip, take);
  }

  listSaved(viewerId: string, skip: number, take: number) {
    return listSavedReels(viewerId, skip, take);
  }

  toggleLike(userId: string, reelId: string) {
    return toggleReelLike(userId, reelId);
  }

  addView(reelId: string) {
    return addReelView(reelId);
  }

  report(reporterId: string, reelId: string, reason: string, desc: string) {
    return reportReel(reporterId, reelId, reason, desc);
  }

  listComments(viewerId: string, reelId: string, skip: number, take: number) {
    return listReelComments(viewerId, reelId, skip, take);
  }

  addComment(userId: string, reelId: string, description: string) {
    return addReelComment(userId, reelId, description);
  }

  deleteComment(actorId: string, actorRole: string | undefined, commentId: string) {
    return deleteReelComment(actorId, actorRole, commentId);
  }
}
