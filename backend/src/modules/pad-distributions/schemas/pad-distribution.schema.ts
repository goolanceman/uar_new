/**
 * Pad distribution (pad drive) schemas — Zod definitions for
 * /api/pad-distributions requests.
 *
 * GET / query mirrors the legacy URLSearchParams handling exactly: all
 * coercions are total (limit/offset clamp instead of rejecting, bad from/to
 * dates are ignored, session accepts only "1"/"0") so no legacy request that
 * passed before starts failing now.
 *
 * The POST/PATCH bodies are NOT validated here: the legacy handler coerces
 * and clamps every field (Math.trunc/Number/Boolean) and must keep its exact
 * wire messages ("area is required", "Volunteer not found", …) and its
 * check ordering (the volunteer lookup is interleaved), so the service
 * performs the identical coercion on the raw body.
 */
import { z } from "zod";

/** First value of a repeated query param (URLSearchParams.get semantics). */
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Legacy: Math.min(500, Math.max(1, Math.trunc(Number(sp.get("limit")) || 100))). */
const legacyLimit = z.preprocess(
  (v) => Math.min(500, Math.max(1, Math.trunc(Number(first(v)) || 100))),
  z.number().int().min(1)
);

/** Legacy: Math.max(0, Math.trunc(Number(sp.get("offset")) || 0)). */
const legacyOffset = z.preprocess(
  (v) => Math.max(0, Math.trunc(Number(first(v)) || 0)),
  z.number().int().min(0)
);

/** Legacy parseFrom(): trimmed value; unparseable dates are ignored. */
const legacyFromDate = z.preprocess((v) => {
  const raw = typeof first(v) === "string" ? String(first(v)).trim() : undefined;
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}, z.date().optional());

/** Legacy parseTo(): YYYY-MM-DD gets an end-of-day suffix; unparseable ignored. */
const legacyToDate = z.preprocess((v) => {
  const raw = typeof first(v) === "string" ? String(first(v)).trim() : undefined;
  if (!raw) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999` : raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}, z.date().optional());

/** Legacy `sp.get("session")`: "1" → true, "0" → false, anything else → no filter. */
const sessionFilter = z.preprocess((v) => {
  const s = first(v);
  return s === "1" ? true : s === "0" ? false : undefined;
}, z.boolean().optional());

/** Trimmed string filter — absent/empty means "no filter" (legacy `if (q)`). */
const trimmedFilter = z.preprocess((v) => {
  const s = first(v);
  return typeof s === "string" && s.trim() ? s.trim() : undefined;
}, z.string().optional());

export const listPadDistributionsQuerySchema = z.object({
  q: trimmedFilter,
  session: sessionFilter,
  from: legacyFromDate,
  to: legacyToDate,
  volunteerId: trimmedFilter,
  limit: legacyLimit,
  offset: legacyOffset,
  withTotals: z.preprocess((v) => first(v) === "1", z.boolean()),
});
export type ListPadDistributionsQuery = z.infer<typeof listPadDistributionsQuerySchema>;
