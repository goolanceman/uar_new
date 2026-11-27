/**
 * Kit unit controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedQuery } from "@/shared/middleware/validate";
import type { ListKitUnitsQuery } from "../schemas/kit-unit.schema";
import type { KitUnitService } from "../services/kit-unit.service";

export class KitUnitController {
  constructor(private readonly kitUnitService: KitUnitService) {}

  /** GET /api/kit-units?batchId=&status=&q=&mine=1&limit= (auth) — code asc. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListKitUnitsQuery>(req);
      const units = await this.kitUnitService.list(query, req.session!.userId);
      res.json(units);
    } catch (error) {
      next(error);
    }
  };
}
