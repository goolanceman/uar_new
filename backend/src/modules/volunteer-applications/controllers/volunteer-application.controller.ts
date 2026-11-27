/**
 * Volunteer application controller — HTTP layer only. Extracts validated
 * data / session, delegates to the service, returns the response.
 *
 * Errors are rendered with the lib handleError directly (NOT next(error)) —
 * the same pattern as the shared auth middleware's `fail`: the legacy
 * per-route catch did exactly this, and test harnesses mount this router
 * without an app-level error middleware, so the { error, status } contract
 * must hold even there.
 *
 * Auth gates that were the handler's FIRST step (requireAuth/requireRole on
 * /mine, PATCH, DELETE) live as middleware on the route; branch-dependent
 * gates (the soft ?mine=1 session check and the mid-handler ADMIN gate on
 * GET /, the optional session on POST) stay here as lib calls to preserve
 * the exact legacy ordering.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { handleError, requireRole, validateSession } from "@/lib/session";
import { ApiError } from "@/shared/errors";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  ApplyBody,
  ListApplicationsQuery,
  UpdateApplicationBody,
} from "../schemas/volunteer-application.schema";
import type { VolunteerApplicationService } from "../services/volunteer-application.service";

export class VolunteerApplicationController {
  constructor(private readonly volunteerApplicationService: VolunteerApplicationService) {}

  /** GET /api/volunteer-applications?mine=1 | (ADMIN) ?status&q */
  list: RequestHandler = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListApplicationsQuery>(req);

      if (query.mine) {
        const session = await validateSession(req);
        if (!session) throw new ApiError("Please sign in to continue", 401);
        const applications = await this.volunteerApplicationService.listMine(session.userId);
        res.json(applications);
        return;
      }

      await requireRole(req, "ADMIN");

      const applications = await this.volunteerApplicationService.listForAdmin({
        status: query.status,
        q: query.q,
      });
      res.json(applications);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** POST /api/volunteer-applications — public form (or logged-in user; the
   *  optional session is resolved mid-handler exactly like legacy). 201. */
  apply: RequestHandler = async (req, res, _next) => {
    try {
      const body = validatedBody<ApplyBody>(req);
      const session = await validateSession(req);
      const result = await this.volunteerApplicationService.apply(body, session);
      res.status(201).json({
        application: result.application,
        ...(result.tempCreds ? { tempCreds: result.tempCreds } : {}),
      });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/volunteer-applications/mine — latest application + timeline. */
  mine: RequestHandler = async (req, res, _next) => {
    try {
      const session = req.session!;
      const payload = await this.volunteerApplicationService.getMine(session.userId);
      res.json(payload);
    } catch (error) {
      handleError(error, res);
    }
  };

  /** PATCH /api/volunteer-applications/:id — owner resubmit | admin review. */
  update: RequestHandler = async (req, res, _next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateApplicationBody>(req);
      const result = await this.volunteerApplicationService.update(id, body, req.session!);
      res.json({ application: result.application });
    } catch (error) {
      handleError(error, res);
    }
  };

  /** DELETE /api/volunteer-applications/:id — admin removes an application. */
  remove: RequestHandler = async (req, res, _next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      await this.volunteerApplicationService.remove(id, req.session!);
      res.json({ ok: true });
    } catch (error) {
      handleError(error, res);
    }
  };
}
