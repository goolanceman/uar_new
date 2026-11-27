/**
 * Camp attendance controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedQuery } from "@/shared/middleware/validate";
import type {
  CheckInBody,
  ListCampAttendanceQuery,
  UpdateAttendanceBody,
} from "../schemas/camp-attendance.schema";
import type { CampAttendanceService } from "../services/camp-attendance.service";

export class CampAttendanceController {
  constructor(private readonly campAttendanceService: CampAttendanceService) {}

  /**
   * GET /api/camp-attendance?campId&status  |  ?campId&summary=1 — queue
   * listing or live dashboard counters.
   */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListCampAttendanceQuery>(req);
      const payload = await this.campAttendanceService.list(query, req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/camp-attendance (ADMIN | VOLUNTEER | NURSE) — the CHECK-IN. */
  checkIn: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CheckInBody>(req);
      const attendance = await this.campAttendanceService.checkIn(body, req.session!);
      res.status(201).json(attendance);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/camp-attendance — status transitions, doctor assignment. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<UpdateAttendanceBody>(req);
      const updated = await this.campAttendanceService.update(body, req.session!);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  };
}
