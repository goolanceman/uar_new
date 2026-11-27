/**
 * Interest controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type { InterestIdParams, ListInterestsQuery } from "../schemas/interest.schema";
import type { InterestService } from "../services/interest.service";

export class InterestController {
  constructor(private readonly interestService: InterestService) {}

  /** GET /api/interests?page=&limit= — interests + totalRoomOfInterest. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit } = validatedQuery<ListInterestsQuery>(req);
      const payload = await this.interestService.list(page, limit, (page - 1) * limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/interests {title} — admin. */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const title = validatedBody<string>(req);
      const row = await this.interestService.create(title, req.session!);
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/interests/:id {title} — admin. */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const title = validatedBody<string>(req);
      const { id } = validatedParams<InterestIdParams>(req);
      // Legacy converted the raw :id with Number() here — AFTER the title
      // check — so "abc" became NaN and failed inside the service.
      const row = await this.interestService.update(Number(id), title, req.session!);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/interests/:id — admin. */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<InterestIdParams>(req);
      // Same legacy Number() conversion (no param-level validation).
      const row = await this.interestService.remove(Number(id), req.session!);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };
}
