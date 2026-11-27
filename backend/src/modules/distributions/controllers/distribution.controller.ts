/**
 * Distribution controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type { DistributionService } from "../services/distribution.service";
import type {
  CreateDistributionBody,
  DistributionIdParams,
  ListDistributionsQuery,
  UpdateDistributionBody,
} from "../schemas/distribution.schema";

export class DistributionController {
  constructor(private readonly distributionService: DistributionService) {}

  /** GET /api/distributions — raw array, or the withTotals envelope, or the
   *  unified ledger (?unified=1, exact URLSearchParams passed through). */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListDistributionsQuery>(req);
      const sp = new URL(req.url, "http://localhost").searchParams;
      const payload = await this.distributionService.list(query, sp, req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/distributions (VOLUNTEER | ADMIN). */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateDistributionBody>(req);
      const row = await this.distributionService.create(body, req.session!);
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/distributions/:id (ADMIN, VOLUNTEER) — enriched detail. */
  getById: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<DistributionIdParams>(req);
      const row = await this.distributionService.getById(id);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/distributions/:id (ADMIN, or the recording VOLUNTEER). */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<DistributionIdParams>(req);
      const body = validatedBody<UpdateDistributionBody>(req);
      const row = await this.distributionService.update(id, body, req.session!);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/distributions/:id (ADMIN, or the recording VOLUNTEER). */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<DistributionIdParams>(req);
      const result = await this.distributionService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
