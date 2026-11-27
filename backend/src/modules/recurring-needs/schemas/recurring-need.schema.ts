/**
 * Recurring-need schemas — /api/recurring-needs input.
 *
 * Legacy parsed the query with URLSearchParams.get() (silent trim/upper-case,
 * invalid status/dueBy values silently ignored) and read the POST/PATCH bodies
 * raw (`req.body as Record<string, unknown>`, NO `?? {}` normalization) with
 * per-field checks mid-handler AFTER the existence lookups. So the query
 * schema reproduces the sp.get() expressions verbatim, the routes carry NO
 * body schema (raw req.body flows to the service unchanged), and the exact
 * field checks live in the service.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?status[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── Staff list ──────────────────────────────────────────────────────────────

export const listRecurringNeedsQuerySchema = z.object({
  beneficiaryId: spGet.transform((v) => (v !== undefined ? v.trim() || undefined : undefined)),
  itemId: spGet.transform((v) => (v !== undefined ? v.trim() || undefined : undefined)),
  // Raw upper-cased value — legacy silently ignored values outside
  // RECURRING_NEED_STATUSES (no error), which the service reproduces.
  status: spGet.transform((v) => (v !== undefined ? v.trim().toUpperCase() || undefined : undefined)),
  // Raw value — legacy parsed the date in-handler and silently ignored
  // unparseable values (no error), which the service reproduces.
  dueBy: spGet.transform((v) => (v !== undefined ? v.trim() || undefined : undefined)),
});
export type ListRecurringNeedsQuery = z.infer<typeof listRecurringNeedsQuerySchema>;

// ─── Id params ───────────────────────────────────────────────────────────────

/** Recurring-need ids are cuid strings — `:id` segments are never empty. */
export const recurringNeedIdParamSchema = stringIdParamSchema;
export type RecurringNeedIdParams = z.infer<typeof recurringNeedIdParamSchema>;
