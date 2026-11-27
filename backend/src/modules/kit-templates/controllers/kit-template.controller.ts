/**
 * Kit template controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import type { KitTemplateService } from "../services/kit-template.service";
import type {
  CreateKitTemplateBody,
  UpdateKitTemplateBody,
} from "../schemas/kit-template.schema";

export class KitTemplateController {
  constructor(private readonly kitTemplateService: KitTemplateService) {}

  /** GET /api/kit-templates (auth) — incl. _count batches. */
  list: RequestHandler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const templates = await this.kitTemplateService.list();
      res.json(templates);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/kit-templates (ADMIN) — {name, description?, items, costPerUnit}. */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<CreateKitTemplateBody>(req);
      const template = await this.kitTemplateService.create(body, req.session!);
      res.status(201).json(template);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/kit-templates/:id (ADMIN). */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateKitTemplateBody>(req);
      const template = await this.kitTemplateService.update(id, body, req.session!);
      res.json(template);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/kit-templates/:id (ADMIN) — blocked when batches exist. */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.kitTemplateService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
