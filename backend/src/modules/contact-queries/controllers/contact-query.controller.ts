/**
 * Contact query controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import type { ContactQueryService } from "../services/contact-query.service";
import type {
  CreateContactQueryBody,
  ListContactQueriesQuery,
  UpdateContactQueryBody,
} from "../schemas/contact-query.schema";

export class ContactQueryController {
  constructor(private readonly contactQueryService: ContactQueryService) {}

  /** GET /api/contact-queries?status — admin inbox. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status } = validatedQuery<ListContactQueriesQuery>(req);
      const queries = await this.contactQueryService.list(status);
      res.json(queries);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/contact-queries — public contact form. */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<CreateContactQueryBody>(req);
      const query = await this.contactQueryService.create(body);
      res.status(201).json(query);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/contact-queries/:id — admin updates query status. */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateContactQueryBody>(req);
      const query = await this.contactQueryService.update(id, body.status, req.session!);
      res.json(query);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/contact-queries/:id — admin removes a query. */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.contactQueryService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
