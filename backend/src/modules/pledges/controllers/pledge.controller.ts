/**
 * Pledge controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type { ListPledgesQuery } from "../schemas/pledge.schema";
import type { PledgeService } from "../services/pledge.service";

export class PledgeController {
  constructor(private readonly pledgeService: PledgeService) {}

  /** GET /api/pledges?status=&q= */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListPledgesQuery>(req);
      const rows = await this.pledgeService.list(query);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/pledges/mine */
  mine: RequestHandler = async (req, res, next) => {
    try {
      const rows = await this.pledgeService.listMine(req.session!);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/pledges/:id */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const row = await this.pledgeService.getById(id, req.session!);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/pledges/:id — status check runs in the service (legacy order). */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<Record<string, unknown>>(req);
      const row = await this.pledgeService.update(id, body, req.session!);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/pledges/:id */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.pledgeService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
