/**
 * Files routes — /api/files, /api/files/:id, /api/files/:id/file
 * Thin endpoint definitions; all logic lives in src/modules/files
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/files`) is preserved: tests and the app entry import
 * `router` from here.
 *
 * Multipart uploads use the `multipart` middleware + readForm (see @/lib/multipart).
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { multipart } from "@/lib/multipart";
import {
  fileBodySchema,
  fileIdParamSchema,
  listFilesQuerySchema,
} from "@/modules/files/schemas/file.schema";
import { fileController } from "@/modules/files";

export const router = Router();

// GET /api/files?q=&folder=&mime=&page=&limit= (ADMIN) — newest-first, with
// global {count,totalBytes} stats on the unfiltered first page.
router.get("/", authorize("ADMIN"), validate({ query: listFilesQuerySchema }), fileController.list);

// POST /api/files — multipart/form-data with one or more `file` fields.
// Policy (gap A-5): any AUTHENTICATED user may upload; non-admins are capped
// at 10 files/request and pinned to kyc/<userId> (or the shared community
// folder). (multer runs first, then the auth gate — legacy order.)
router.post("/", multipart, authenticate, fileController.upload);

// GET /api/files/:id (ADMIN) — single record.
router.get("/:id", authorize("ADMIN"), validate({ params: fileIdParamSchema }), fileController.get);

// PATCH /api/files/:id (ADMIN) — edit title, description and folder.
// (Field checks run in the service after the 404 lookup — legacy order.)
router.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: fileIdParamSchema, body: fileBodySchema }),
  fileController.update
);

// DELETE /api/files/:id (ADMIN) — remove the DB row and the on-disk bytes.
router.delete("/:id", authorize("ADMIN"), validate({ params: fileIdParamSchema }), fileController.remove);

// GET /api/files/:id/file — see the download-access policy in the service:
// image/*, audio/*, video/* are public; document mimes require ADMIN or the
// uploader. Serves the stored bytes with the recorded mime type and immutable
// caching, streamed from disk (never buffered whole) with HTTP Range support
// so legacy MP4 reels can seek; ?download=1 forces a download with the
// original filename.
router.get("/:id/file", validate({ params: fileIdParamSchema }), fileController.download);
