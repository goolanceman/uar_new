/**
 * Corridor event controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to
 * the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedQuery } from "@/shared/middleware/validate";
import type { ListCorridorEventsQuery } from "../schemas/corridor-event.schema";
import type { CorridorEventService } from "../services/corridor-event.service";

export class CorridorEventController {
  constructor(private readonly corridorEventService: CorridorEventService) {}

  /** GET /api/corridor-events?missionId=&limit= (auth) — desc createdAt. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filter = validatedQuery<ListCorridorEventsQuery>(req);
      const events = await this.corridorEventService.list(filter);
      res.json(events);
    } catch (error) {
      next(error);
    }
  };
}
