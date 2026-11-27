/**
 * Screening schemas — Zod definitions for every /api/screenings request.
 * Validation messages and coercions match the legacy route exactly
 * (String(...).trim() presence checks, optText() empty→null, uppercased type
 * enum, Boolean() truthiness for abnormal) so existing clients see identical
 * behavior.
 */
import { z } from "zod";

export const SCREENING_TYPES = [
  "EYE",
  "DENTAL",
  "BP",
  "GLUCOSE",
  "HEARING",
  "SKIN",
  "NUTRITION",
  "GENERAL",
  "OTHER",
] as const;

// ─── Shared coercion helpers (legacy pageParams/optText semantics) ──────────

/** First value of a query param (legacy URLSearchParams.get semantics). */
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Legacy pageParams(): Math.max(1, Math.trunc(Number(v) || 1)) — "abc"/0/absent
 *  fall back to 1, fractions truncate. */
const legacyPage = z.preprocess(
  (v) => Math.max(1, Math.trunc(Number(first(v) ?? null) || 1)),
  z.number().int().min(1)
);

/** Legacy pageParams(): Math.min(200, Math.max(1, Math.trunc(Number(v) || def))). */
const legacyLimit = (def: number) =>
  z.preprocess(
    (v) => Math.min(200, Math.max(1, Math.trunc(Number(first(v) ?? null) || def))),
    z.number().int().min(1)
  );

/** Legacy optText(): String(v).trim(), empty/absent → null. */
const optText = z.preprocess((v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}, z.string().nullable());

/** Optional query string filter — absent/empty means "no filter" (legacy `if (v)`). */
const queryFilter = z.preprocess((v) => {
  const s = first(v);
  return typeof s === "string" && s ? s : undefined;
}, z.string().optional());

// ─── GET /api/screenings ─────────────────────────────────────────────────────

export const listScreeningsQuerySchema = z.object({
  page: legacyPage,
  limit: legacyLimit(50),
  beneficiaryId: queryFilter,
  campId: queryFilter,
  encounterId: queryFilter,
  type: z.preprocess(
    (v) => {
      const s = first(v);
      return typeof s === "string" && s ? s : undefined;
    },
    z.enum(SCREENING_TYPES, { error: "Invalid screening type" }).optional()
  ),
  /** abnormal=1/0 filters; ANY other value is silently ignored (legacy). */
  abnormal: z.preprocess((v) => {
    const s = first(v);
    return s === "1" ? true : s === "0" ? false : undefined;
  }, z.boolean().optional()),
});
export type ListScreeningsQuery = z.infer<typeof listScreeningsQuerySchema>;

// ─── POST /api/screenings ────────────────────────────────────────────────────

export const createScreeningSchema = z.object({
  beneficiaryId: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().min(1, "beneficiaryId is required")
  ),
  result: z.preprocess(
    (v) => (v === undefined || v === null ? null : String(v).trim()),
    z.string().min(1, "result is required")
  ),
  type: z.preprocess(
    (v) => String(v ?? "GENERAL").trim().toUpperCase(),
    z.enum(SCREENING_TYPES, {
      error: `type must be one of: ${SCREENING_TYPES.join(", ")}`,
    })
  ),
  campId: optText,
  encounterId: optText,
  /** Legacy Boolean(body.abnormal) truthiness — any truthy value means true. */
  abnormal: z.preprocess((v) => Boolean(v), z.boolean()),
});
export type CreateScreeningBody = z.infer<typeof createScreeningSchema>;
