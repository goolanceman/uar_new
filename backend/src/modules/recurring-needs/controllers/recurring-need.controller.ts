/**
 * Recurring-need controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  ListRecurringNeedsQuery,
  RecurringNeedIdParams,
} from "../schemas/recurring-need.schema";
import type { RecurringNeedService } from "../services/recurring-need.service";

export class RecurringNeedController {
  constructor(private readonly recurringNeedService: RecurringNeedService) {}

  /** GET /api/recurring-needs?beneficiaryId=&itemId=&status=&dueBy= */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListRecurringNeedsQuery>(req);
      const rows = await this.recurringNeedService.list(query);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/recurring-needs — raw body flows to the service unchanged
   *  (legacy read `req.body` with no `?? {}` normalization). */
  create: RequestHandler = async (req, res, next) => {
    try {
      const rawBody = req.body as Record<string, unknown>;
      const row = await this.recurringNeedService.create(req.session!, rawBody);
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/recurring-needs/:id — raw body flows to the service unchanged
   *  (legacy read `req.body` with no `?? {}` normalization, after the 404
   *  lookup). */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<RecurringNeedIdParams>(req);
      const rawBody = req.body as Record<string, unknown>;
      const row = await this.recurringNeedService.update(req.session!, id, rawBody);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/recurring-needs/:id */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<RecurringNeedIdParams>(req);
      const result = await this.recurringNeedService.remove(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
