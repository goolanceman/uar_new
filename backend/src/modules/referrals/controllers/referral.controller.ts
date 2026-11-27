/**
 * Referral controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  ListReferralsQuery,
  ReferralBody,
  ReferralIdParams,
} from "../schemas/referral.schema";
import type { ReferralService } from "../services/referral.service";

export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  /** GET /api/referrals — role-scoped list with beneficiaryId/status/priority filters. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListReferralsQuery>(req);
      const payload = await this.referralService.list(req.session!, query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/referrals {beneficiaryId, campId?, encounterId?, reason, priority, receivingOrgId?, speciality?} */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<ReferralBody>(req);
      const referral = await this.referralService.create(body, req.session!);
      res.status(201).json(referral);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/referrals/:id — detail with follow-ups. */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<ReferralIdParams>(req);
      const referral = await this.referralService.get(id, req.session!);
      res.json(referral);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/referrals/:id {status?, notes?} — workflow transitions. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<ReferralIdParams>(req);
      const body = validatedBody<ReferralBody>(req);
      const referral = await this.referralService.update(id, body, req.session!);
      res.json(referral);
    } catch (error) {
      next(error);
    }
  };
}
