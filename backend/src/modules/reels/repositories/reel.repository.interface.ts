/**
 * Reel repository contract — persistence for the reels module. The service
 * layer depends on this interface, never on lib/Prisma directly.
 *
 * No NEW Prisma access exists in this module: the shared community domain
 * layer (@/lib/community/reels) already owns every reel read/write, along
 * with media attachability (@/lib/media/media-asset). The repository adapts
 * those existing functions behind this contract — lib stays untouched.
 */
import type {
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
  CreateReelInput,
  UpdateReelInput,
} from "@/lib/community/reels";

type CreateReelResult = Awaited<ReturnType<typeof createReel>>;
type GetReelResult = Awaited<ReturnType<typeof getReel>>;
type DeleteReelResult = Awaited<ReturnType<typeof deleteReel>>;
type UpdateReelResult = Awaited<ReturnType<typeof updateReel>>;
type ExploreListResult = Awaited<ReturnType<typeof listExploreReels>>;
type ByUserListResult = Awaited<ReturnType<typeof listReelsByUser>>;
type ByInterestListResult = Awaited<ReturnType<typeof searchReelsByInterest>>;
type ByHashtagListResult = Awaited<ReturnType<typeof listReelsByHashtag>>;
type ByMusicListResult = Awaited<ReturnType<typeof listReelsByMusic>>;
type SavedListResult = Awaited<ReturnType<typeof listSavedReels>>;
type ToggleLikeResult = Awaited<ReturnType<typeof toggleReelLike>>;
type AddViewResult = Awaited<ReturnType<typeof addReelView>>;
type ReportResult = Awaited<ReturnType<typeof reportReel>>;
type CommentsListResult = Awaited<ReturnType<typeof listReelComments>>;
type AddCommentResult = Awaited<ReturnType<typeof addReelComment>>;
type DeleteCommentResult = Awaited<ReturnType<typeof deleteReelComment>>;

export type {
  CreateReelInput,
  UpdateReelInput,
  CreateReelResult,
  GetReelResult,
  DeleteReelResult,
  UpdateReelResult,
  ExploreListResult,
  ByUserListResult,
  ByInterestListResult,
  ByHashtagListResult,
  ByMusicListResult,
  SavedListResult,
  ToggleLikeResult,
  AddViewResult,
  ReportResult,
  CommentsListResult,
  AddCommentResult,
  DeleteCommentResult,
};

export interface ReelRepository {
  /** Validates the media asset (owner/purpose/status/not attached) or null. */
  assertAttachableMedia(
    ownerId: string,
    mediaId: string | null | undefined,
    purpose: "reel" | "post"
  ): Promise<unknown>;

  create(userId: string, input: CreateReelInput): Promise<CreateReelResult>;
  get(viewerId: string, reelId: string): Promise<GetReelResult>;
  delete(actorId: string, actorRole: string | undefined, reelId: string): Promise<DeleteReelResult>;
  update(
    actorId: string,
    actorRole: string | undefined,
    reelId: string,
    input: UpdateReelInput
  ): Promise<UpdateReelResult>;

  listExplore(viewerId: string, feed: "foryou" | "following", page: number, limit: number, skip: number): Promise<ExploreListResult>;
  listByUser(viewerId: string, targetUserId: string, skip: number, take: number): Promise<ByUserListResult>;
  searchByInterest(viewerId: string, interestIds: string[], q: string, skip: number, take: number): Promise<ByInterestListResult>;
  listByHashtag(viewerId: string, tags: string[], skip: number, take: number): Promise<ByHashtagListResult>;
  listByMusic(viewerId: string, musicId: number, skip: number, take: number): Promise<ByMusicListResult>;
  listSaved(viewerId: string, skip: number, take: number): Promise<SavedListResult>;
  toggleLike(userId: string, reelId: string): Promise<ToggleLikeResult>;
  addView(reelId: string): Promise<AddViewResult>;
  report(reporterId: string, reelId: string, reason: string, desc: string): Promise<ReportResult>;
  listComments(viewerId: string, reelId: string, skip: number, take: number): Promise<CommentsListResult>;
  addComment(userId: string, reelId: string, description: string): Promise<AddCommentResult>;
  deleteComment(actorId: string, actorRole: string | undefined, commentId: string): Promise<DeleteCommentResult>;
}
