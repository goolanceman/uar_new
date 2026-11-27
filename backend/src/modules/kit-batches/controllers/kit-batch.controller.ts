/**
 * Kit batch controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateKitBatchBody,
  ListKitBatchesQuery,
  UpdateKitBatchBody,
} from "../schemas/kit-batch.schema";
import type { KitBatchService } from "../services/kit-batch.service";

export class KitBatchController {
  constructor(private readonly kitBatchService: KitBatchService) {}

  /** GET /api/kit-batches?status= — newest first, incl. template + unit count. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListKitBatchesQuery>(req);
      const batches = await this.kitBatchService.list(query);
      res.json(batches);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/kit-batches (ADMIN) — creates the batch + N QR-coded kit units. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateKitBatchBody>(req);
      const full = await this.kitBatchService.create(body, req.session!);
      res.status(201).json({ batch: full });
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/kit-batches/:id (ADMIN) — {name?, instructions?, status?}. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateKitBatchBody>(req);
      const batch = await this.kitBatchService.update(id, body, req.session!);
      res.json(batch);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/kit-batches/:id (ADMIN) — removes units then the batch. */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.kitBatchService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
