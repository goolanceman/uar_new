/**
 * Batch controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors render through
 * lib/session handleError directly (the legacy per-route catch).
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError } from "@/infrastructure/auth/session";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import type { FoodBody } from "../schemas/food.schema";
import type { BatchService } from "../services/batch.service";

export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  /** GET /api/food/batches?itemId&q&expiring=days&quality — stock desk. */
  list: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;
      const rows = await this.batchService.list(sp);
      res.json(rows);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/food/batches — ADMIN goods receipt. */
  receive: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = validatedBody<FoodBody>(req);
      const row = await this.batchService.receive(body, req.session!);
      res.status(201).json(row);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/food/batches/:id — ADMIN quality inspection & waste. */
  inspect: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<FoodBody>(req);
      const row = await this.batchService.inspect(id, body, req.session!);
      res.json(row);
    } catch (error) {
      handleError(error, res);
    }
  };
}
