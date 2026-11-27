/**
 * Camp registration controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateCampRegistrationBody,
  ListCampRegistrationsQuery,
  UpdateCampRegistrationBody,
} from "../schemas/camp-registration.schema";
import type { CampRegistrationService } from "../services/camp-registration.service";

export class CampRegistrationController {
  constructor(private readonly campRegistrationService: CampRegistrationService) {}

  /** GET /api/camp-registrations?q&campId&status&page&limit
   *  ADMIN | VOLUNTEER all; HOSPITAL only camps its org partners; BENEFICIARY own. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListCampRegistrationsQuery>(req);
      const payload = await this.campRegistrationService.list(query, req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/camp-registrations (ADMIN | VOLUNTEER | NURSE desk; BENEFICIARY
   *  self-service) — {campId, beneficiaryId, registeredVia?, scheduledSlot?, notes?}. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateCampRegistrationBody>(req);
      const registration = await this.campRegistrationService.create(body, req.session!);
      res.status(201).json(registration);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/camp-registrations/:id — ADMIN | VOLUNTEER. */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const registration = await this.campRegistrationService.getDetail(id);
      res.json(registration);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/camp-registrations/:id (ADMIN | VOLUNTEER)
   *  {status: CONFIRMED|CANCELLED|REJECTED, scheduledSlot?, notes?} */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateCampRegistrationBody>(req);
      const registration = await this.campRegistrationService.update(id, body, req.session!);
      res.json(registration);
    } catch (error) {
      next(error);
    }
  };
}
