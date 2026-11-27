/**
 * Story schemas — Zod definitions for every /api/stories request.
 * Validation reproduces the legacy coercions exactly: every transform below
 * mirrors the legacy expression 1:1 and none of them can reject, so no input
 * the legacy routes accepted is newly rejected.
 */
import { z } from "zod";
import { pageQuerySchema } from "@/shared/schemas/common";

// ─── Public list ─────────────────────────────────────────────────────────────

// Legacy list used pageParams(req.query, 50): default limit 50, cap 100.
export const listStoriesQuerySchema = pageQuerySchema(50);
export type ListStoriesQuery = z.infer<typeof listStoriesQuerySchema>;

// ─── POST / (multipart) ──────────────────────────────────────────────────────

/**
 * Legacy create coercions: Number(b.type ?? 0) || 0, Number(b.duration ?? 0)
 * || 0, content stringified unless null/empty. Uploaded files are extracted
 * from req.files by the controller, not validated here.
 */
export const createStorySchema = z.object({
  type: z.unknown().optional().transform((v) => Number(v ?? 0) || 0),
  duration: z.unknown().optional().transform((v) => Number(v ?? 0) || 0),
  content: z.unknown().optional().transform((v) => (v != null && v !== "" ? String(v) : null)),
});
export type CreateStoryBody = z.infer<typeof createStorySchema>;

// ─── PATCH /:id ──────────────────────────────────────────────────────────────

/**
 * Legacy patch coercions: a field is touched only when present, then run
 * through Number()/String() — including NaN (type NaN lands as 0 in the lib
 * updater, exactly like the legacy route).
 */
export const updateStorySchema = z.object({
  type: z.unknown().optional().transform((v) => (v === undefined ? undefined : Number(v))),
  duration: z.unknown().optional().transform((v) => (v === undefined ? undefined : Number(v))),
  content: z.unknown().optional().transform((v) => (v === undefined ? undefined : String(v))),
  thumbnail: z.unknown().optional().transform((v) => (v === undefined ? undefined : String(v))),
});
export type UpdateStoryBody = z.infer<typeof updateStorySchema>;
