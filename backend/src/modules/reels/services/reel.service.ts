/**
 * Reel service — orchestration for /api/reels: input checks with the exact
 * legacy wire messages, patch normalization, and the domain log events.
 * Persistence flows through the repository contract (the shared community
 * domain layer); never touches HTTP.
 *
 * The actor is ALWAYS the session user — ids never come from the body;
 * moderation (delete reel / delete comment / edit anyone's) additionally
 * accepts ADMIN/MODERATOR roles and the DB user.isModerator flag.
 */
import { logger } from "@/infrastructure/logging/logger";
import { ApiError, type Session } from "@/infrastructure/auth/session";
import { paged } from "@/domains/community/serializers";
import type {
  CreateReelInput,
  CreateReelResult,
  ReelRepository,
} from "../repositories/reel.repository.interface";

const log = logger.child("reels");

export interface CreateReelFlow {
  content: File | null;
  thumbnail: File | null;
  rawBody: Record<string, unknown>;
  /** Transport callback (controller-bound): stores an upload and returns its absolute public URL. */
  saveField: (fieldname: string) => Promise<string>;
}

export class ReelService {
  constructor(private readonly reelRepository: ReelRepository) {}

  /** :id path param — reject missing ids early (exact legacy message). */
  private reelId(raw: unknown): string {
    const id = String(raw ?? "").trim();
    if (!id) throw new ApiError("Reel id is required", 400);
    return id;
  }

  /** GET /api/reels?feed=foryou|following — explore (legacy fetchReelsOnExplore). */
  async listFeed(session: Session, feedParam: string, page: number, limit: number, skip: number) {
    if (feedParam !== "foryou" && feedParam !== "following") throw new ApiError("Invalid feed provided", 400);
    const { rows, total } = await this.reelRepository.listExplore(session.userId, feedParam, page, limit, skip);
    return paged(rows, page, limit, total);
  }

  /**
   * POST /api/reels — multipart video (content) + thumbnail + caption/hashtags/
   * interests/musicId (legacy uploadReel). Direct-upload mode: application/json
   * (or multipart text fields) with `mediaId` and NO content file — the video
   * was uploaded through POST /api/media/uploads; the transcoder fills the
   * playback URLs once the asset is ready. thumbnail file / thumbnailUrl stay
   * optional in that mode.
   */
  async create(session: Session, flow: CreateReelFlow): Promise<CreateReelResult> {
    const body = (flow.rawBody ?? {}) as Record<string, unknown>;
    const content = flow.content;
    const thumbnail = flow.thumbnail;
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
      contentUrl = await flow.saveField("content");
      thumbnailUrl = await flow.saveField("thumbnail");
    } else {
      // direct-upload mode — thumbnailUrl validated first (input format),
      // then the media asset (owner/purpose/status/attach)
      if (thumbnail) {
        thumbnailUrl = await flow.saveField("thumbnail");
      } else if (body.thumbnailUrl !== undefined && body.thumbnailUrl !== null && body.thumbnailUrl !== "") {
        // validated like parseUrlList does for a single entry
        const u = String(body.thumbnailUrl).trim();
        if (u.length > 500 || !/^(\/(api\/files\/|public\/|uploads?\/)|https?:\/\/)/i.test(u)) {
          throw new ApiError("thumbnailUrl contains an unsupported url", 400);
        }
        thumbnailUrl = u;
      }
      await this.reelRepository.assertAttachableMedia(session.userId, mediaId, "reel");
    }

    log.debug("reel_upload_mode", {
      actor: session.userId,
      mode: content ? "multipart" : "direct",
      mediaId,
    });

    const reel = await this.reelRepository.create(session.userId, {
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
    return reel;
  }

  /** GET /api/reels/saved — the session user's saved reels (legacy fetchSavedReels). */
  async listSaved(session: Session, page: number, limit: number, skip: number) {
    const { rows, total } = await this.reelRepository.listSaved(session.userId, skip, limit);
    return paged(rows, page, limit, total);
  }

  /** GET /api/reels/by-interest?ids=1,2&q= (legacy searchReelsByInterestId). */
  async searchByInterest(session: Session, ids: string[], q: string, page: number, limit: number, skip: number) {
    const { rows, total } = await this.reelRepository.searchByInterest(session.userId, ids, q, skip, limit);
    return paged(rows, page, limit, total);
  }

  /** GET /api/reels/by-hashtag?tags=a,b (legacy fetchReelsByHashtag). */
  async listByHashtag(session: Session, tags: string[], page: number, limit: number, skip: number) {
    if (!tags.length) throw new ApiError("The tags field is required", 400);
    const { rows, total } = await this.reelRepository.listByHashtag(session.userId, tags, skip, limit);
    return paged(rows, page, limit, total);
  }

  /** GET /api/reels/by-music/:musicId (legacy fetchReelsByMusic). */
  async listByMusic(session: Session, rawMusicId: unknown, page: number, limit: number, skip: number) {
    const musicId = Number(rawMusicId);
    if (!Number.isFinite(musicId)) throw new ApiError("Music id is required", 400);
    const { rows, total } = await this.reelRepository.listByMusic(session.userId, musicId, skip, limit);
    return paged(rows, page, limit, total);
  }

  /** GET /api/reels/user/:userId — a profile's reels (legacy fetchReelsByUserId). */
  async listByUser(session: Session, rawUserId: unknown, page: number, limit: number, skip: number) {
    const userId = String(rawUserId ?? "").trim();
    if (!userId) throw new ApiError("User id is required", 400);
    const { rows, total } = await this.reelRepository.listByUser(session.userId, userId, skip, limit);
    return paged(rows, page, limit, total);
  }

  /**
   * DELETE /api/reels/comments/:commentId — comment author, reel owner OR
   * moderator (legacy deleteReelComment + Moderator/deleteReelCommentByModerator).
   */
  async deleteComment(session: Session, rawCommentId: unknown) {
    const commentId = String(rawCommentId ?? "").trim();
    if (!commentId) throw new ApiError("Comment id is required", 400);
    await this.reelRepository.deleteComment(session.userId, session.role, commentId);
    log.info("reel_comment_deleted", { commentId, actor: session.userId });
    return { ok: true };
  }

  /** GET /api/reels/:id — single reel (legacy fetchReelById). */
  async get(session: Session, rawId: unknown) {
    const reel = await this.reelRepository.get(session.userId, this.reelId(rawId));
    return reel;
  }

  /** DELETE /api/reels/:id — owner OR moderator (legacy deleteReel). */
  async remove(session: Session, rawId: unknown) {
    const reel = await this.reelRepository.delete(session.userId, session.role, this.reelId(rawId));
    log.info("reel_deleted", { reelId: reel.id, actor: session.userId });
    return { ok: true, reel };
  }

  /** PATCH /api/reels/:id — edit metadata. The owner may always edit; a
   *  moderator may edit anyone's (legacy reels/update from the admin portal). */
  async update(session: Session, rawId: unknown, rawBody: Record<string, unknown>) {
    const b = (rawBody ?? {}) as Record<string, unknown>;
    const numOrNull = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const reelIdStr = this.reelId(rawId);
    const patch = {
      description: b.description !== undefined ? String(b.description) : b.desc !== undefined ? String(b.desc) : undefined,
      hashtags: b.hashtags !== undefined ? String(b.hashtags) : undefined,
      interestIds:
        b.interestIds !== undefined ? String(b.interestIds) : b.interest_ids !== undefined ? String(b.interest_ids) : undefined,
      thumbnail: b.thumbnail !== undefined ? String(b.thumbnail) : undefined,
      content: b.content !== undefined ? String(b.content) : b.media !== undefined ? String(b.media) : undefined,
      musicId: numOrNull(b.musicId ?? b.music_id),
    };
    const reel = await this.reelRepository.update(session.userId, session.role, reelIdStr, patch);
    log.info("reel_updated", {
      reelId: reelIdStr,
      actor: session.userId,
      fields: Object.entries(patch).filter(([, v]) => v !== undefined).map(([k]) => k),
    });
    return { ok: true, reel };
  }

  /** POST /api/reels/:id/like — toggle (legacy likeDislikeReel). */
  async like(session: Session, rawId: unknown) {
    const reel = await this.reelRepository.toggleLike(session.userId, this.reelId(rawId));
    log.info("reel_like_toggled", {
      reelId: reel.id,
      actor: session.userId,
      isLike: reel.isLike,
      likesCount: reel.likesCount,
    });
    return reel;
  }

  /** POST /api/reels/:id/view (legacy increaseReelViewCount). */
  async view(rawId: unknown) {
    const result = await this.reelRepository.addView(this.reelId(rawId));
    return result;
  }

  /** POST /api/reels/:id/report { reason, desc } (legacy reportReel). */
  async report(session: Session, rawId: unknown, rawBody: Record<string, unknown>) {
    const body = (rawBody ?? {}) as Record<string, unknown>;
    const report = await this.reelRepository.report(
      session.userId,
      this.reelId(rawId),
      String(body.reason ?? ""),
      String(body.desc ?? "")
    );
    log.info("reel_reported", { reelId: report.reelId, actor: session.userId, reason: report.reason });
    return { ok: true, report };
  }

  /** GET /api/reels/:id/comments (legacy fetchReelComments). */
  async listComments(session: Session, rawId: unknown, page: number, limit: number, skip: number) {
    const { rows, total } = await this.reelRepository.listComments(session.userId, this.reelId(rawId), skip, limit);
    return paged(rows, page, limit, total);
  }

  /** POST /api/reels/:id/comments { description } (legacy addReelComment). */
  async addComment(session: Session, rawId: unknown, rawBody: Record<string, unknown>) {
    const body = (rawBody ?? {}) as Record<string, unknown>;
    const comment = await this.reelRepository.addComment(session.userId, this.reelId(rawId), String(body.description ?? ""));
    log.info("reel_comment_added", { reelId: comment.reelId, commentId: comment.id, actor: session.userId });
    return comment;
  }
}
