/**
 * File controller — HTTP layer only. Extracts validated data / session /
 * multipart form, delegates to the service, returns the response. The download
 * endpoint streams the stored bytes from disk (never buffered whole) with the
 * recorded mime type, immutable caching and HTTP Range support exactly like
 * the legacy handler. Errors flow to the centralized error middleware via
 * next(error).
 */
import { promises as fs, createReadStream } from "node:fs";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams, validatedQuery } from "@/shared/middleware/validate";
import { validateSession } from "@/infrastructure/auth/session";
import { readForm } from "@/infrastructure/uploads/multipart";
import { resolveStoredPath } from "@/domains/files";
import { NotFoundError } from "@/shared/errors";
import type { ListFilesQuery, FileBody, FileIdParams } from "../schemas/file.schema";
import type { FileService } from "../services/file.service";

export class FileController {
  constructor(private readonly fileService: FileService) {}

  /** GET /api/files?q=&folder=&mime=&page=&limit= (ADMIN). */
  list: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = validatedQuery<ListFilesQuery>(req);
      const payload = await this.fileService.list(query);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/files — multipart/form-data with one or more `file` fields.
   *  The response also carries `urls` — absolute public URLs (one per file),
   *  the shape the generic community clients consume directly. */
  upload: RequestHandler = async (req, res, next) => {
    try {
      const form = readForm(req);
      const { files: uploaded } = await this.fileService.upload(form, req.session!);

      // Absolute public URLs (same shape the profile/community uploads return).
      const host = req.get("host") ?? "localhost";
      const proto =
        (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol ?? "http";
      const urls = uploaded.map((a) => `${proto}://${host}/api/files/${a.id}/file`);

      res.status(201).json({ files: uploaded, urls });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/files/:id (ADMIN) — single record. */
  get: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<FileIdParams>(req);
      const file = await this.fileService.get(id);
      res.json(file);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/files/:id (ADMIN) — edit title, description and folder. */
  update: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<FileIdParams>(req);
      const body = validatedBody<FileBody>(req);
      const file = await this.fileService.update(id, body, req.session!);
      res.json(file);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/files/:id (ADMIN) — remove the DB row and the on-disk bytes. */
  remove: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<FileIdParams>(req);
      const result = await this.fileService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/files/:id/file — see the download-access policy in the service:
   *  image/*, audio/*, video/* are public; document mimes require ADMIN or the
   *  uploader. ?download=1 forces a download with the original filename. */
  download: RequestHandler = async (req, res, next) => {
    try {
      const { id } = validatedParams<FileIdParams>(req);
      const asset = await this.fileService.locateForDownload(id);

      // Branch-dependent session gate (legacy mid-handler validateSession).
      const session = await validateSession(req);
      this.fileService.assertDownloadAccess(asset.mime, asset.uploadedById, session, id);

      const filePath = resolveStoredPath(asset.storedName);
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        throw new NotFoundError("File content is missing");
      }

      res.status(200).setHeader("Content-Type", asset.mime);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (new URL(req.url, "http://localhost").searchParams.get("download")) {
        const safeName = asset.name.replace(/["\\\r\n]/g, "");
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      }

      const range = String(req.headers.range ?? "");
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (range && !match) {
        res.status(416).setHeader("Content-Range", `bytes */${stat.size}`);
        return void res.end();
      }

      if (match && (match[1] !== "" || match[2] !== "")) {
        let start: number;
        let end: number;
        if (match[1] === "") {
          // suffix range: bytes=-N → the last N bytes
          start = Math.max(0, stat.size - Number(match[2]));
          end = stat.size - 1;
        } else {
          start = Number(match[1]);
          end = match[2] === "" ? stat.size - 1 : Number(match[2]);
        }
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
          res.status(416).setHeader("Content-Range", `bytes */${stat.size}`);
          return void res.end();
        }
        end = Math.min(end, stat.size - 1);
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        res.setHeader("Content-Length", String(end - start + 1));
        const stream = createReadStream(filePath, { start, end });
        stream.on("error", () => res.end());
        return stream.pipe(res);
      }

      res.status(200);
      res.setHeader("Content-Length", String(stat.size));
      const stream = createReadStream(filePath);
      stream.on("error", () => res.end());
      return stream.pipe(res);
    } catch (error) {
      next(error);
    }
  };
}
