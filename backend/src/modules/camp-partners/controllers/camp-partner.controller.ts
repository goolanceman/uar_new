/**
 * Camp partner controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateCampPartnerBody,
  ListCampPartnersQuery,
  UpdateCampPartnerBody,
} from "../schemas/camp-partner.schema";
import type { CampPartnerService } from "../services/camp-partner.service";

export class CampPartnerController {
  constructor(private readonly campPartnerService: CampPartnerService) {}

  /** GET /api/camp-partners?campId&status — ADMIN all; HOSPITAL its own invitations. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListCampPartnersQuery>(req);
      const payload = await this.campPartnerService.list(query, req.session!);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/camp-partners (ADMIN) — {campId, orgId, role} — 201. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateCampPartnerBody>(req);
      const partner = await this.campPartnerService.invite(req.session!, body);
      res.status(201).json(partner);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/camp-partners/:id — ADMIN, or the HOSPITAL owning the invited org. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateCampPartnerBody>(req);
      const updated = await this.campPartnerService.respond(id, req.session!, body);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  };
}
