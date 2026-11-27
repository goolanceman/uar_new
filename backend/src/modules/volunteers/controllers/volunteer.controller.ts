/**
 * Volunteer controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type { ListVolunteersQuery, UpdateVolunteerBody } from "../schemas/volunteer.schema";
import type { VolunteerService } from "../services/volunteer.service";

export class VolunteerController {
  constructor(private readonly volunteerService: VolunteerService) {}

  /**
   * GET /api/volunteers (ADMIN) — roster array or ?analytics=1 roll-up.
   */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListVolunteersQuery>(req);
      const rows = await this.volunteerService.list(query);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/volunteers/me — { volunteer: profile incl tasks | null,
   * application: latest VolunteerApplication | null }.
   */
  me: RequestHandler = async (req, res, next) => {
    try {
      const session = req.session!;
      const payload = await this.volunteerService.me(session.userId);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/volunteers/:id — admin updates the volunteer profile; a
   * volunteer may update the self-service roster fields of their own record.
   */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateVolunteerBody>(req);
      const volunteer = await this.volunteerService.update(id, body, req.session!);
      res.json(volunteer);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/volunteers/:id — profile with tasks + attendance summary. */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const volunteer = await this.volunteerService.get(id);
      res.json(volunteer);
    } catch (error) {
      next(error);
    }
  };
}
