/**
 * Encounter controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateEncounterBody,
  EncounterIdParams,
  ListEncountersQuery,
  UpdateEncounterBody,
} from "../schemas/encounter.schema";
import type { EncounterService } from "../services/encounter.service";

export class EncounterController {
  constructor(private readonly encounterService: EncounterService) {}

  /** GET /api/encounters — staff list (newest first). */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListEncountersQuery>(req);
      const payload = await this.encounterService.list(query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/encounters */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateEncounterBody>(req) ?? {};
      const encounter = await this.encounterService.create(body, req.session!);
      res.status(201).json(encounter);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/encounters/:id */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<EncounterIdParams>(req);
      const encounter = await this.encounterService.get(id, req.session!);
      res.json(encounter);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/encounters/:id */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<EncounterIdParams>(req);
      const body = validatedBody<UpdateEncounterBody>(req) ?? {};
      const encounter = await this.encounterService.update(id, body, req.session!);
      res.json(encounter);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/encounters/:id/sign */
  sign: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<EncounterIdParams>(req);
      const encounter = await this.encounterService.sign(id, req.session!);
      res.json(encounter);
    } catch (error) {
      next(error);
    }
  };
}
