/**
 * Mission controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import type { MissionService } from "../services/mission.service";
import type {
  CreateMissionBody,
  ListMissionsQuery,
  MissionIdParams,
  UpdateMissionBody,
} from "../schemas/mission.schema";

export class MissionController {
  constructor(private readonly missionService: MissionService) {}

  /** GET /api/missions?status=&q=&ambulanceId=&limit= (auth) — newest first. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListMissionsQuery>(req);
      const missions = await this.missionService.list(query);
      res.json(missions);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/missions (ADMIN | VOLUNTEER) — generates a 4-segment simulated route. */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<CreateMissionBody>(req);
      const mission = await this.missionService.create(body, req.session!);
      res.status(201).json(mission);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/missions/:id (ADMIN | VOLUNTEER) — status stepper or action flow. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<MissionIdParams>(req);
      const body = validatedBody<UpdateMissionBody>(req);
      const result = await this.missionService.update(id, body, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
