/**
 * Medical camp controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to
 * the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validateSession } from "@/infrastructure/auth/session";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CampIdParams,
  CreateCampBody,
  ListCampsQuery,
  UpdateCampBody,
} from "../schemas/medical-camp.schema";
import type { MedicalCampService } from "../services/medical-camp.service";

export class MedicalCampController {
  constructor(private readonly medicalCampService: MedicalCampService) {}

  /** GET /api/medical-camps?… — optional session (validateSession, the
   *  legacy first step): null stays anonymous with the public-status clamp. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await validateSession(req);
      const query = validatedQuery<ListCampsQuery>(req);
      const payload = await this.medicalCampService.list(query, session);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/medical-camps */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateCampBody>(req) ?? {};
      const camp = await this.medicalCampService.create(body, req.session!);
      res.status(201).json(camp);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/medical-camps/:id */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<CampIdParams>(req);
      const camp = await this.medicalCampService.get(id);
      res.json(camp);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/medical-camps/:id */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<CampIdParams>(req);
      const body = validatedBody<UpdateCampBody>(req) ?? {};
      const camp = await this.medicalCampService.update(id, body, req.session!);
      res.json(camp);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/medical-camps/:id */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<CampIdParams>(req);
      const result = await this.medicalCampService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
