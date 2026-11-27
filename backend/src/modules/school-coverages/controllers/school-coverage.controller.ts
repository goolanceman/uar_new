/**
 * School coverage controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateSchoolCoverageBody,
  ListSchoolCoveragesQuery,
} from "../schemas/school-coverage.schema";
import type { SchoolCoverageService } from "../services/school-coverage.service";

export class SchoolCoverageController {
  constructor(private readonly schoolCoverageService: SchoolCoverageService) {}

  /** GET /api/school-coverages?q=&active=1 — active first, then by name. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListSchoolCoveragesQuery>(req);
      const rows = await this.schoolCoverageService.list(query);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/school-coverages — register/upsert (200 on update, 201 on create). */
  upsert: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<CreateSchoolCoverageBody>(req);
      const result = await this.schoolCoverageService.upsert(body, req.session!);
      res.status(result.isUpdate ? 200 : 201).json(result.row);
    } catch (error) {
      next(error);
    }
  };
}
