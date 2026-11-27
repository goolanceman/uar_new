/**
 * Post controller — HTTP layer only. Extracts validated data / session /
 * multipart request, delegates to the service, returns the response. Errors
 * flow to the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  ByHashtagQuery,
  ByInterestQuery,
  CommentIdParams,
  HashtagsQuery,
  ListFeedQuery,
  PostBody,
  PostIdParams,
  SavedPostsQuery,
  SearchPostsQuery,
  UserIdParams,
} from "../schemas/post.schema";
import type { PostService } from "../services/post.service";

export class PostController {
  constructor(private readonly postService: PostService) {}

  /** GET /api/posts?type=latest|random&page=&limit= — the main feed. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListFeedQuery>(req);
      const payload = await this.postService.listFeed(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/posts/saved — the session user's saved posts. */
  saved: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<SavedPostsQuery>(req);
      const payload = await this.postService.listSaved(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/posts/search?q= (legacy searchPost). */
  search: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<SearchPostsQuery>(req);
      const payload = await this.postService.search(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/posts/by-interest?ids=1,2&q= (legacy searchPostByInterestId). */
  byInterest: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<ByInterestQuery>(req);
      const payload = await this.postService.listByInterest(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/posts/by-hashtag?tags=a,b (legacy fetchPostsByHashtag). */
  byHashtag: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<ByHashtagQuery>(req);
      const payload = await this.postService.listByHashtag(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/posts/hashtags?q= → [{tag, postCount}] (legacy searchHashtag). */
  hashtags: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<HashtagsQuery>(req);
      const payload = await this.postService.searchHashtags(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/posts/user/:userId — a user's posts (legacy fetchPostByUser). */
  byUser: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<ListFeedQuery>(req);
      const { userId } = validatedParams<UserIdParams>(req);
      const payload = await this.postService.listByUser(req.session!, userId, query.page, query.limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/posts/comments/:commentId — owner OR moderator. */
  deleteComment: RequestHandler = async (req, res, next) => {
    try {
      const { commentId } = validatedParams<CommentIdParams>(req);
      const result = await this.postService.deleteComment(req.session!, commentId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/posts/comments/:commentId/like — toggle (likeDislikeComment). */
  toggleCommentLike: RequestHandler = async (req, res, next) => {
    try {
      const { commentId } = validatedParams<CommentIdParams>(req);
      const result = await this.postService.toggleCommentLike(req.session!, commentId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/posts — multipart media + text fields (legacy addPost). */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<PostBody>(req);
      const post = await this.postService.create(req, req.session!, body);
      res.status(201).json(post);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/posts/:id — single feed post (legacy fetchPostByPostId). */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<PostIdParams>(req);
      const post = await this.postService.get(req.session!, id);
      res.json(post);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/posts/:id — owner OR moderator (deleteMyPost + deletePostByModerator). */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<PostIdParams>(req);
      const result = await this.postService.remove(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/posts/:id — edit desc/tags/interests/restriction. The owner may
   *  always edit; a moderator may edit anyone's (legacy feed/update). */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<PostIdParams>(req);
      const body = validatedBody<PostBody>(req);
      const result = await this.postService.update(req.session!, id, body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/posts/:id/report { reason, desc } (legacy reportPost). */
  report: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<PostIdParams>(req);
      const body = validatedBody<PostBody>(req);
      const result = await this.postService.report(req.session!, id, body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/posts/:id/like { reaction } (legacy likePost). */
  like: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<PostIdParams>(req);
      const body = validatedBody<PostBody>(req);
      const result = await this.postService.like(req.session!, id, body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/posts/:id/like (legacy dislikePost). */
  unlike: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<PostIdParams>(req);
      const result = await this.postService.unlike(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/posts/:id/likes — users who liked the post (fetchUsersWhoLikedPost). */
  likers: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<ListFeedQuery>(req);
      const { id } = validatedParams<PostIdParams>(req);
      const payload = await this.postService.listLikers(req.session!, id, query.page, query.limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/posts/:id/comments (legacy fetchComments). */
  comments: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<ListFeedQuery>(req);
      const { id } = validatedParams<PostIdParams>(req);
      const payload = await this.postService.listComments(req.session!, id, query.page, query.limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/posts/:id/comments { desc } (legacy addComment). */
  addComment: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<PostIdParams>(req);
      const body = validatedBody<PostBody>(req);
      const comment = await this.postService.addComment(req.session!, id, body);
      res.status(201).json(comment);
    } catch (error) {
      next(error);
    }
  };
}
