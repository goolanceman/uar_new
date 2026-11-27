/**
 * Cause controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validateSession } from "@/infrastructure/auth/session";
import { validatedQuery } from "@/shared/middleware/validate";
import type { CauseService } from "../services/cause.service";
import type { ListCausePledgesQuery, ListCausesQuery } from "../schemas/cause.schema";

export class CauseController {
  constructor(private readonly causeService: CauseService) {}

  /** GET /api/causes?condition=&status=&q= — public catalog. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListCausesQuery>(req);
      const causes = await this.causeService.list(query);
      res.json(causes);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/causes/pledges?mine=1&causeId= — the donor's pledge schedule. */
  listPledges: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListCausePledgesQuery>(req);
      const pledges = await this.causeService.listPledges(query, req.session!);
      res.json(pledges);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/causes — body checked in the service (exact legacy messages). */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const cause = await this.causeService.create(rawBody, req.session!);
      res.status(201).json(cause);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/causes/:id — public detail. */
  detail: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const cause = await this.causeService.detail(id);
      res.json(cause);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/causes/:id — body checked in the service (exact legacy order). */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const cause = await this.causeService.update(id, rawBody, req.session!);
      res.json(cause);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/causes/:id. */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await this.causeService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/causes/:id/pledges — public (guests) OR authenticated donors.
   * validateSession is the legacy FIRST step but is NOT a gate: an anonymous
   * visitor may pledge, so it stays an inline lib call (not middleware).
   */
  createPledge: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const session = await validateSession(req);
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const result = await this.causeService.createPledge(id, rawBody, session);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };
}
