/**
 * Medical document controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedParams, validatedQuery } from "@/shared/middleware/validate";
import { pageParamsFrom } from "@/shared/schemas/common";
import type { MedicalDocumentService } from "../services/medical-document.service";
import type { ListMedicalDocumentsQuery } from "../schemas/medical-document.schema";

export class MedicalDocumentController {
  constructor(private readonly medicalDocumentService: MedicalDocumentService) {}

  /** GET /api/medical-documents?beneficiaryId= — role-scoped list. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListMedicalDocumentsQuery>(req);
      const { page, limit, skip } = pageParamsFrom(query);
      const payload = await this.medicalDocumentService.list(query, skip, req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/medical-documents {beneficiaryId, campId?, name, kind, url} */
  create: RequestHandler = async (req, res, next) => {
    try {
      // Legacy read the body raw: its checks are interleaved with DB lookups
      // and live in the service in the exact original order.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const document = await this.medicalDocumentService.create(body, req.session!);
      res.status(201).json(document);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/medical-documents/:id */
  getById: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const document = await this.medicalDocumentService.getById(id, req.session!);
      res.json(document);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/medical-documents/:id */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.medicalDocumentService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
