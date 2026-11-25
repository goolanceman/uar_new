/**
 * Multipart/form-data helper for Express — replaces Next.js `req.formData()`.
 *
 * Uses multer (memory storage) to parse the request, then reconstructs native
 * `File` objects (Node 20 global) so `saveUpload(file: File)` in lib/files.ts
 * works unchanged.
 */
import type { Request } from "express";
import multer from "multer";
import { ApiError } from "@/lib/session";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 }, // matches MAX_FILE_BYTES headroom
});

export type MulterFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };

/** Express middleware — attaches parsed files/fields to the request. */
export const multipart = upload.any();

export interface ParsedForm {
  files: File[];
  fields: Record<string, string>;
}

/**
 * Parse `req` after the `multipart` middleware ran. Returns native `File`
 * objects plus text fields, mirroring `await req.formData()` semantics.
 */
export function readForm(req: Request): ParsedForm {
  const files = (req.files as MulterFile[] | undefined) ?? [];
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (typeof v === "string") fields[k] = v;
  }
  return {
    files: files.map(
      (f) =>
        new File([f.buffer], f.originalname, {
          type: f.mimetype || "application/octet-stream",
        })
    ),
    fields,
  };
}

/** Thrown by multer when the payload is malformed — map to a 400. */
export function multipartErrorHandler(
  err: unknown,
  _req: Request,
  res: import("express").Response,
  next: (e?: unknown) => void
): void {
  if (err instanceof Error && err.message.includes("multer")) {
    res.status(400).json({ error: "Invalid file upload" });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}
