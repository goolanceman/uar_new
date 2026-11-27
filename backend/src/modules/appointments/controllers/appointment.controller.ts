/**
 * Appointment controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  AppointmentBody,
  AppointmentIdParams,
  ListAppointmentsQuery,
} from "../schemas/appointment.schema";
import type { AppointmentService } from "../services/appointment.service";

export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  /** GET /api/appointments?campId&beneficiaryId&professionalId&type&status&from&to */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListAppointmentsQuery>(req);
      const payload = await this.appointmentService.list(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/appointments {campId?, beneficiaryId, professionalId?, type, scheduledAt, notes?} */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<AppointmentBody>(req);
      const appointment = await this.appointmentService.create(body, req.session!);
      res.status(201).json(appointment);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/appointments/:id — ADMIN | VOLUNTEER | DOCTOR. */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AppointmentIdParams>(req);
      const appointment = await this.appointmentService.get(id);
      res.json(appointment);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/appointments/:id {status?, noShowReason?, professionalId?, scheduledAt?, notes?} */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AppointmentIdParams>(req);
      const body = validatedBody<AppointmentBody>(req);
      const appointment = await this.appointmentService.update(id, body, req.session!);
      res.json(appointment);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/appointments/:id (ADMIN) — only while still SCHEDULED. */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AppointmentIdParams>(req);
      const result = await this.appointmentService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
