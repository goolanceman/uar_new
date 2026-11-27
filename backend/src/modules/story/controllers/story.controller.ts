/**
 * Story controller — HTTP layer only. Extracts validated data / session /
 * uploaded files, delegates to the service, returns the response. Errors flow
 * to the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedQuery } from "@/shared/middleware/validate";
import type { MulterFile } from "@/lib/multipart";
import type { ListStoriesQuery } from "../schemas/story.schema";
import type { StoryRequest } from "../repositories/story.repository.interface";
import type { StoryService } from "../services/story.service";

/** The first uploaded part matching [base] (base, base[], base[0]). */
function fieldFile(req: Request, base: string): File | null {
  const all = ((req as Request & { files?: unknown }).files ?? []) as Array<MulterFile & { fieldname?: string }>;
  const f = all.find(
    (x) => x.fieldname === base || x.fieldname === `${base}[]` || (x.fieldname ?? "").startsWith(`${base}[`)
  );
  return f ? new File([f.buffer], f.originalname, { type: f.mimetype || "application/octet-stream" }) : null;
}

export class StoryController {
  constructor(private readonly storyService: StoryService) {}

  /** GET /api/stories — followed users' last-24h stories (legacy fetchStory). */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit } = validatedQuery<ListStoriesQuery>(req);
      const payload = await this.storyService.list(req.session!, page, limit, (page - 1) * limit);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/stories — multipart content + optional thumbnail (legacy createStory). */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const b = validatedBody<{ type: number; duration: number; content: string | null }>(req);
      const story = await this.storyService.create(req as StoryRequest, req.session!, b, {
        content: fieldFile(req, "content"),
        thumbnail: fieldFile(req, "thumbnail"),
      });
      res.status(201).json(story);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/stories/:id/view — mark viewed (legacy viewStory). */
  view: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const story = await this.storyService.view(req.session!, String((req.params as Record<string, string>).id ?? ""));
      res.json(story);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/stories/:id (legacy fetchStoryByID). */
  get: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const story = await this.storyService.get(String((req.params as Record<string, string>).id ?? ""));
      res.json(story);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/stories/:id — owner OR moderator (deleteStory + deleteStoryByModerator). */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const story = await this.storyService.remove(req.session!, String((req.params as Record<string, string>).id ?? ""));
      res.json({ ok: true, story });
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/stories/:id — edit metadata (type/duration/content/thumbnail). */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const patch = validatedBody<{ type?: number; duration?: number; content?: string; thumbnail?: string }>(req);
      const story = await this.storyService.update(
        req.session!,
        String((req.params as Record<string, string>).id ?? ""),
        patch
      );
      res.json({ ok: true, story });
    } catch (error) {
      next(error);
    }
  };
}
