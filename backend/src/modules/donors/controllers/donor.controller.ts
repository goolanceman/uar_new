/**
 * Donor controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedQuery } from "@/shared/middleware/validate";
import type { DonorService } from "../services/donor.service";
import type { ListDonorsQuery } from "../schemas/donor.schema";

export class DonorController {
  constructor(private readonly donorService: DonorService) {}

  /** GET /api/donors — admin donor CRM with aggregates + pagination. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListDonorsQuery>(req);
      const payload = await this.donorService.list(query, query.page, query.limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/donors — body checked in the service (exact legacy messages). */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const donor = await this.donorService.create(rawBody, req.session!);
      res.status(201).json(donor);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/donors/:id — donor 360. */
  detail: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const payload = await this.donorService.detail(id);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/donors/:id — body checked in the service (exact legacy order). */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const donor = await this.donorService.update(id, rawBody, req.session!);
      res.json(donor);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/donors/:id — remove CRM record (donations untouched). */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await this.donorService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
