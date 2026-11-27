/**
 * Follow-up controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedParams, validatedQuery } from "@/shared/middleware/validate";
import { pageParamsFrom } from "@/shared/schemas/common";
import type { FollowUpService } from "../services/follow-up.service";
import type { FollowUpIdParams, ListFollowUpsQuery } from "../schemas/follow-up.schema";

export class FollowUpController {
  constructor(private readonly followUpService: FollowUpService) {}

  /** GET /api/follow-ups — filters: beneficiaryId, status, overdue=1. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListFollowUpsQuery>(req);
      const { page, limit, skip } = pageParamsFrom(query);
      const payload = await this.followUpService.list(query, skip, req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/follow-ups {beneficiaryId, campId?, referralId?, dueDate, instructions?, ownerName?} */
  create: RequestHandler = async (req, res, next) => {
    try {
      // Legacy read the body raw: its checks interleave with DB lookups and
      // live in the service in the exact original order.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const followUp = await this.followUpService.create(body, req.session!);
      res.status(201).json(followUp);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/follow-ups/:id */
  getById: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<FollowUpIdParams>(req);
      const followUp = await this.followUpService.getById(id);
      res.json(followUp);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/follow-ups/:id {status?, outcome?} — body read raw in the service. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<FollowUpIdParams>(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const followUp = await this.followUpService.update(id, body, req.session!);
      res.json(followUp);
    } catch (error) {
      next(error);
    }
  };
}
