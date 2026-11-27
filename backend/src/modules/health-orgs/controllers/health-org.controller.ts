/**
 * Health org controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateHealthOrgBody,
  ListHealthOrgsQuery,
  UpdateHealthOrgBody,
} from "../schemas/health-org.schema";
import type { HealthOrgService } from "../services/health-org.service";

export class HealthOrgController {
  constructor(private readonly healthOrgService: HealthOrgService) {}

  /** GET /api/health-orgs — ADMIN sees all; HOSPITAL only its own org; DOCTOR directory. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListHealthOrgsQuery>(req);
      const payload = await this.healthOrgService.list(query, req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/health-orgs (ADMIN) — orgs are created PENDING until verified. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateHealthOrgBody>(req);
      const org = await this.healthOrgService.create(body, req.session!);
      res.status(201).json(org);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/health-orgs/:id — ADMIN, or the HOSPITAL user that owns the org. */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const org = await this.healthOrgService.getDetail(id, req.session!);
      res.json(org);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/health-orgs/:id (ADMIN) — verification or plain field edits. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateHealthOrgBody>(req);
      const org = await this.healthOrgService.update(id, body, req.session!);
      res.json(org);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/health-orgs/:id (ADMIN) — only when the org has no camp partnerships. */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.healthOrgService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
