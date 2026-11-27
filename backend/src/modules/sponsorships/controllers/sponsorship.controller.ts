/**
 * Sponsorship controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateSponsorshipBody,
  ListSponsorshipsQuery,
  SponsorshipIdParams,
  UpdateSponsorshipBody,
} from "../schemas/sponsorship.schema";
import type { SponsorshipService } from "../services/sponsorship.service";

export class SponsorshipController {
  constructor(private readonly sponsorshipService: SponsorshipService) {}

  /** GET /api/sponsorships?beneficiaryId=&donorId=&status=&mine=1 */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListSponsorshipsQuery>(req);
      const rows = await this.sponsorshipService.list(query, req.session!);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/sponsorships/match */
  match: RequestHandler = async (req, res, next) => {
    try {
      const payload = await this.sponsorshipService.match();
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/sponsorships */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateSponsorshipBody>(req) ?? {};
      const row = await this.sponsorshipService.create(body, req.session!);
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/sponsorships/:id */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<SponsorshipIdParams>(req);
      const body = validatedBody<UpdateSponsorshipBody>(req) ?? {};
      const row = await this.sponsorshipService.update(id, body, req.session!);
      res.json(row);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/sponsorships/:id */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<SponsorshipIdParams>(req);
      const result = await this.sponsorshipService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
