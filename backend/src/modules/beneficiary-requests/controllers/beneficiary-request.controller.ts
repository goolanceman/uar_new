/**
 * Beneficiary-request controller — HTTP layer only. Extracts validated data
 * / session, delegates to the service, returns the response. Errors flow to
 * the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { requireRole, validateSession } from "@/infrastructure/auth/session";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateBeneficiaryRequestBody,
  ListBeneficiaryRequestsQuery,
  UpdateBeneficiaryRequestBody,
} from "../schemas/beneficiary-request.schema";
import type { BeneficiaryRequestService } from "../services/beneficiary-request.service";

export class BeneficiaryRequestController {
  constructor(private readonly beneficiaryRequestService: BeneficiaryRequestService) {}

  /** GET /api/beneficiary-requests — admin queue, or ?mine=1 for the caller.
   *  The legacy gate is branch-dependent (?mine=1 allows BENEFICIARY/DONOR/
   *  VOLUNTEER/ADMIN, otherwise ADMIN/VOLUNTEER), so it stays a mid-handler
   *  lib call to preserve ordering exactly. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { mine, status } = validatedQuery<ListBeneficiaryRequestsQuery>(req);
      if (mine) {
        await requireRole(req, "BENEFICIARY", "DONOR", "VOLUNTEER", "ADMIN");
        const mineRows = await this.beneficiaryRequestService.listMine(req.session!.userId);
        res.json(mineRows);
        return;
      }

      await requireRole(req, "ADMIN", "VOLUNTEER");
      const rows = await this.beneficiaryRequestService.listAll(status);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/beneficiary-requests — beneficiary submits a help request.
   *  Legacy gate: `await validateSession(req)` — an OPTIONAL session (null
   *  stays anonymous), so it stays a mid-handler lib call, not middleware. */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await validateSession(req);
      const body = validatedBody<CreateBeneficiaryRequestBody>(req) ?? {};
      const row = await this.beneficiaryRequestService.create(session, body);
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/beneficiary-requests/:id — admin reviews a request (field
   *  checks run in the service, after the legacy existence lookup). */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateBeneficiaryRequestBody>(req) ?? {};
      const row = await this.beneficiaryRequestService.update(id, body, req.session!);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/beneficiary-requests/:id */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.beneficiaryRequestService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
