/**
 * Files routes — /api/files, /api/files/:id, /api/files/:id/file
 * Converted 1:1 from src/app/api/files/* (Next.js route handlers) to Express.
 * Multipart uploads use the `multipart` middleware + readForm (see @/lib/multipart).
 */
import { promises as fs } from "node:fs";
import { Router } from "express";
import { Prisma, type FileAsset } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth, requireRole, validateSession, json, handleError, ApiError, logActivity } from "@/lib/session";
import { saveUpload, sanitizeFolder, deleteStored, validFolder, resolveStoredPath } from "@/lib/files";
import { multipart, readForm } from "@/lib/multipart";

export const router = Router();

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
    // own kyc/<userId> namespace regardless of what the client sent.
    const folderField = form.fields.folder;
    const folder = isAdmin
      ? typeof folderField === "string"
        ? sanitizeFolder(folderField)
        : "general"
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

    await logActivity(
      session.name,
      "FILE_UPLOAD",
      "FileAsset",
      `${uploaded.length} file(s) → ${folder}`,
      session.userId
    );
    return json(res, { files: uploaded }, 201);
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
    if (!existing) throw new ApiError("File not found", 404);

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
    if (!existing) throw new ApiError("File not found", 404);

    await db.fileAsset.delete({ where: { id } });
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
// caching; ?download=1 forces a download with the original filename.
router.get("/:id/file", async (req, res) => {
  try {
    const { id } = req.params;

    const asset = await db.fileAsset.findUnique({ where: { id } });
    if (!asset) throw new ApiError("File not found", 404);

    if (!isPublicReadMime(asset.mime)) {
      const session = await validateSession(req);
      if (!session)
        throw new ApiError("Please sign in to access this document", 401);
      if (session.role !== "ADMIN" && asset.uploadedById !== session.userId)
        throw new ApiError("You do not have permission to access this document", 403);
    }

    let bytes: Buffer;
    try {
      bytes = await fs.readFile(resolveStoredPath(asset.storedName));
    } catch {
      throw new ApiError("File content is missing", 404);
    }

    res.status(200).setHeader("Content-Type", asset.mime);
    res.setHeader("Content-Length", String(bytes.byteLength));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (new URL(req.url, "http://localhost").searchParams.get("download")) {
      const safeName = asset.name.replace(/["\\\r\n]/g, "");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    }

    return res.send(bytes);
  } catch (e) {
    return handleError(e, res);
  }
});
