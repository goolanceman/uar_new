/**
 * Inventory forecast controller — HTTP layer only. Delegates to the service
 * and returns the response; errors flow to the centralized error middleware
 * via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { InventoryForecastService } from "../services/inventory-forecast.service";

export class InventoryForecastController {
  constructor(private readonly inventoryForecastService: InventoryForecastService) {}

  /** GET /api/inventory-forecast */
  index: RequestHandler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.inventoryForecastService.getForecast();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };
}
