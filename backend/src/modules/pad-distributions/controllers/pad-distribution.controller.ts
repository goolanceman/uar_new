/**
 * Pad distribution controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedQuery } from "@/shared/middleware/validate";
import type { PadDistributionService } from "../services/pad-distribution.service";
import type { ListPadDistributionsQuery } from "../schemas/pad-distribution.schema";

export class PadDistributionController {
  constructor(private readonly padDistributionService: PadDistributionService) {}

  /**
   * GET /api/pad-distributions
   *   ?q= &session=1|0 &from= &to= &volunteerId= &limit= &offset= &withTotals=1
   * Default = raw array (legacy). withTotals=1 → {items,total,sumPads,sumGirls,…}
   */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListPadDistributionsQuery>(req);
      const payload = await this.padDistributionService.list(query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/pad-distributions — body coerced in the service (legacy clamps). */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const row = await this.padDistributionService.create(rawBody, req.session!);
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/pad-distributions/:id — detail with volunteer name. */
  detail: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const payload = await this.padDistributionService.detail(id);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/pad-distributions/:id — body coerced in the service (legacy clamps). */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const row = await this.padDistributionService.update(id, rawBody, req.session!);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/pad-distributions/:id. */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await this.padDistributionService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
