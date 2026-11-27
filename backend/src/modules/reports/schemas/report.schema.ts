/**
 * Reports schemas — Zod definitions for /api/reports requests.
 *
 * The legacy route parsed ?type/?from/?to/?compare/?fy with
 * URLSearchParams.get semantics off the raw request URL: absent → null,
 * arrays → first value, anything non-string (qs nested keys) → null.
 * Parsing never rejects — the branch dispatch and every parser below
 * tolerate garbage exactly like the legacy handler (invalid dates and
 * non-numeric `fy` fall back to defaults instead of 400s).
 */

import { z } from "zod";

/** First value of a query param or null (legacy sp.get semantics). */
const firstStringOrNull = (v: unknown): string | null => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : null;
  return typeof v === "string" ? v : null;
};

export const reportsQuerySchema = z.object({
  type: z.preprocess(firstStringOrNull, z.string().nullable()),
  from: z.preprocess(firstStringOrNull, z.string().nullable()),
  to: z.preprocess(firstStringOrNull, z.string().nullable()),
  compare: z.preprocess(firstStringOrNull, z.string().nullable()),
  fy: z.preprocess(firstStringOrNull, z.string().nullable()),
});
export type ReportsQuery = z.infer<typeof reportsQuerySchema>;
