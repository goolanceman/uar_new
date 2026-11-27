/**
 * Follow-up schemas — Zod definitions for every /api/follow-ups request.
 *
 * GET pagination mirrors the legacy pageParams() exactly (defLimit 50, cap
 * 200, silent coercion — invalid values fall back instead of rejecting).
 * The POST/PATCH bodies are deliberately NOT schema-validated: the legacy
 * handlers interleave their checks with beneficiary/camp/referral DB lookups
 * (404 before 400), coerce status/outcome with String() semantics and render
 * bare messages ("beneficiaryId is required"), so those checks stay in the
 * service in the exact legacy order.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

// ─── Shared coercion helpers (legacy pageParams semantics) ───────────────────

/** First value of a query param (legacy URLSearchParams.get semantics). */
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Legacy pageParams(): Math.max(1, Math.trunc(Number(v) || 1)). */
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

/** Optional query string filter — absent/empty means "no filter" (legacy `if (v)`). */
const queryFilter = z.preprocess((v) => {
  const s = first(v);
  return typeof s === "string" && s ? s : undefined;
}, z.string().optional());

// ─── GET /api/follow-ups ─────────────────────────────────────────────────────

export const listFollowUpsQuerySchema = z.object({
  page: legacyPage,
  limit: legacyLimit(50),
  beneficiaryId: queryFilter,
  status: queryFilter,
  /** legacy: sp.get("overdue") === "1" — compared raw in the service. */
  overdue: z.preprocess((v) => {
    const s = first(v);
    return typeof s === "string" ? s : undefined;
  }, z.string().optional()),
});
export type ListFollowUpsQuery = z.infer<typeof listFollowUpsQuerySchema>;

// ─── GET/PATCH /api/follow-ups/:id ───────────────────────────────────────────

/** Extraction-only param schema — the service renders the legacy 404. */
export const followUpIdParamSchema = stringIdParamSchema;
export type FollowUpIdParams = z.infer<typeof followUpIdParamSchema>;
