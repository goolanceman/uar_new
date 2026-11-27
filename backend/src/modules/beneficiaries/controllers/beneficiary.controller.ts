/**
 * Beneficiary controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 *
 * The list handler's auth gate is branch-dependent (legacy): ?mine=1 used
 * `await requireAuth(req)` while the staff branch used
 * `await requireRole(req, "ADMIN", "VOLUNTEER", "DOCTOR", "NURSE")` — those
 * gates therefore stay as lib calls here, in the original order
 * (query-parse → gate → query).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { requireAuth, requireRole } from "@/infrastructure/auth/session";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type { BeneficiaryService } from "../services/beneficiary.service";
import type {
  BeneficiaryIdParams,
  CreateBeneficiaryBody,
  CreateNoteBody,
  ListBeneficiariesQuery,
  ReviewKycBody,
  SubmitKycBody,
  UpdateBeneficiaryBody,
} from "../schemas/beneficiary.schema";

export class BeneficiaryController {
  constructor(private readonly beneficiaryService: BeneficiaryService) {}

  /** GET /api/beneficiaries?q=&category=&active=0/1 (staff) · ?mine=1 (self case) */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListBeneficiariesQuery>(req);
      if (query.mine) {
        // A beneficiary sees only their own case record (no cross-enumeration)
        const session = await requireAuth(req);
        const rows = await this.beneficiaryService.listMine(session.userId);
        res.json(rows);
        return;
      }

      await requireRole(req, "ADMIN", "VOLUNTEER", "DOCTOR", "NURSE");
      const rows = await this.beneficiaryService.list(query);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/beneficiaries (ADMIN | VOLUNTEER). */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateBeneficiaryBody>(req);
      const beneficiary = await this.beneficiaryService.create(body, req.session!);
      res.status(201).json(beneficiary);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/beneficiaries/:id (ADMIN | VOLUNTEER). */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<BeneficiaryIdParams>(req);
      const body = validatedBody<UpdateBeneficiaryBody>(req);
      const beneficiary = await this.beneficiaryService.update(id, body, req.session!);
      res.json(beneficiary);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/beneficiaries/:id (ADMIN). */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<BeneficiaryIdParams>(req);
      const result = await this.beneficiaryService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/beneficiaries/:id/kyc — owner or admin submits KYC documents. */
  submitKyc: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<BeneficiaryIdParams>(req);
      const body = validatedBody<SubmitKycBody>(req);
      const updated = await this.beneficiaryService.submitKyc(id, body, req.session!);
      res.status(201).json(updated);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/beneficiaries/:id/kyc/review (ADMIN) — approve/reject. */
  reviewKyc: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<BeneficiaryIdParams>(req);
      const body = validatedBody<ReviewKycBody>(req);
      const updated = await this.beneficiaryService.reviewKyc(id, body, req.session!);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/beneficiaries/:id/notes — case-note timeline. */
  listNotes: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<BeneficiaryIdParams>(req);
      const notes = await this.beneficiaryService.listNotes(id);
      res.json(notes);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/beneficiaries/:id/notes — add a case note. */
  addNote: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<BeneficiaryIdParams>(req);
      const body = validatedBody<CreateNoteBody>(req);
      const row = await this.beneficiaryService.addNote(id, body, req.session!);
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  };
}
