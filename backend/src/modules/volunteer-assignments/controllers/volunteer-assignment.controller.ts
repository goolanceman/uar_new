/**
 * Volunteer assignment controller — HTTP layer only. Extracts validated data
 * / session, delegates to the service, returns the response. Errors flow to
 * the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedQuery } from "@/shared/middleware/validate";
import type {
  CreateAssignmentBody,
  ListAssignmentsQuery,
} from "../schemas/volunteer-assignment.schema";
import type { VolunteerAssignmentService } from "../services/volunteer-assignment.service";

export class VolunteerAssignmentController {
  constructor(private readonly volunteerAssignmentService: VolunteerAssignmentService) {}

  /** GET /api/volunteer-assignments?refType=&refId= (ADMIN). */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListAssignmentsQuery>(req);
      const tasks = await this.volunteerAssignmentService.list(req.session!, query);
      res.json(tasks);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/volunteer-assignments (ADMIN) — 201 {tasks, skipped}. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateAssignmentBody>(req);
      const result = await this.volunteerAssignmentService.create(req.session!, body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };
}
