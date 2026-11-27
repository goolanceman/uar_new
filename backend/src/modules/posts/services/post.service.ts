/**
 * Post service — orchestration over the shared community post domain module.
 * Depends on the repository contract, throws application errors, never
 * touches HTTP. The actor is ALWAYS the session user — ids never come from
 * the body. Every log event keeps its legacy name; body coercions reproduce
 * the legacy String()/numField()/mediaIdsField() expressions verbatim.
 */
import { logger } from "@/lib/logger";
import { paged } from "@/lib/community/serializers";
import { ApiError, type Session } from "@/lib/session";
import type { CreatePostInput, UpdatePostInput } from "@/lib/community/posts";
import type {
  PostRepository,
  PostRequest,
} from "../repositories/post.repository.interface";
import type {
  ByHashtagQuery,
  ByInterestQuery,
  HashtagsQuery,
  ListFeedQuery,
  PostBody,
  SavedPostsQuery,
  SearchPostsQuery,
} from "../schemas/post.schema";

const log = logger.child("posts");

/** Legacy :id path param handling — reject missing ids early, exact message. */
function requireId(raw: string, name = "id"): string {
  const id = String(raw ?? "").trim();
  if (!id) throw new ApiError("Id is required", 400);
  return id;
}

/** Number field from a JSON/multipart body. */
function numField(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** mediaIds arrives as a JSON array string (multipart text field), a CSV, or a
 *  real array (express.json) — normalize to trimmed non-empty strings. */
function mediaIdsField(v: unknown): string[] {
  if (v === undefined || v === null || v === "") return [];
  let raw: unknown[];
  if (Array.isArray(v)) {
    raw = v;
  } else {
    const s = String(v).trim();
    try {
      const parsed: unknown = JSON.parse(s);
      raw = Array.isArray(parsed) ? (parsed as unknown[]) : [parsed];
    } catch {
      raw = s.split(",");
    }
  }
  return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
}

/** Legacy isEmergency truthiness: true | 1 | "1" | "true". */
function emergencyFlag(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

export class PostService {
  constructor(private readonly postRepository: PostRepository) {}

  /** GET /api/posts?type=latest|random&page=&limit= — the main feed.
   *  (Suggested rooms live at GET /api/rooms/suggested — S4.) */
  async listFeed(session: Session, query: ListFeedQuery) {
    const skip = (query.page - 1) * query.limit;
    const { items, total } = await this.postRepository.listFeed(session.userId, {
      type: query.type,
      skip,
      take: query.limit,
    });
    return paged(items, query.page, query.limit, total);
  }

  /** GET /api/posts/saved — the session user's saved posts (ids edited via
   *  PATCH /api/profile savedPostIds). */
  async listSaved(session: Session, query: SavedPostsQuery) {
    const skip = (query.page - 1) * query.limit;
    const { items, total } = await this.postRepository.listSavedPosts(session.userId, skip, query.limit);
    return paged(items, query.page, query.limit, total);
  }

  /** GET /api/posts/search?q= (legacy searchPost). */
  async search(session: Session, query: SearchPostsQuery) {
    const skip = (query.page - 1) * query.limit;
    const { items, total } = await this.postRepository.searchPosts(session.userId, query.q, skip, query.limit);
    return paged(items, query.page, query.limit, total);
  }

  /** GET /api/posts/by-interest?ids=1,2&q= (legacy searchPostByInterestId). */
  async listByInterest(session: Session, query: ByInterestQuery) {
    const skip = (query.page - 1) * query.limit;
    const { items, total } = await this.postRepository.listPostsByInterest(
      session.userId,
      query.ids,
      skip,
      query.limit
    );
    return paged(items, query.page, query.limit, total);
  }

  /** GET /api/posts/by-hashtag?tags=a,b (legacy fetchPostsByHashtag). */
  async listByHashtag(session: Session, query: ByHashtagQuery) {
    const skip = (query.page - 1) * query.limit;
    const tags = String(query.tags ?? query.tag ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const { items, total } = await this.postRepository.listPostsByHashtag(session.userId, tags, skip, query.limit);
    return paged(items, query.page, query.limit, total);
  }

  /** GET /api/posts/hashtags?q= → [{tag, postCount}] (legacy searchHashtag). */
  async searchHashtags(session: Session, query: HashtagsQuery) {
    const items = await this.postRepository.searchHashtags(session.userId, query.q);
    return { items };
  }

  /** GET /api/posts/user/:userId — a user's posts (legacy fetchPostByUser). */
  async listByUser(session: Session, rawUserId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.postRepository.listUserPosts(session.userId, requireId(rawUserId, "userId"), skip, limit);
    return paged(items, page, limit, total);
  }

  /** POST /api/posts — multipart media + text fields (legacy addPost). */
  async create(req: PostRequest, session: Session, body: PostBody) {
    const b = { ...(body ?? {}) } as Record<string, unknown>;
    const post = await this.postRepository.createPost(req, { id: session.userId, name: session.name }, {
      desc: b.desc != null && b.desc !== "" ? String(b.desc) : null,
      tags: b.tags != null && b.tags !== "" ? String(b.tags) : null,
      linkPreviewJson: b.linkPreviewJson != null && b.linkPreviewJson !== "" ? String(b.linkPreviewJson) : null,
      interestIds: b.interestIds != null && b.interestIds !== "" ? String(b.interestIds) : null,
      isEmergency: emergencyFlag(b.isEmergency),
      contextLabel: b.contextLabel != null && b.contextLabel !== "" ? String(b.contextLabel) : null,
      impactLabel: b.impactLabel != null && b.impactLabel !== "" ? String(b.impactLabel) : null,
      communityLabel: b.communityLabel != null && b.communityLabel !== "" ? String(b.communityLabel) : null,
      contentType: numField(b.contentType),
      audioWaves: b.audioWaves != null && b.audioWaves !== "" ? String(b.audioWaves) : null,
      mediaIds: mediaIdsField(b.mediaIds),
    } satisfies CreatePostInput);
    if (post) {
      log.info("post_created", {
        postId: post.id,
        actor: session.userId,
        contentType: numField(b.contentType) ?? null,
        isEmergency: emergencyFlag(b.isEmergency),
      });
    }
    return post;
  }

  /** GET /api/posts/:id — single feed post (legacy fetchPostByPostId). */
  async get(session: Session, rawId: string) {
    return this.postRepository.getPost(session.userId, requireId(rawId));
  }

  /** DELETE /api/posts/:id — owner OR moderator (deleteMyPost + deletePostByModerator). */
  async remove(session: Session, rawId: string) {
    const post = await this.postRepository.deletePost(session.userId, session.role, requireId(rawId));
    log.info("post_deleted", { postId: post.id, actor: session.userId });
    return { ok: true, post };
  }

  /** PATCH /api/posts/:id — edit desc/tags/interests/restriction. The owner may
   *  always edit; a moderator may edit anyone's (legacy feed/update). */
  async update(session: Session, rawId: string, body: PostBody) {
    const b = (body ?? {}) as Record<string, unknown>;
    const postId = requireId(rawId);
    const post = await this.postRepository.updatePost(session.userId, session.role, postId, {
      desc: b.desc !== undefined ? String(b.desc) : b.description !== undefined ? String(b.description) : undefined,
      tags: b.tags !== undefined ? String(b.tags) : undefined,
      interestIds:
        b.interestIds !== undefined ? String(b.interestIds) : b.interest_ids !== undefined ? String(b.interest_ids) : undefined,
      isRestricted: b.isRestricted !== undefined ? (Number(b.isRestricted) ? 1 : 0) : undefined,
    } satisfies UpdatePostInput);
    log.info("post_updated", {
      postId,
      actor: session.userId,
      ...(b.isRestricted !== undefined ? { isRestricted: Number(b.isRestricted) ? 1 : 0 } : {}),
    });
    return { ok: true, post };
  }

  /** POST /api/posts/:id/report { reason, desc } (legacy reportPost). */
  async report(session: Session, rawId: string, body: PostBody) {
    const b = body ?? {};
    const postId = requireId(rawId);
    const report = await this.postRepository.reportPost(session.userId, postId, String(b.reason ?? ""), String(b.desc ?? ""));
    log.info("post_reported", { postId, actor: session.userId, reason: String(b.reason ?? "") });
    return { ok: true, report };
  }

  /** POST /api/posts/:id/like { reaction } (legacy likePost). */
  async like(session: Session, rawId: string, body: PostBody) {
    const b = (body ?? {}) as { reaction?: string }; // legacy body<{reaction?: string}>(req) cast
    const postId = requireId(rawId);
    const { like, post, message } = await this.postRepository.likePost(session.userId, postId, b.reaction ?? null);
    log.info("post_liked", { postId, actor: session.userId, reaction: b.reaction ?? null, message });
    return { ok: true, message, like, ...(post ? { post } : {}) };
  }

  /** DELETE /api/posts/:id/like (legacy dislikePost). */
  async unlike(session: Session, rawId: string) {
    const postId = requireId(rawId);
    const like = await this.postRepository.unlikePost(session.userId, postId);
    log.info("post_unliked", { postId, actor: session.userId });
    return { ok: true, like };
  }

  /** GET /api/posts/:id/likes — users who liked the post (fetchUsersWhoLikedPost). */
  async listLikers(session: Session, rawId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.postRepository.listPostLikers(session.userId, requireId(rawId), skip, limit);
    return paged(items, page, limit, total);
  }

  /** GET /api/posts/:id/comments (legacy fetchComments). */
  async listComments(session: Session, rawId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.postRepository.listComments(session.userId, requireId(rawId), skip, limit);
    return paged(items, page, limit, total);
  }

  /** POST /api/posts/:id/comments { desc } (legacy addComment). */
  async addComment(session: Session, rawId: string, body: PostBody) {
    const b = body ?? {};
    const postId = requireId(rawId);
    const comment = await this.postRepository.addComment(session.userId, postId, String(b.desc ?? ""));
    log.info("comment_added", { postId, commentId: comment.id, actor: session.userId });
    return comment;
  }

  /** DELETE /api/posts/comments/:commentId — owner OR moderator
   *  (deleteComment + Moderator/deleteCommentByModerator). */
  async deleteComment(session: Session, rawCommentId: string) {
    const comment = await this.postRepository.deleteComment(session.userId, session.role, requireId(rawCommentId, "commentId"));
    log.info("comment_deleted", { commentId: comment.id, actor: session.userId });
    return { ok: true, comment };
  }

  /** POST /api/posts/comments/:commentId/like — toggle (likeDislikeComment). */
  async toggleCommentLike(session: Session, rawCommentId: string) {
    const commentId = requireId(rawCommentId, "commentId");
    const result = await this.postRepository.toggleCommentLike(session.userId, commentId);
    log.info("comment_like_toggled", { commentId, actor: session.userId, liked: result.liked });
    return result;
  }
}
