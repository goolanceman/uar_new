/**
 * Ambulance controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateAmbulanceBody,
  ListAmbulancesQuery,
  UpdateAmbulanceBody,
} from "../schemas/ambulance.schema";
import type { AmbulanceService } from "../services/ambulance.service";

export class AmbulanceController {
  constructor(private readonly ambulanceService: AmbulanceService) {}

  /** GET /api/ambulances?status=&type=&q= (auth). */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListAmbulancesQuery>(req);
      const ambulances = await this.ambulanceService.list(query);
      res.json(ambulances);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/ambulances (ADMIN) — 201. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateAmbulanceBody>(req);
      const ambulance = await this.ambulanceService.create(req.session!, body);
      res.status(201).json(ambulance);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/ambulances/:id (ADMIN). */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateAmbulanceBody>(req);
      const ambulance = await this.ambulanceService.update(req.session!, id, body);
      res.json(ambulance);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/ambulances/:id (ADMIN) — blocked while ON_MISSION. */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.ambulanceService.remove(req.session!, id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
