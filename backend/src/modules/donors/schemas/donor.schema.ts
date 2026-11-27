/**
 * Donor CRM schemas — Zod definitions for /api/donors requests.
 *
 * GET / query mirrors the legacy URLSearchParams handling exactly:
 * parseInt-based pagination (page default 1, limit default 50, cap 200) with
 * total coercions (invalid values fall back to the defaults — the legacy
 * route never rejected a page/limit) and raw/trimmed filter strings.
 *
 * The POST/PATCH bodies are NOT validated here: the legacy handler runs its
 * field checks interleaved with DB lookups (the email-conflict 409 fires
 * between the name/email check and the phone/PAN/PIN format checks) and every
 * message must stay verbatim, so the service performs those identical checks
 * on the raw body. Nothing else to validate.
 */
import { z } from "zod";

/** First value of a repeated query param (URLSearchParams.get semantics). */
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Legacy: Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1). */
const legacyPage = z.preprocess(
  (v) => Math.max(1, parseInt(String(first(v) ?? "1"), 10) || 1),
  z.number().int().min(1)
);

/** Legacy: Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "50", 10) || 50)). */
const legacyLimit = z.preprocess(
  (v) => Math.min(200, Math.max(1, parseInt(String(first(v) ?? "50"), 10) || 50)),
  z.number().int().min(1)
);

/** Raw string filter — absent/empty means "no filter" (legacy `if (type)`). */
const rawFilter = z.preprocess((v) => {
  const s = first(v);
  return typeof s === "string" && s ? s : undefined;
}, z.string().optional());

/** Trimmed search term — empty after trim means "no filter" (legacy `if (q)`). */
const trimmedFilter = z.preprocess((v) => {
  const s = first(v);
  return typeof s === "string" && s.trim() ? s.trim() : undefined;
}, z.string().optional());

export const listDonorsQuerySchema = z.object({
  q: trimmedFilter,
  type: rawFilter,
  category: rawFilter,
  page: legacyPage,
  limit: legacyLimit,
});
export type ListDonorsQuery = z.infer<typeof listDonorsQuerySchema>;
