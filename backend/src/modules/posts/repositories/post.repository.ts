/**
 * Community post repository implementation — delegates every operation to the
 * shared domain module @/domains/community/posts, which owns ALL post/comment/
 * like Prisma access, notification side effects and realtime feed events. The
 * wire shapes are therefore produced by exactly the legacy code path
 * (byte-identical responses and events).
 */
import {
  addComment as addCommentFn,
  createPost as createPostFn,
  deleteComment as deleteCommentFn,
  deletePost as deletePostFn,
  getPost as getPostFn,
  likePost as likePostFn,
  listComments as listCommentsFn,
  listFeed as listFeedFn,
  listPostLikers as listPostLikersFn,
  listPostsByHashtag as listPostsByHashtagFn,
  listPostsByInterest as listPostsByInterestFn,
  listSavedPosts as listSavedPostsFn,
  listUserPosts as listUserPostsFn,
  reportPost as reportPostFn,
  searchHashtags as searchHashtagsFn,
  searchPosts as searchPostsFn,
  toggleCommentLike as toggleCommentLikeFn,
  unlikePost as unlikePostFn,
  updatePost as updatePostFn,
} from "@/domains/community/posts";
import type { CreatePostInput, UpdatePostInput } from "@/domains/community/posts";
import type { PostRepository, PostRequest } from "./post.repository.interface";

export class PrismaPostRepository implements PostRepository {
  listFeed(meId: string, opts: { type?: string; skip: number; take: number }) {
    return listFeedFn(meId, opts);
  }

  listSavedPosts(meId: string, skip: number, take: number) {
    return listSavedPostsFn(meId, skip, take);
  }

  searchPosts(meId: string, keyword: string, skip: number, take: number) {
    return searchPostsFn(meId, keyword, skip, take);
  }

  listPostsByInterest(meId: string, interestIds: string[], skip: number, take: number) {
    return listPostsByInterestFn(meId, interestIds, skip, take);
  }

  listPostsByHashtag(meId: string, tags: string[], skip: number, take: number) {
    return listPostsByHashtagFn(meId, tags, skip, take);
  }

  searchHashtags(meId: string, keyword: string) {
    return searchHashtagsFn(meId, keyword);
  }

  listUserPosts(meId: string, userId: string, skip: number, take: number) {
    return listUserPostsFn(meId, userId, skip, take);
  }

  getPost(meId: string, postId: string) {
    return getPostFn(meId, postId);
  }

  deletePost(meId: string, role: string | undefined, postId: string) {
    return deletePostFn(meId, role, postId);
  }

  updatePost(meId: string, role: string | undefined, postId: string, input: UpdatePostInput) {
    return updatePostFn(meId, role, postId, input);
  }

  createPost(req: PostRequest, me: { id: string; name: string }, input: CreatePostInput) {
    return createPostFn(req, me, input);
  }

  reportPost(meId: string, postId: string, reason: string, desc: string) {
    return reportPostFn(meId, postId, reason, desc);
  }

  likePost(meId: string, postId: string, reaction?: string | null) {
    return likePostFn(meId, postId, reaction);
  }

  unlikePost(meId: string, postId: string) {
    return unlikePostFn(meId, postId);
  }

  listPostLikers(meId: string, postId: string, skip: number, take: number) {
    return listPostLikersFn(meId, postId, skip, take);
  }

  listComments(meId: string, postId: string, skip: number, take: number) {
    return listCommentsFn(meId, postId, skip, take);
  }

  addComment(meId: string, postId: string, desc: string) {
    return addCommentFn(meId, postId, desc);
  }

  deleteComment(meId: string, role: string | undefined, commentId: string) {
    return deleteCommentFn(meId, role, commentId);
  }

  toggleCommentLike(meId: string, commentId: string) {
    return toggleCommentLikeFn(meId, commentId);
  }
}
