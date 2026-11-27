/**
 * Campaign schemas — Zod definitions for /api/campaigns requests.
 *
 * GET / query handling mirrors the legacy URLSearchParams code exactly
 * (absent param → null/""/default — no input is ever rejected, since the
 * legacy handler silently tolerated any query string).
 *
 * The POST / and PATCH /:id + PATCH /:id/urgency bodies are NOT validated
 * here: the legacy handlers coerce fields mid-flow with exact wire messages
 * ("Title and description are required", "Nothing to update", …) and
 * interleave validation with DB lookups (POST runs the unique-slug query
 * between field checks; the PATCH routes 404 before validating), so the
 * services perform the identical checks on the raw body.
 */
import { z } from "zod";

/** First value of a repeated query param (URLSearchParams.get semantics). */
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Legacy `sp.get(name)` — first value as a string, null when absent. */
const get = (v: unknown): string | null => {
  const s = first(v);
  return typeof s === "string" ? s : null;
};

// GET /api/campaigns
//   ?category=&status=&q=&featured=1&all=1   — legacy filters
//   ?urgent=1                                — active urgent appeals
//   ?sort=trending|recent|ending|progress    — trending sort
//   ?page=&limit=                            — presence of `page` switches
//                                              the response to {items,total,page,pages}
const listCampaignsShape = z.object({
  // sp.get("all") === "1"
  all: z.preprocess((v) => get(v) === "1", z.boolean()),
  category: z.preprocess((v) => get(v), z.string().nullable()),
  status: z.preprocess((v) => get(v), z.string().nullable()),
  // sp.get("q")?.trim() — present-but-empty stays "" (falsy, no filter)
  q: z.preprocess((v) => {
    const s = get(v);
    return s === null ? undefined : s.trim();
  }, z.string().optional()),
  featured: z.preprocess((v) => get(v) === "1", z.boolean()),
  urgent: z.preprocess((v) => get(v) === "1", z.boolean()),
  // sp.get("sort") ?? ""
  sort: z.preprocess((v) => get(v) ?? "", z.string()),
  // Raw presence of `page` (even "?page=") switches the response envelope.
  // Injected from the raw object below — a property preprocessor only sees
  // its OWN input key, which for pageParam is always absent.
  pageParam: z.string().nullable(),
  // page = Math.max(1, Number(sp.get("page")) || 1) — absent/null → Number(null)=0 → 1
  page: z.preprocess((v) => Math.max(1, Number(get(v)) || 1), z.number()),
  // limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 20))
  limit: z.preprocess((v) => Math.min(100, Math.max(1, Number(get(v)) || 20)), z.number()),
});

export const listCampaignsQuerySchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>;
    const s = first(obj.page);
    return { ...obj, pageParam: typeof s === "string" ? s : null };
  },
  listCampaignsShape
);
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;
