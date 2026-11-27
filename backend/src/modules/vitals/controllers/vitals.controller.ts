/**
 * Vitals controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedQuery } from "@/shared/middleware/validate";
import { pageParamsFrom } from "@/shared/schemas/common";
import type { VitalsService } from "../services/vitals.service";
import type { CreateVitalsBody, ListVitalsQuery } from "../schemas/vitals.schema";

export class VitalsController {
  constructor(private readonly vitalsService: VitalsService) {}

  /** GET /api/vitals — filters: beneficiaryId, campId, encounterId. Newest first. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListVitalsQuery>(req);
      const { page, limit, skip } = pageParamsFrom(query);
      const payload = await this.vitalsService.list(query, skip, page, limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/vitals {beneficiaryId, campId?, encounterId?, bpSystolic?, ..., glucose?} */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<CreateVitalsBody>(req);
      const vital = await this.vitalsService.create(body, req.session!);
      res.status(201).json(vital);
    } catch (error) {
      next(error);
    }
  };
}
