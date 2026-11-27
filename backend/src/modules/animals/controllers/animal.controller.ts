/**
 * Animal controller — HTTP layer only. Extracts validated data / session /
 * URL search params, delegates to the service, returns the response. Errors
 * flow to the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import { validateSession } from "@/lib/session";
import type { AnimalBody, AnimalIdParams } from "../schemas/animal.schema";
import type { AnimalService } from "../services/animal.service";

export class AnimalController {
  constructor(private readonly animalService: AnimalService) {}

  /** GET /api/animals?species=&status=&q= (public) — includes each animal's pledges. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;
      const animals = await this.animalService.list({
        species: sp.get("species") || undefined,
        status: sp.get("status") || undefined,
        q: sp.get("q")?.trim() || undefined,
      });
      res.json(animals);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/animals (ADMIN | VOLUNTEER) */
  create: RequestHandler = async (req, res, next) => {
    try {
      const body = validatedBody<AnimalBody>(req) ?? {};
      const animal = await this.animalService.create(body, req.session!);
      res.status(201).json(animal);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/animals/pledges — public (guests) OR authenticated donors. */
  createPledge: RequestHandler = async (req, res, next) => {
    try {
      // Optional session (legacy-first-step validateSession): guests may give.
      const session = await validateSession(req);
      const body = validatedBody<AnimalBody>(req) ?? {};
      const result = await this.animalService.createPledge(body, session);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/animals/pledges?mine=1&animalId= (auth) */
  listPledges: RequestHandler = async (req, res, next) => {
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;
      const pledges = await this.animalService.listPledges(req.session!, {
        mine: Boolean(sp.get("mine")),
        animalId: sp.get("animalId"),
      });
      res.json(pledges);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/animals/reactions?animalId= — recent blessings + emoji counts. */
  listReactions: RequestHandler = async (req, res, next) => {
    try {
      const sp = new URL(req.url, "http://localhost").searchParams;
      const animalId = sp.get("animalId");
      const limit = Math.min(100, Number(sp.get("limit")) || 50);
      const result = await this.animalService.listReactions(animalId, limit);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/animals/reactions — public (guests) OR authenticated users. */
  createReaction: RequestHandler = async (req, res, next) => {
    try {
      // Optional session (legacy-first-step validateSession): guests may react.
      const session = await validateSession(req);
      const body = validatedBody<AnimalBody>(req) ?? {};
      const result = await this.animalService.createReaction(body, session);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/animals/:id (ADMIN | VOLUNTEER) — animal + pledges */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AnimalIdParams>(req);
      const animal = await this.animalService.get(id);
      res.json(animal);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/animals/:id (ADMIN | VOLUNTEER) */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AnimalIdParams>(req);
      const body = validatedBody<AnimalBody>(req) ?? {};
      const animal = await this.animalService.update(id, body, req.session!);
      res.json(animal);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/animals/:id (ADMIN) */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<AnimalIdParams>(req);
      const result = await this.animalService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
