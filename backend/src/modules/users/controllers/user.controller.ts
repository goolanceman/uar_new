/**
 * User controller (admin directory) — HTTP layer only. Extracts validated
 * data / session, delegates to the service, returns the response. Errors flow
 * to the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type { ListUsersQuery, UserBody, UserIdParams } from "../schemas/user.schema";
import type { UserService } from "../services/user.service";

export class UserController {
  constructor(private readonly userService: UserService) {}

  /** GET /api/users?q&role&status — admin directory. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListUsersQuery>(req);
      const users = await this.userService.list(query);
      res.json(users);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/users — admin creates a user. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<UserBody>(req);
      const user = await this.userService.create(body, req.session!);
      res.status(201).json(user);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/users/:id — full record + recent audit-trail entries. */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<UserIdParams>(req);
      const payload = await this.userService.get(id);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/users/:id — admin edits a user. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<UserIdParams>(req);
      const body = validatedBody<UserBody>(req);
      const user = await this.userService.update(id, body, req.session!);
      res.json(user);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/users/:id — admin removes a user (community cascade). */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<UserIdParams>(req);
      const result = await this.userService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
