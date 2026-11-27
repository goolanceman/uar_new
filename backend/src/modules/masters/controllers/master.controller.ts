/**
 * Master controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { requireRole } from "@/infrastructure/auth/session";
import { validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type { ListMastersQuery, MasterIdParams } from "../schemas/master.schema";
import type { MasterService } from "../services/master.service";

export class MasterController {
  constructor(private readonly masterService: MasterService) {}

  /** GET /api/masters — ?categories=1 | ?all=1 (ADMIN) | ?category=X.
   *  The legacy gate is branch-dependent (only the ?all=1 branch required
   *  ADMIN, the others are public), so it stays a mid-handler lib call. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { categories, all, category } = validatedQuery<ListMastersQuery>(req);

      if (categories) {
        const categoryList = await this.masterService.listCategories();
        res.json(categoryList);
        return;
      }

      if (all) {
        // Legacy gate: `await requireRole(req, "ADMIN")` mid-handler.
        await requireRole(req, "ADMIN");
        const rows = await this.masterService.listAll();
        res.json(rows);
        return;
      }

      if (!category) {
        res.json([]);
        return;
      }

      const rows = await this.masterService.listByCategory(category);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/masters (ADMIN) — upsert by (category, value). Raw body read
   *  (as legacy): the legacy route did NOT coalesce an absent body
   *  (req.body ?? {}), so a bodyless request must still crash into the 500
   *  path instead of inventing a 400 — parity over normalization. */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as Record<string, unknown>;
      const row = await this.masterService.upsert(body, req.session!);
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/masters/:id (ADMIN) — {label?, active?, sortOrder?, value?};
   *  field checks run in the service, after the legacy existence lookup.
   *  Raw body read for the same parity reason as POST. */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<MasterIdParams>(req);
      const body = req.body as Record<string, unknown>;
      const row = await this.masterService.update(id, body, req.session!);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/masters/:id (ADMIN) */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<MasterIdParams>(req);
      const result = await this.masterService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
