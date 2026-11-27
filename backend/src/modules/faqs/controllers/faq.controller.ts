/**
 * FAQ controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type { FaqService } from "../services/faq.service";
import type { ListFaqsQuery } from "../schemas/faq.schema";

export class FaqController {
  constructor(private readonly faqService: FaqService) {}

  /** GET /api/faqs */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit } = validatedQuery<ListFaqsQuery>(req);
      const payload = await this.faqService.list((page - 1) * limit, page, limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/faqs/types */
  createType: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<{ title: string }>(req);
      const row = await this.faqService.createType(body.title, req.session!);
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/faqs/types/:id */
  updateType: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: number }>(req);
      const body = validatedBody<{ title: string }>(req);
      const row = await this.faqService.updateType(id, body.title, req.session!);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/faqs/types/:id */
  deleteType: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: number }>(req);
      const result = await this.faqService.deleteType(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/faqs */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<{ faqsTypeId: number; question: string; answer: string }>(req);
      const row = await this.faqService.createFaq(body, req.session!);
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/faqs/:id */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: number }>(req);
      const body = validatedBody<{ question?: string; answer?: string; faqsTypeId?: number }>(req);
      const row = await this.faqService.updateFaq(id, body, req.session!);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/faqs/:id */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: number }>(req);
      const result = await this.faqService.deleteFaq(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
