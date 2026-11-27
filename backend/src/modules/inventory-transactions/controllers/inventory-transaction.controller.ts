/**
 * Inventory transaction controller — HTTP layer only. Extracts validated data
 * / session, delegates to the service, returns the response. Errors flow to
 * the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateTransactionBody,
  ListTransactionsQuery,
} from "../schemas/inventory-transaction.schema";
import type { InventoryTransactionService } from "../services/inventory-transaction.service";

export class InventoryTransactionController {
  constructor(private readonly inventoryTransactionService: InventoryTransactionService) {}

  /** GET /api/inventory-transactions?itemId=&campId=&type=&page=&limit= */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListTransactionsQuery>(req);
      const payload = await this.inventoryTransactionService.list(query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/inventory-transactions — body checks run in the service
   *  (legacy order interleaves the inventory-item lookup). */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateTransactionBody>(req);
      const payload = await this.inventoryTransactionService.create(req.session!, body);
      res.status(201).json(payload);
    } catch (error) {
      next(error);
    }
  };
}
