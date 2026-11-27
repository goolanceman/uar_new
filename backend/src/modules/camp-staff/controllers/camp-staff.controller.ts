/**
 * Camp staff controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateCampStaffBody,
  DeleteCampStaffQuery,
  ListCampStaffQuery,
  UpdateCampStaffBody,
} from "../schemas/camp-staff.schema";
import type { CampStaffService } from "../services/camp-staff.service";

export class CampStaffController {
  constructor(private readonly campStaffService: CampStaffService) {}

  /** GET /api/camp-staff?campId= — authenticated (camp roster). */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListCampStaffQuery>(req);
      const payload = await this.campStaffService.list(query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/camp-staff (ADMIN | HOSPITAL) — {campId, professionalId?, volunteerId?, role}. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateCampStaffBody>(req);
      const staff = await this.campStaffService.create(body, req.session!);
      res.status(201).json(staff);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/camp-staff?id= (ADMIN) — remove from roster. */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const query = validatedQuery<DeleteCampStaffQuery>(req);
      const result = await this.campStaffService.remove(query, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/camp-staff/:id — ADMIN advances an assignment through camp day. */
  updateStatus: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateCampStaffBody>(req);
      const updated = await this.campStaffService.updateStatus(id, body, req.session!);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  };
}
