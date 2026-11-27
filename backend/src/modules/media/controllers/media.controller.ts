/**
 * Media controller — HTTP layer only. Owns the byte streaming (raw upload
 * receiver, HTTP-Range playback serving) and delegates every business check
 * to the service. Errors flow to the centralized error middleware via
 * next(error) — after the raw request body is drained.
 */
import { promises as fs, createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "@/shared/errors";
import { UPLOAD_DIR } from "@/lib/files";
import type { MediaService } from "../services/media.service";

// Content types for the public playback files (kept here — local serving only).
const MIME_BY_EXTENSION: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/** Long-immutable outputs; playlists change when the ladder changes. */
function cacheControlFor(key: string): string {
  return key.endsWith(".m3u8") ? "public, max-age=60" : "public, max-age=31536000, immutable";
}

export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /** POST /api/media/uploads — presign a direct video upload. */
  presign: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const payload = await this.mediaService.presignUpload(req.session!, rawBody);
      res.status(201).json(payload);
    } catch (error) {
      next(error);
    }
  };

  /**
   * PUT /api/media/upload/:token — local-driver receiver. The body is the raw
   * file bytes — streamed straight to disk, never buffered in memory and
   * never touched by express.json (video/mp4 does not match the JSON parser).
   */
  receive: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const claims = await this.mediaService.verifyReceiver(
        String((req.params as Record<string, string>).token ?? "")
      );

      // Content-Type must equal the presigned one (mime portion, params ignored).
      const got = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (got !== claims.contentType.toLowerCase())
        throw new ApiError("Content-Type does not match the presigned upload", 400);

      const declared = Number(claims.contentLength);
      const key = claims.key;
      const target = path.join(UPLOAD_DIR, "media-store", key);
      if (!path.resolve(target).startsWith(path.join(UPLOAD_DIR, "media-store") + path.sep)) {
        throw new ApiError("Invalid storage key", 400);
      }

      await fs.mkdir(path.dirname(target), { recursive: true });
      const tmpPath = path.join(UPLOAD_DIR, "media-store", `tmp-${randomUUID()}.part`);

      // Stream the request body to a temp file (counting bytes), then
      // atomically rename into place — the body never passes through a body parser.
      let received = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          received += chunk.length;
          if (received > declared) {
            cb(new ApiError("Upload exceeds the presigned size", 413));
            return;
          }
          cb(null, chunk);
        },
      });

      try {
        await pipeline(req, counter, createWriteStream(tmpPath));
      } catch (e) {
        await fs.unlink(tmpPath).catch(() => {});
        throw e;
      }

      if (received !== declared) {
        await fs.unlink(tmpPath).catch(() => {});
        throw new ApiError("Uploaded size does not match the presigned content length", 400);
      }

      await fs.rename(tmpPath, target);
      await this.mediaService.markReceived(claims.mediaId, received);
      res.json({ ok: true });
    } catch (e) {
      // Drain (or discard) the request body before erroring — answering without
      // consuming it can reset the client socket before it reads the response.
      req.resume();
      next(e);
    }
  };

  /** POST /api/media/:id/complete — owner confirms the bytes landed. */
  complete: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.mediaService.complete(req.session!, (req.params as Record<string, string>).id);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/media/:id — owner-only polling endpoint (upload + transcode progress). */
  poll: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.mediaService.poll(req.session!, (req.params as Record<string, string>).id);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/media/files/* — public playback serving (local driver only).
   * Outputs of READY assets with HTTP Range support so players can seek.
   */
  serve: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const wildcard = (req.params as Record<string, string | string[]>)[0];
      const key = decodeURIComponent(Array.isArray(wildcard) ? wildcard.join("/") : String(wildcard ?? ""));
      const { filePath, size: statSize } = await this.mediaService.resolvePlayback(key);

      const ext = path.extname(key).toLowerCase();
      const mime = MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
      res.setHeader("Content-Type", mime);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", cacheControlFor(key));
      res.setHeader("X-Content-Type-Options", "nosniff");

      const range = String(req.headers.range ?? "");
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (range && !match) {
        res.status(416).setHeader("Content-Range", `bytes */${statSize}`);
        res.end();
        return;
      }

      if (match && (match[1] !== "" || match[2] !== "")) {
        let start: number;
        let end: number;
        if (match[1] === "") {
          // suffix range: bytes=-N → the last N bytes
          start = Math.max(0, statSize - Number(match[2]));
          end = statSize - 1;
        } else {
          start = Number(match[1]);
          end = match[2] === "" ? statSize - 1 : Number(match[2]);
        }
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= statSize) {
          res.status(416).setHeader("Content-Range", `bytes */${statSize}`);
          res.end();
          return;
        }
        end = Math.min(end, statSize - 1);
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${statSize}`);
        res.setHeader("Content-Length", String(end - start + 1));
        const stream = createReadStream(filePath, { start, end });
        stream.on("error", () => res.end());
        stream.pipe(res);
        return;
      }

      res.status(200);
      res.setHeader("Content-Length", String(statSize));
      const stream = createReadStream(filePath);
      stream.on("error", () => res.end());
      stream.pipe(res);
    } catch (e) {
      next(e);
    }
  };
}
