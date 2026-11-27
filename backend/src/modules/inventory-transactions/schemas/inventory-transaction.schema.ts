/**
 * Inventory transaction schemas — /api/inventory-transactions input.
 *
 * Legacy parsed the query with the pageParams() helper (silent coercion,
 * truncation and clamping) and validated the POST body fields mid-handler
 * AFTER the item lookup, so the query schema reproduces the helper
 * expressions verbatim and the body schema is a permissive envelope — the
 * exact field checks live in the service.
 */
import { z } from "zod";

/** URLSearchParams.get() semantics over Express req.query (qs): repeated
 * params yield an array — legacy read the FIRST value via searchParams.get();
 * qs object encodings (e.g. ?type[a]=b) were different keys to searchParams,
 * so they read as absent here too. */
const spGet = z.preprocess((v) => {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}, z.string().optional());

// ─── Admin list ──────────────────────────────────────────────────────────────

/** pageParams(): page = Math.max(1, Math.trunc(Number(v) || 1)),
 *  limit = Math.min(200, Math.max(1, Math.trunc(Number(v) || 50))). */
export const listTransactionsQuerySchema = z.object({
  itemId: spGet.transform((v) => v || undefined),
  campId: spGet.transform((v) => v || undefined),
  // Raw value — legacy validated it case-sensitively against VALID_TYPES
  // inside the handler (exact 400 message preserved in the service).
  type: spGet.transform((v) => v || undefined),
  page: spGet.transform((v) => Math.max(1, Math.trunc(Number(v) || 1))),
  limit: spGet.transform((v) => Math.min(200, Math.max(1, Math.trunc(Number(v) || 50)))),
});
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

// ─── POST body ───────────────────────────────────────────────────────────────

/** Permissive body envelope: legacy read `req.body ?? {}` and validated known
 *  fields mid-handler after the inventory-item lookup. The service applies the
 *  exact legacy checks with the original error messages. */
export const createTransactionBodySchema = z.any();
export type CreateTransactionBody = Record<string, unknown>;
