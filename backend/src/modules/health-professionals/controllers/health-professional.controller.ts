/**
 * Health professional controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateHealthProfessionalBody,
  ListHealthProfessionalsQuery,
  UpdateHealthProfessionalBody,
} from "../schemas/health-professional.schema";
import type { HealthProfessionalService } from "../services/health-professional.service";

export class HealthProfessionalController {
  constructor(private readonly healthProfessionalService: HealthProfessionalService) {}

  /** GET /api/health-professionals?q&kind&orgId&verificationStatus&active
   *  ADMIN: full directory. HOSPITAL: scoped to its own org. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListHealthProfessionalsQuery>(req);
      const payload = await this.healthProfessionalService.list(query, req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/health-professionals — new professionals start PENDING. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateHealthProfessionalBody>(req);
      const professional = await this.healthProfessionalService.create(body, req.session!);
      res.status(201).json(professional);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/health-professionals/:id — ADMIN, or the HOSPITAL owning the pro's org. */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const professional = await this.healthProfessionalService.getDetail(id, req.session!);
      res.json(professional);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/health-professionals/:id — ADMIN verifies; owning HOSPITAL edits profile. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateHealthProfessionalBody>(req);
      const professional = await this.healthProfessionalService.update(id, body, req.session!);
      res.json(professional);
    } catch (error) {
      next(error);
    }
  };
}
