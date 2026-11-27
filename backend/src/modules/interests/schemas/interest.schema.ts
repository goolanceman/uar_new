/**
 * Interest schemas — /api/interests input.
 *
 * Legacy coerced the title with String(...).trim() (any JSON value accepted —
 * numbers, booleans, even "[object Object]" — only empty-after-trim was
 * rejected with a 400) and converted :id with Number() MID-handler (after the
 * title check; no param validation, so "abc" reached the service as NaN).
 * Both behaviors are reproduced here: the body preprocess mirrors
 * String((req.body ?? {}).title ?? "") including non-object bodies, and the
 * id param stays a plain string the controller converts with Number().
 */
import { z } from "zod";

/** Whole-body schema: String((req.body ?? {}).title ?? "").trim() — non-object
 * bodies (arrays, strings, null) saw `undefined` in legacy, hence the {}
 * normalization; missing/null title → "" → the legacy required message. */
export const createInterestSchema = z.preprocess((body) => {
  const title =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).title
      : undefined;
  return String(title ?? "");
}, z.string().trim().min(1, "The title field is required."));
export type CreateInterestBody = z.infer<typeof createInterestSchema>;

// PATCH body — same title contract as POST.
export const updateInterestSchema = createInterestSchema;
export type UpdateInterestBody = z.infer<typeof updateInterestSchema>;

/**
 * :id stays an unvalidated string — the legacy route converted it with
 * Number() mid-handler, so a coercing param schema would invent a 400 the
 * legacy never sent (it failed later, inside the service).
 */
export const interestIdParamSchema = z.object({ id: z.string() });
export type InterestIdParams = z.infer<typeof interestIdParamSchema>;

/** pageParams(req.query, 100) written out verbatim: parseInt(String(v ?? def))
 * || def, floored at 1, capped at maxLimit — exact legacy pagination parity. */
export const listInterestsQuerySchema = z.object({
  page: z.preprocess((v) => Math.max(1, parseInt(String(v ?? "1"), 10) || 1), z.number()),
  limit: z.preprocess((v) => Math.min(100, Math.max(1, parseInt(String(v ?? "100"), 10) || 100)), z.number()),
});
export type ListInterestsQuery = z.infer<typeof listInterestsQuerySchema>;
