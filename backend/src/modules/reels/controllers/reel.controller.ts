/**
 * Reel controller — HTTP layer only. Extracts the session, multipart files,
 * CSV query params and pagination (the legacy lib pageParams helper is kept
 * verbatim), delegates to the service, returns the response. Errors flow to
 * the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "@/shared/errors";
import { saveUpload } from "@/lib/files";
import { pageParams } from "@/lib/community/serializers";
import type { ReelService } from "../services/reel.service";

/** Uploaded file for a multipart field (multer any() ran upstream), or null. */
function fieldFile(req: Request, fieldname: string): File | null {
  const files = (req.files as Array<{ fieldname: string; buffer: Buffer; originalname: string; mimetype: string }> | undefined) ?? [];
  const f = files.find((x) => x.fieldname === fieldname);
  if (!f) return null;
  return new File([f.buffer], f.originalname, { type: f.mimetype || "application/octet-stream" });
}

/** Store an upload and return its absolute public URL. */
async function saveFieldFile(req: Request, fieldname: string, uploaderId: string, uploaderName: string): Promise<string> {
  const file = fieldFile(req, fieldname);
  if (!file) throw new ApiError(`The ${fieldname} field is required`, 400);
  const asset = await saveUpload(file, { folder: "reels", uploadedBy: { id: uploaderId, name: uploaderName } });
  const host = req.get("host") ?? "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol ?? "http";
  return `${proto}://${host}/api/files/${asset.id}/file`;
}

/** CSV query param → trimmed non-empty list. */
function csvParam(raw: unknown): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export class ReelController {
  constructor(private readonly reelService: ReelService) {}

  /** GET /api/reels?feed=foryou|following — explore (legacy fetchReelsOnExplore). */
  listFeed: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const feedParam = String(req.query.feed ?? "foryou").toLowerCase();
      const { page, limit, skip } = pageParams(req.query);
      const payload = await this.reelService.listFeed(req.session!, feedParam, page, limit, skip);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/reels — multipart (content/thumbnail) or direct-upload mediaId. */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = req.session!;
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const reel = await this.reelService.create(session, {
        content: fieldFile(req, "content"),
        thumbnail: fieldFile(req, "thumbnail"),
        rawBody,
        saveField: (fieldname: string) => saveFieldFile(req, fieldname, session.userId, session.name),
      });
      res.status(201).json(reel); // POST /api/posts parity
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/reels/saved — the session user's saved reels (legacy fetchSavedReels). */
  saved: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit, skip } = pageParams(req.query);
      const payload = await this.reelService.listSaved(req.session!, page, limit, skip);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/reels/by-interest?ids=1,2&q= (legacy searchReelsByInterestId). */
  byInterest: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ids = csvParam(req.query.ids);
      const q = String(req.query.q ?? "");
      const { page, limit, skip } = pageParams(req.query);
      const payload = await this.reelService.searchByInterest(req.session!, ids, q, page, limit, skip);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/reels/by-hashtag?tags=a,b (legacy fetchReelsByHashtag). */
  byHashtag: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tags = csvParam(req.query.tags);
      const { page, limit, skip } = pageParams(req.query);
      const payload = await this.reelService.listByHashtag(req.session!, tags, page, limit, skip);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/reels/by-music/:musicId (legacy fetchReelsByMusic). */
  byMusic: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit, skip } = pageParams(req.query);
      const payload = await this.reelService.listByMusic(req.session!, (req.params as Record<string, string>).musicId, page, limit, skip);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/reels/user/:userId — a profile's reels (legacy fetchReelsByUserId). */
  byUser: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit, skip } = pageParams(req.query);
      const payload = await this.reelService.listByUser(req.session!, (req.params as Record<string, string>).userId, page, limit, skip);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/reels/comments/:commentId — comment author, reel owner OR moderator. */
  deleteComment: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.reelService.deleteComment(req.session!, (req.params as Record<string, string>).commentId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/reels/:id — single reel (legacy fetchReelById). */
  get: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reel = await this.reelService.get(req.session!, (req.params as Record<string, string>).id);
      res.json(reel);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/reels/:id — owner OR moderator (legacy deleteReel). */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.reelService.remove(req.session!, (req.params as Record<string, string>).id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/reels/:id — edit metadata (description/hashtags/interests/thumbnail/content/music). */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const result = await this.reelService.update(req.session!, (req.params as Record<string, string>).id, rawBody);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/reels/:id/like — toggle (legacy likeDislikeReel). */
  like: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reel = await this.reelService.like(req.session!, (req.params as Record<string, string>).id);
      res.json(reel);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/reels/:id/view (legacy increaseReelViewCount). */
  view: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.reelService.view((req.params as Record<string, string>).id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/reels/:id/report { reason, desc } (legacy reportReel). */
  report: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const result = await this.reelService.report(req.session!, (req.params as Record<string, string>).id, rawBody);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/reels/:id/comments (legacy fetchReelComments). */
  comments: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit, skip } = pageParams(req.query);
      const payload = await this.reelService.listComments(req.session!, (req.params as Record<string, string>).id, page, limit, skip);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/reels/:id/comments { description } (legacy addReelComment). */
  addComment: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const comment = await this.reelService.addComment(req.session!, (req.params as Record<string, string>).id, rawBody);
      res.json(comment);
    } catch (error) {
      next(error);
    }
  };
}
