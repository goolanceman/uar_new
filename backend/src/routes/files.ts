/**
 * Files routes — /api/files, /api/files/:id, /api/files/:id/file
 * Converted 1:1 from src/app/api/files/* (Next.js route handlers) to Express.
 * Multipart uploads use the `multipart` middleware + readForm (see @/lib/multipart).
 */
import { promises as fs, createReadStream } from "node:fs";
import { Router } from "express";
import { Prisma, type FileAsset } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireAuth, requireRole, validateSession, json, handleError, ApiError, logActivity } from "@/lib/session";
import { saveUpload, sanitizeFolder, deleteStored, validFolder, resolveStoredPath } from "@/lib/files";
import { multipart, readForm } from "@/lib/multipart";
import { getCachedFile, setCachedFile, invalidateFile, type CachedFileAsset } from "@/lib/cache";

export const router = Router();

const log = logger.child("files");

const MAX_FILES_PER_REQUEST = 20;
// Non-admin (self-service) uploads are capped lower than the admin limit.
const MAX_FILES_PER_REQUEST_NON_ADMIN = 10;

/**
 * Download access policy (gap A-5):
 * - Media mimes (image/*, audio/*, video/*) stay PUBLICLY readable — the
 *   public website renders uploaded images with plain <img> tags (campaigns,
 *   animals, testimonials) and guests must keep seeing them.
 * - Document mimes (pdf/doc/docx/csv/xlsx/txt/json/pptx) require a signed-in
 *   session: ADMINS and the UPLOADER (uploadedById) may download them; all
 *   other authenticated users and guests get 401/403. This is what keeps
 *   beneficiary KYC documents private while reviewers can open them.
 */
const PUBLIC_READ_MIME_PREFIXES = ["image/", "audio/", "video/"];

function isPublicReadMime(mime: string): boolean {
  return PUBLIC_READ_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

// GET /api/files?q=&folder=&mime=&page=&limit= (ADMIN) — newest-first, with
// global {count,totalBytes} stats on the unfiltered first page.
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const sp = new URL(req.url, "http://localhost").searchParams;
    const q = sp.get("q")?.trim() || undefined;
    const folder = sp.get("folder")?.trim() || undefined;
    const mime = sp.get("mime")?.trim() || undefined; // prefix match, e.g. "image"
    const page = Math.max(1, Math.trunc(Number(sp.get("page")) || 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(sp.get("limit")) || 24)));

    const where: Prisma.FileAssetWhereInput = {};
    if (q) where.OR = [{ name: { contains: q } }, { title: { contains: q } }];
    if (folder) where.folder = folder;
    if (mime) where.mime = { startsWith: mime };

    const [items, total] = await Promise.all([
      db.fileAsset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.fileAsset.count({ where }),
    ]);

    let stats: { count: number; totalBytes: number } | undefined;
    if (page === 1 && !q && !folder && !mime) {
      const [count, agg] = await Promise.all([
        db.fileAsset.count(),
        db.fileAsset.aggregate({ _sum: { size: true } }),
      ]);
      stats = { count, totalBytes: agg._sum.size ?? 0 };
    }

    return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)), stats });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/files — multipart/form-data with one or more `file` fields.
// Policy (gap A-5): any AUTHENTICATED user may upload. Non-admins are capped
// at 10 files/request and their `folder` field is IGNORED and overridden to
// `kyc/<userId>` — a logical namespace the file manager filters on. Forcing
// the folder server-side prevents non-admins from planting files into admin
// folders (path abuse). Admins keep full folder control + the 20-file cap.
// Exception: every authenticated user may target the shared `community`
// folder — the community/media upload used by the web + mobile clients.
// The response also carries `urls` — absolute public URLs (one per file), the
// shape the generic community clients consume directly.
router.post("/", multipart, async (req, res) => {
  try {
    const session = await requireAuth(req);
    const form = readForm(req);
    const isAdmin = session.role === "ADMIN";
    const maxFiles = isAdmin ? MAX_FILES_PER_REQUEST : MAX_FILES_PER_REQUEST_NON_ADMIN;

    // upload.any() collects every file part regardless of field name, which
    // also tolerates clients that used a different field name for the parts.
    let files = form.files;
    if (files.length === 0) throw new ApiError("No file provided", 400);
    if (files.length > maxFiles) {
      throw new ApiError(`Too many files — max ${maxFiles} per request`, 400);
    }

    // Admins pick any (sanitized) folder; everyone else is pinned to their
    // own kyc/<userId> namespace regardless of what the client sent — unless
    // they explicitly asked for the shared `community` media folder.
    const folderField = form.fields.folder;
    const requested = typeof folderField === "string" ? sanitizeFolder(folderField) : "general";
    const folder = isAdmin
      ? requested
      : requested === "community"
        ? "community"
        : `kyc/${session.userId}`; // userId is a server-generated cuid — safe

    const uploaded: FileAsset[] = [];
    for (const file of files) {
      uploaded.push(
        await saveUpload(file, {
          folder,
          uploadedBy: { id: session.userId, name: session.name },
        })
      );
    }

    log.info("files_uploaded", {
      count: uploaded.length,
      folder,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "FILE_UPLOAD",
      "FileAsset",
      `${uploaded.length} file(s) → ${folder}`,
      session.userId
    );

    // Absolute public URLs (same shape the profile/community uploads return).
    const host = req.get("host") ?? "localhost";
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol ?? "http";
    const urls = uploaded.map((a) => `${proto}://${host}/api/files/${a.id}/file`);

    return json(res, { files: uploaded, urls }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/files/:id (ADMIN) — single record.
router.get("/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");
    const { id } = req.params;

    const file = await db.fileAsset.findUnique({ where: { id } });
    if (!file) throw new ApiError("File not found", 404);
    return json(res, file);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/files/:id (ADMIN) — edit title, description and folder.
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.fileAsset.findUnique({ where: { id } });
    if (!existing) {
      log.warn("file_update_not_found", { fileId: id, actor: session.userId });
      throw new ApiError("File not found", 404);
    }

    const data: Record<string, unknown> = {};
    if (body?.title !== undefined) {
      data.title = body.title ? String(body.title).trim().slice(0, 200) : null;
    }
    if (body?.description !== undefined) {
      data.description = body.description ? String(body.description).trim() : null;
    }
    if (body?.folder !== undefined) {
      const folder = String(body.folder).trim();
      if (!validFolder(folder)) {
        throw new ApiError("Folder may only contain a-z, 0-9, dashes and underscores", 400);
      }
      data.folder = folder;
    }
    if (Object.keys(data).length === 0) throw new ApiError("Nothing to update", 400);

    const file = await db.fileAsset.update({ where: { id }, data });
    log.info("file_updated", {
      fileId: id,
      name: file.name,
      fields: Object.keys(data),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "FILE_UPDATE",
      "FileAsset",
      `${file.name} → ${Object.keys(data).join(", ")}`,
      session.userId
    );
    return json(res, file);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/files/:id (ADMIN) — remove the DB row and the on-disk bytes.
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;

    const existing = await db.fileAsset.findUnique({ where: { id } });
    if (!existing) {
      log.warn("file_delete_not_found", { fileId: id, actor: session.userId });
      throw new ApiError("File not found", 404);
    }

    await db.fileAsset.delete({ where: { id } });
    log.info("file_deleted", {
      fileId: id,
      name: existing.name,
      folder: existing.folder,
      actor: session.userId,
    });
    await invalidateFile(id);
    // A missing disk file must not fail the request (deleteStored ignores ENOENT).
    await deleteStored(existing.storedName).catch(() => {});

    await logActivity(
      session.name,
      "FILE_DELETE",
      "FileAsset",
      `${existing.name} (${existing.folder})`,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/files/:id/file — see the download-access policy above:
// image/*, audio/*, video/* are public; document mimes require ADMIN or the
// uploader. Serves the stored bytes with the recorded mime type and immutable
// caching, streamed from disk (never buffered whole) with HTTP Range support
// so legacy MP4 reels can seek; ?download=1 forces a download with the
// original filename.
router.get("/:id/file", async (req, res) => {
  try {
    const { id } = req.params;

    // Images and videos are immutable by id, so the row (mime, stored path,
    // owner) is cached. A miss — or Redis being down — falls through to
    // Postgres exactly as before.
    let asset: CachedFileAsset | null = await getCachedFile(id);
    if (!asset) {
      const row = await db.fileAsset.findUnique({
        where: { id },
        select: { id: true, name: true, storedName: true, mime: true, uploadedById: true },
      });
      if (!row) throw new ApiError("File not found", 404);
      asset = row;
      if (isPublicReadMime(row.mime)) await setCachedFile(row);
    }

    if (!isPublicReadMime(asset.mime)) {
      const session = await validateSession(req);
      if (!session) {
        log.warn("file_download_unauthenticated", { fileId: id, mime: asset.mime });
        throw new ApiError("Please sign in to access this document", 401);
      }
      if (session.role !== "ADMIN" && asset.uploadedById !== session.userId) {
        log.warn("file_download_forbidden", {
          fileId: id,
          mime: asset.mime,
          actor: session.userId,
        });
        throw new ApiError("You do not have permission to access this document", 403);
      }
    }

    const filePath = resolveStoredPath(asset.storedName);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      throw new ApiError("File content is missing", 404);
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
      return res.end();
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
        return res.end();
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
  } catch (e) {
    return handleError(e, res);
  }
});
