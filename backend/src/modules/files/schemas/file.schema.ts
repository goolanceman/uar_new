/**
 * File schemas — request definitions for /api/files*.
 *
 * The legacy handlers read query values with hand-rolled Number() coercions
 * and the PATCH body field-by-field after the 404 lookup, so the body schema
 * is a permissive envelope and the field checks stay in the service in the
 * legacy order (404-before-400).
 */
import { z } from "zod";

// ─── GET /api/files?q=&folder=&mime=&page=&limit= (ADMIN) ────────────────────

/** Legacy: sp.get(x)?.trim() || undefined — absent/blank means "no filter". */
const queryFilter = z
  .any()
  .optional()
  .transform((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined));

/** Legacy: Math.max(1, Math.trunc(Number(v) || 1)). */
const legacyPage = z.any().optional().transform((v) => Math.max(1, Math.trunc(Number(v) || 1)));

/** Legacy: Math.min(100, Math.max(1, Math.trunc(Number(v) || 24))). */
const legacyLimit = z
  .any()
  .optional()
  .transform((v) => Math.min(100, Math.max(1, Math.trunc(Number(v) || 24))));

export const listFilesQuerySchema = z.object({
  q: queryFilter,
  folder: queryFilter,
  mime: queryFilter, // prefix match, e.g. "image"
  page: legacyPage,
  limit: legacyLimit,
});
export type ListFilesQuery = z.infer<typeof listFilesQuerySchema>;

// ─── POST/PATCH bodies (checks interleaved with lookups — see service) ───────

/** Permissive body envelope: multipart uploads are read via readForm(req) in
 *  the controller, and the PATCH field checks run in the service after the
 *  404 lookup (legacy order). */
export const fileBodySchema = z.any();
export type FileBody = Record<string, unknown>;

// ─── Params (cuid ids — Express only matches non-empty) ──────────────────────

export const fileIdParamSchema = z.object({
  id: z.string().min(1),
});
export type FileIdParams = z.infer<typeof fileIdParamSchema>;
