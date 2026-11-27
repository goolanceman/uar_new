/**
 * Certificate controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CertificateCodeParams,
  CreateCertificateBody,
  ListCertificatesQuery,
} from "../schemas/certificate.schema";
import type { CertificateService } from "../services/certificate.service";

export class CertificateController {
  constructor(private readonly certificateService: CertificateService) {}

  /** GET /api/certificates?limit=50 */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { limit } = validatedQuery<ListCertificatesQuery>(req);
      const rows = await this.certificateService.list(req.session!, limit);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/certificates */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateCertificateBody>(req);
      const certificate = await this.certificateService.create(body, req.session!);
      res.status(201).json({ certificate });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/certificates/:code */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { code } = validatedParams<CertificateCodeParams>(req);
      const certificate = await this.certificateService.getByCode(code);
      res.json(certificate);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/certificates/:code/html — print-ready HTML document. */
  html: RequestHandler = async (req, res, next) => {
    try {
      const { code } = validatedParams<CertificateCodeParams>(req);
      const html = await this.certificateService.getHtmlByCode(code);
      res
        .status(200)
        .setHeader("content-type", "text/html; charset=utf-8")
        .setHeader("cache-control", "no-store")
        .send(html);
    } catch (error) {
      next(error);
    }
  };
}
