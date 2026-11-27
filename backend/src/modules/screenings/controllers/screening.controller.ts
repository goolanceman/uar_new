/**
 * Screening controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedQuery } from "@/shared/middleware/validate";
import { pageParamsFrom } from "@/shared/schemas/common";
import type { ScreeningService } from "../services/screening.service";
import type { CreateScreeningBody, ListScreeningsQuery } from "../schemas/screening.schema";

export class ScreeningController {
  constructor(private readonly screeningService: ScreeningService) {}

  /** GET /api/screenings — filters: beneficiaryId, campId, encounterId, type, abnormal=1/0. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListScreeningsQuery>(req);
      const { page, limit, skip } = pageParamsFrom(query);
      const payload = await this.screeningService.list(query, skip, page, limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/screenings {campId?, beneficiaryId, encounterId?, type, result, abnormal?, notes?} */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<CreateScreeningBody>(req);
      const screening = await this.screeningService.create(body, req.session!);
      res.status(201).json(screening);
    } catch (error) {
      next(error);
    }
  };
}
