/**
 * Camp expense schemas — Zod definitions for every /api/camp-expenses request.
 *
 * The list query reproduces the legacy pageParams() math exactly
 * (Math.max/Math.trunc/||-fallback) via transform, so every input the legacy
 * route silently accepted is still accepted with the same coerced value.
 *
 * The POST body is deliberately NOT schema-validated: the legacy route
 * interleaves its field checks with a DB lookup (campId check → camp lookup →
 * head check → amount check), and moving those checks into Zod would both
 * reorder the side effects and change the exact wire error messages. The
 * service performs the identical checks in the identical order.
 */
import { z } from "zod";

/** Mirrors URLSearchParams.get(): first value for repeated params, null when absent. */
const first = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    const head = v[0];
    return head === undefined || head === null ? null : String(head);
  }
  return String(v);
};

export const listCampExpensesQuerySchema = z.object({
  // page = Math.max(1, Math.trunc(Number(page) || 1))
  page: z.unknown().optional().transform((v) => Math.max(1, Math.trunc(Number(first(v)) || 1))),
  // limit = Math.min(200, Math.max(1, Math.trunc(Number(limit) || 50)))
  limit: z.unknown().optional().transform((v) => Math.min(200, Math.max(1, Math.trunc(Number(first(v)) || 50)))),
  // Optional camp filter — absent or empty means "no filter" (legacy truthiness).
  campId: z.unknown().optional().transform((v) => first(v)),
});
export type ListCampExpensesQuery = z.infer<typeof listCampExpensesQuerySchema>;
