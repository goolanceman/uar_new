/**
 * Community users controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedParams, validatedQuery } from "@/shared/middleware/validate";
import { pageParamsFrom } from "@/shared/schemas/common";
import type { CommunityUserService } from "../services/community-user.service";
import type {
  CommunityUserIdParams,
  ListCommunityUsersQuery,
  SearchCommunityUsersQuery,
} from "../schemas/community-user.schema";

export class CommunityUserController {
  constructor(private readonly communityUserService: CommunityUserService) {}

  /** GET /me/blocked — users I blocked. */
  listBlocked: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListCommunityUsersQuery>(req);
      const { page, limit, skip } = pageParamsFrom(query);
      const payload = await this.communityUserService.listBlocked(req.session!, page, limit, skip);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /search?q= — visible-profile search. */
  search: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<SearchCommunityUsersQuery>(req);
      const { page, limit, skip } = pageParamsFrom(query);
      const payload = await this.communityUserService.search(req.session!, query.q, page, limit, skip);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /search-chat?q= — contacts picker. */
  searchChat: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<SearchCommunityUsersQuery>(req);
      const { page, limit, skip } = pageParamsFrom(query);
      const payload = await this.communityUserService.searchChat(req.session!, query.q, page, limit, skip);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /random — single resource → the object (or null). */
  random: RequestHandler = async (req, res, next) => {
    try {
      const user = await this.communityUserService.random(req.session!);
      res.json(user);
    } catch (error) {
      next(error);
    }
  };

  /** GET /:id — profile + follow status + block flags. */
  getProfile: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<CommunityUserIdParams>(req);
      const profile = await this.communityUserService.getProfile(req.session!, id);
      res.json(profile);
    } catch (error) {
      next(error);
    }
  };

  /** POST /:id/follow */
  follow: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<CommunityUserIdParams>(req);
      const result = await this.communityUserService.follow(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /:id/follow */
  unfollow: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<CommunityUserIdParams>(req);
      const result = await this.communityUserService.unfollow(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /:id/followers?q= */
  listFollowers: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<CommunityUserIdParams>(req);
      const query = validatedQuery<SearchCommunityUsersQuery>(req);
      const { page, limit, skip } = pageParamsFrom(query);
      const payload = await this.communityUserService.listFollowers(id, query.q, page, limit, skip);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /:id/following */
  listFollowing: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<CommunityUserIdParams>(req);
      const query = validatedQuery<ListCommunityUsersQuery>(req);
      const { page, limit, skip } = pageParamsFrom(query);
      const payload = await this.communityUserService.listFollowing(req.session!, id, page, limit, skip);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /:id/block */
  block: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<CommunityUserIdParams>(req);
      const result = await this.communityUserService.block(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /:id/block */
  unblock: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<CommunityUserIdParams>(req);
      const result = await this.communityUserService.unblock(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /:id/report { reason, desc } — body read raw (never rejects). */
  report: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<CommunityUserIdParams>(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await this.communityUserService.report(req.session!, id, body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /:id/moderator-block — moderator only. */
  moderatorBlock: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<CommunityUserIdParams>(req);
      const result = await this.communityUserService.moderatorBlock(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
