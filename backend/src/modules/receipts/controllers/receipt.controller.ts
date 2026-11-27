/**
 * Receipt controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type { ReceiptService } from "../services/receipt.service";
import type { ListReceiptsQuery, ReceiptNumberParams } from "../schemas/receipt.schema";

export class ReceiptController {
  constructor(private readonly receiptService: ReceiptService) {}

  /** GET /api/receipts?from&to&limit */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListReceiptsQuery>(req);
      const receipts = await this.receiptService.list(req.session!, query);
      res.json(receipts);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/receipts/:receiptNumber */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { receiptNumber } = validatedParams<ReceiptNumberParams>(req);
      const payload = await this.receiptService.getByReceiptNumber(receiptNumber);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/receipts/:receiptNumber/html — print-ready HTML document. */
  html: RequestHandler = async (req, res, next) => {
    try {
      const { receiptNumber } = validatedParams<ReceiptNumberParams>(req);
      const html = await this.receiptService.getHtml(receiptNumber);
      res
        .status(200)
        .setHeader("content-type", "text/html; charset=utf-8")
        .setHeader("cache-control", "no-store")
        .send(html);
    } catch (error) {
      next(error);
    }
  };
}
