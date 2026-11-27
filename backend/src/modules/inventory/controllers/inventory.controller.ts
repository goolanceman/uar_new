/**
 * Inventory controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type { InventoryService } from "../services/inventory.service";
import type { InventoryIdParams, ListInventoryQuery } from "../schemas/inventory.schema";

export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /** GET /api/inventory?category=&q=&low=1 (auth) — orderBy name. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListInventoryQuery>(req);
      const rows = await this.inventoryService.list(query);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/inventory (ADMIN | VOLUNTEER) — body coerced in the service. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const item = await this.inventoryService.create(body, req.session!);
      res.status(201).json(item);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/inventory/:id — item + purchase history. */
  getById: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<InventoryIdParams>(req);
      const item = await this.inventoryService.getById(id);
      res.json(item);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/inventory/:id — body coerced in the service after the 404. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<InventoryIdParams>(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const item = await this.inventoryService.update(id, body, req.session!);
      res.json(item);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/inventory/:id (ADMIN). */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<InventoryIdParams>(req);
      const result = await this.inventoryService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
