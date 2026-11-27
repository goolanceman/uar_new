/**
 * File service — upload policy, file-manager rules and the download access
 * policy (gap A-5). Depends on the repository contract, throws application
 * errors, never touches HTTP. The on-disk bytes are handled by the shared
 * helpers in @/lib/files exactly like the legacy routes did.
 *
 * Download access policy (gap A-5):
 * - Media mimes (image/*, audio/*, video/*) stay PUBLICLY readable — the
 *   public website renders uploaded images with plain <img> tags (campaigns,
 *   animals, testimonials) and guests must keep seeing them.
 * - Document mimes (pdf/doc/docx/csv/xlsx/txt/json/pptx) require a signed-in
 *   session: ADMINS and the UPLOADER (uploadedById) may download them; all
 *   other authenticated users and guests get 401/403. This is what keeps
 *   beneficiary KYC documents private while reviewers can open them.
 */
import { logger } from "@/lib/logger";
import { logActivity, type Session } from "@/lib/session";
import { saveUpload, sanitizeFolder, validFolder, deleteStored } from "@/lib/files";
import { getCachedFile, setCachedFile, invalidateFile, type CachedFileAsset } from "@/lib/cache";
import { ApiError, NotFoundError } from "@/shared/errors";
import type { FileRepository, FileStats, FileDownloadRow } from "../repositories/file.repository.interface";
import type { ListFilesQuery } from "../schemas/file.schema";

const log = logger.child("files");

const MAX_FILES_PER_REQUEST = 20;
// Non-admin (self-service) uploads are capped lower than the admin limit.
const MAX_FILES_PER_REQUEST_NON_ADMIN = 10;

const PUBLIC_READ_MIME_PREFIXES = ["image/", "audio/", "video/"];

function isPublicReadMime(mime: string): boolean {
  return PUBLIC_READ_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

/** Multipart form as parsed by the controller via readForm(req). */
export interface UploadForm {
  files: File[];
  fields: Record<string, string>;
}

export interface UploadResult {
  files: Awaited<ReturnType<typeof saveUpload>>[];
  folder: string;
}

export interface FileListPayload {
  items: unknown[];
  total: number;
  page: number;
  pages: number;
  stats?: FileStats;
}

export class FileService {
  constructor(private readonly fileRepository: FileRepository) {}

  /**
   * GET /api/files?q=&folder=&mime=&page=&limit= (ADMIN) — newest-first, with
   * global {count,totalBytes} stats on the unfiltered first page.
   */
  async list(query: ListFilesQuery): Promise<FileListPayload> {
    const { page, limit } = query;
    const { items, total } = await this.fileRepository.list(
      { q: query.q, folder: query.folder, mime: query.mime },
      (page - 1) * limit,
      limit
    );

    let stats: FileStats | undefined;
    if (page === 1 && !query.q && !query.folder && !query.mime) {
      stats = await this.fileRepository.stats();
    }

    return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)), stats };
  }

  /**
   * POST /api/files — multipart/form-data with one or more `file` fields.
   * Policy (gap A-5): any AUTHENTICATED user may upload. Non-admins are capped
   * at 10 files/request and their `folder` field is IGNORED and overridden to
   * `kyc/<userId>` — a logical namespace the file manager filters on. Forcing
   * the folder server-side prevents non-admins from planting files into admin
   * folders (path abuse). Admins keep full folder control + the 20-file cap.
   * Exception: every authenticated user may target the shared `community`
   * folder — the community/media upload used by the web + mobile clients.
   */
  async upload(form: UploadForm, session: Session): Promise<UploadResult> {
    const isAdmin = session.role === "ADMIN";
    const maxFiles = isAdmin ? MAX_FILES_PER_REQUEST : MAX_FILES_PER_REQUEST_NON_ADMIN;

    // upload.any() collects every file part regardless of field name, which
    // also tolerates clients that used a different field name for the parts.
    const files = form.files;
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

    const uploaded: UploadResult["files"] = [];
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

    return { files: uploaded, folder };
  }

  /** GET /api/files/:id (ADMIN) — single record. */
  async get(id: string): Promise<unknown> {
    const file = await this.fileRepository.findById(id);
    if (!file) throw new NotFoundError("File not found");
    return file;
  }

  /** PATCH /api/files/:id (ADMIN) — edit title, description and folder. */
  async update(
    id: string,
    body: Record<string, unknown>,
    session: Session
  ): Promise<unknown> {
    const existing = await this.fileRepository.findById(id);
    if (!existing) {
      log.warn("file_update_not_found", { fileId: id, actor: session.userId });
      throw new NotFoundError("File not found");
    }

    const data: { title?: string | null; description?: string | null; folder?: string } = {};
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

    const file = await this.fileRepository.update(id, data);
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
    return file;
  }

  /**
   * DELETE /api/files/:id (ADMIN) — remove the DB row and the on-disk bytes.
   * The exact legacy side-effect order: row delete → log → cache invalidate →
   * disk delete (a missing disk file must not fail the request).
   */
  async remove(id: string, session: Session): Promise<{ ok: boolean }> {
    const existing = await this.fileRepository.findById(id);
    if (!existing) {
      log.warn("file_delete_not_found", { fileId: id, actor: session.userId });
      throw new NotFoundError("File not found");
    }

    await this.fileRepository.delete(id);
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
    return { ok: true };
  }

  /**
   * GET /api/files/:id/file — resolve the asset row for a download. Images and
   * videos are immutable by id, so the row (mime, stored path, owner) is
   * cached. A miss — or Redis being down — falls through to Postgres exactly
   * as before.
   */
  async locateForDownload(id: string): Promise<CachedFileAsset> {
    let asset: CachedFileAsset | null = await getCachedFile(id);
    if (!asset) {
      const row: FileDownloadRow | null = await this.fileRepository.findForDownload(id);
      if (!row) throw new NotFoundError("File not found");
      asset = row;
      if (isPublicReadMime(row.mime)) await setCachedFile(row);
    }
    return asset;
  }

  /**
   * Download access check (branch-dependent session gate resolved by the
   * controller via validateSession): image/*, audio/*, video/* are public;
   * document mimes require ADMIN or the uploader.
   */
  assertDownloadAccess(mime: string, uploadedById: string | null, session: Session | null, fileId: string): void {
    if (isPublicReadMime(mime)) return;
    if (!session) {
      log.warn("file_download_unauthenticated", { fileId, mime });
      throw new ApiError("Please sign in to access this document", 401);
    }
    if (session.role !== "ADMIN" && uploadedById !== session.userId) {
      log.warn("file_download_forbidden", {
        fileId,
        mime,
        actor: session.userId,
      });
      throw new ApiError("You do not have permission to access this document", 403);
    }
  }
}

