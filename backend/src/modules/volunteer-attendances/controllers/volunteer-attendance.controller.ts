/**
 * Volunteer attendance controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateAttendanceBody,
  ListAttendancesQuery,
} from "../schemas/volunteer-attendance.schema";
import type { VolunteerAttendanceService } from "../services/volunteer-attendance.service";

export class VolunteerAttendanceController {
  constructor(private readonly volunteerAttendanceService: VolunteerAttendanceService) {}

  /** GET /api/volunteer-attendances?volunteerId=&from=&to=&limit= */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListAttendancesQuery>(req);
      const rows = await this.volunteerAttendanceService.list(query, req.session!);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/volunteer-attendances — 201 when recorded, 200 when the
   *  check-in was an idempotent duplicate (legacy status codes). */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateAttendanceBody>(req);
      const result = await this.volunteerAttendanceService.create(req.session!, body);
      res.status(result.created ? 201 : 200).json(result.row);
    } catch (error) {
      next(error);
    }
  };
}
