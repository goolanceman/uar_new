/**
 * Post repository contract — persistence gateway for the community feed.
 * ALL Prisma access, cache handling and realtime event publishing for posts
 * lives in the shared domain module @/lib/community/posts (read-only shared
 * code, delegated to by the implementation); this contract exposes exactly
 * the operations the post endpoints use so the service stays decoupled.
 */
import type {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  getPost,
  likePost,
  listComments,
  listFeed,
  listPostLikers,
  listPostsByHashtag,
  listPostsByInterest,
  listSavedPosts,
  listUserPosts,
  reportPost,
  searchHashtags,
  searchPosts,
  toggleCommentLike,
  unlikePost,
  updatePost,
  CreatePostInput,
  UpdatePostInput,
} from "@/lib/community/posts";

/** The raw express Request — createPost reads multipart file parts from it
 *  (collectFiles), exactly the legacy call path. */
export type PostRequest = Parameters<typeof createPost>[0];

export interface PostRepository {
  listFeed(meId: string, opts: { type?: string; skip: number; take: number }): Promise<Awaited<ReturnType<typeof listFeed>>>;
  listSavedPosts(meId: string, skip: number, take: number): Promise<Awaited<ReturnType<typeof listSavedPosts>>>;
  searchPosts(meId: string, keyword: string, skip: number, take: number): Promise<Awaited<ReturnType<typeof searchPosts>>>;
  listPostsByInterest(meId: string, interestIds: string[], skip: number, take: number): Promise<Awaited<ReturnType<typeof listPostsByInterest>>>;
  listPostsByHashtag(meId: string, tags: string[], skip: number, take: number): Promise<Awaited<ReturnType<typeof listPostsByHashtag>>>;
  searchHashtags(meId: string, keyword: string): Promise<Awaited<ReturnType<typeof searchHashtags>>>;
  listUserPosts(meId: string, userId: string, skip: number, take: number): Promise<Awaited<ReturnType<typeof listUserPosts>>>;
  getPost(meId: string, postId: string): Promise<Awaited<ReturnType<typeof getPost>>>;
  deletePost(meId: string, role: string | undefined, postId: string): Promise<Awaited<ReturnType<typeof deletePost>>>;
  updatePost(meId: string, role: string | undefined, postId: string, input: UpdatePostInput): Promise<Awaited<ReturnType<typeof updatePost>>>;
  createPost(req: PostRequest, me: { id: string; name: string }, input: CreatePostInput): Promise<Awaited<ReturnType<typeof createPost>>>;
  reportPost(meId: string, postId: string, reason: string, desc: string): Promise<Awaited<ReturnType<typeof reportPost>>>;
  likePost(meId: string, postId: string, reaction?: string | null): Promise<Awaited<ReturnType<typeof likePost>>>;
  unlikePost(meId: string, postId: string): Promise<Awaited<ReturnType<typeof unlikePost>>>;
  listPostLikers(meId: string, postId: string, skip: number, take: number): Promise<Awaited<ReturnType<typeof listPostLikers>>>;
  listComments(meId: string, postId: string, skip: number, take: number): Promise<Awaited<ReturnType<typeof listComments>>>;
  addComment(meId: string, postId: string, desc: string): Promise<Awaited<ReturnType<typeof addComment>>>;
  deleteComment(meId: string, role: string | undefined, commentId: string): Promise<Awaited<ReturnType<typeof deleteComment>>>;
  toggleCommentLike(meId: string, commentId: string): Promise<Awaited<ReturnType<typeof toggleCommentLike>>>;
}
