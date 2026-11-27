/**
 * Camp expense controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedQuery } from "@/shared/middleware/validate";
import type { ListCampExpensesQuery } from "../schemas/camp-expense.schema";
import type { CampExpenseService } from "../services/camp-expense.service";

export class CampExpenseController {
  constructor(private readonly campExpenseService: CampExpenseService) {}

  /** GET /api/camp-expenses?campId= */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListCampExpensesQuery>(req);
      const payload = await this.campExpenseService.list(query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/camp-expenses — body checked in the service (legacy order). */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawBody = (req.body ?? null) as Record<string, unknown> | null;
      const expense = await this.campExpenseService.create(req.session!, rawBody);
      res.status(201).json(expense);
    } catch (error) {
      next(error);
    }
  };
}
