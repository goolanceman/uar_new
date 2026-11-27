/**
 * Inventory schemas — Zod definitions for every /api/inventory request.
 *
 * GET pagination is not paginated (the legacy list returned every row ordered
 * by name); filters mirror the legacy sp.get() semantics exactly: category
 * present-and-non-empty filters, q is trimmed then truthy-checked, and low is
 * Boolean(String) — any present value (even "0") means low-stock-only.
 *
 * The POST/PATCH bodies are deliberately NOT schema-validated: the legacy
 * handlers coerce every field with String()/Number() semantics that never
 * reject (invalid numbers fall back to 0/null, invalid dates flow to Prisma
 * as Invalid Date → 500), the PATCH 404 fires BEFORE body processing, and the
 * error messages are bare legacy strings ("name is required"). All of that
 * stays in the service in the exact original order.
 */
import { z } from "zod";
import { stringIdParamSchema } from "@/shared/schemas/common";

// ─── Shared coercion helpers (legacy URLSearchParams.get semantics) ──────────

/** First value of a query param (legacy sp.get returns the first). */
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

// ─── GET /api/inventory?category=&q=&low=1 ───────────────────────────────────

export const listInventoryQuerySchema = z.object({
  /** legacy: sp.get("category") || undefined */
  category: z.preprocess((v) => {
    const s = first(v);
    return typeof s === "string" && s ? s : undefined;
  }, z.string().optional()),
  /** legacy: sp.get("q")?.trim() || undefined */
  q: z.preprocess((v) => {
    const s = first(v);
    return typeof s === "string" && s.trim() ? s.trim() : undefined;
  }, z.string().optional()),
  /** legacy: Boolean(sp.get("low")) — "0" is truthy too */
  low: z.preprocess((v) => Boolean(first(v)), z.boolean()),
});
export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;

// ─── GET/PATCH/DELETE /api/inventory/:id ─────────────────────────────────────

/** Extraction-only param schema — the service renders the legacy 404. */
export const inventoryIdParamSchema = stringIdParamSchema;
export type InventoryIdParams = z.infer<typeof inventoryIdParamSchema>;
