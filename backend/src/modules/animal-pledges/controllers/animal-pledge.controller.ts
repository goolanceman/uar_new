/**
 * Animal pledge controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to
 * the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import type { UpdateAnimalPledgeBody } from "../schemas/animal-pledge.schema";
import type { AnimalPledgeService } from "../services/animal-pledge.service";

export class AnimalPledgeController {
  constructor(private readonly animalPledgeService: AnimalPledgeService) {}

  /** PATCH /api/animal-pledges/:id */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateAnimalPledgeBody>(req) ?? {};
      const updated = await this.animalPledgeService.update(id, body, req.session!);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/animal-pledges/:id */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.animalPledgeService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
