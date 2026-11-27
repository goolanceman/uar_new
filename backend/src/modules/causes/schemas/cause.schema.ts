/**
 * Cause schemas — Zod definitions for /api/causes requests.
 *
 * GET / and GET /pledges query shapes mirror the legacy URLSearchParams
 * handling exactly (absent/empty filter → no filter — no rejections).
 *
 * The POST /, PATCH /:id and POST /:id/pledges bodies are NOT validated
 * here: the legacy handlers coerce fields mid-flow with exact wire messages
 * ("patientName, city and story are required", "Invalid condition", …) and
 * PATCH validates only AFTER the 404 lookup (not-found-before-bad-input
 * ordering), so the services perform the identical checks on the raw body.
 */
import { z } from "zod";

/** First value of a repeated query param (URLSearchParams.get semantics). */
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Legacy `sp.get("condition") || undefined` — raw string, "" means no filter. */
const rawFilter = z.preprocess((v) => {
  const s = first(v);
  return typeof s === "string" && s ? s : undefined;
}, z.string().optional());

/** Legacy `sp.get("q")?.trim() || undefined`. */
const trimmedFilter = z.preprocess((v) => {
  const s = first(v);
  return typeof s === "string" && s.trim() ? s.trim() : undefined;
}, z.string().optional());

// GET /api/causes?condition=&status=&q= (public)
export const listCausesQuerySchema = z.object({
  condition: rawFilter,
  status: rawFilter,
  q: trimmedFilter,
});
export type ListCausesQuery = z.infer<typeof listCausesQuerySchema>;

// GET /api/causes/pledges?mine=1&causeId= (auth)
// Legacy `if (sp.get("mine"))` — ANY non-empty value (even "0") filters to mine.
export const listCausePledgesQuerySchema = z.object({
  mine: z.preprocess((v) => {
    const s = first(v);
    return typeof s === "string" && s ? true : false;
  }, z.boolean()),
  causeId: rawFilter,
});
export type ListCausePledgesQuery = z.infer<typeof listCausePledgesQuerySchema>;
