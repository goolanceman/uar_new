/**
 * Music controller — HTTP layer only. Extracts validated data / session,
 * delegates to the service, returns the response. Errors flow to the
 * centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedQuery } from "@/shared/middleware/validate";
import type {
  ListMusicCategoriesQuery,
  ListMusicQuery,
  ListSavedMusicQuery,
} from "../schemas/music.schema";
import type { MusicService } from "../services/music.service";

export class MusicController {
  constructor(private readonly musicService: MusicService) {}

  /** GET /api/music?q=&categoryId=&page=&limit= — public browse/search. */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { q, categoryId, page, limit } = validatedQuery<ListMusicQuery>(req);
      const payload = await this.musicService.list(q, categoryId, page, limit, (page - 1) * limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/music/categories — categories with musics counts. */
  categories: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit } = validatedQuery<ListMusicCategoriesQuery>(req);
      const payload = await this.musicService.categories(page, limit, (page - 1) * limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/music/saved — the session user's saved musics. */
  saved: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit } = validatedQuery<ListSavedMusicQuery>(req);
      const payload = await this.musicService.saved(req.session!.userId, page, limit, (page - 1) * limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };
}
