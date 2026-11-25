import { ApiError } from "@/lib/session";

/**
 * Shared state-machine helpers for domain workflows.
 *
 * Every workflow in the app that has a `status` field declares its states and
 * its legal transitions in a `src/lib/<domain>.ts` module as a
 * `Record<state, state[]>` table (see `src/lib/food.ts` for the reference
 * implementation). Routes validate moves with `assertTransition`; UIs derive
 * their advance buttons from the same table instead of hand-mirroring it.
 */

/**
 * Enforce a status transition against a transition table.
 * - `from === to` (no-op field edits) is always allowed.
 * - Unknown source states are treated as terminal (empty allowed set).
 * - Throws 409 by default (pass 400 to match older routes).
 */
export function assertTransition(
  table: Record<string, string[]>,
  from: string,
  to: string,
  entity: string,
  code: 400 | 409 = 409
): void {
  if (from === to) return; // no-op updates (e.g. editing fields) stay allowed
  const allowed = table[from] ?? [];
  if (!allowed.includes(to))
    throw new ApiError(
      `Cannot move ${entity} from ${from} to ${to}. Allowed: ${allowed.join(", ") || "none"}`,
      code
    );
}
