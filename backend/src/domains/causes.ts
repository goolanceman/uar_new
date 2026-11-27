import { db } from "@/infrastructure/database/prisma";

/** Cause status vocabulary — SEEKING/PARTIAL/ADOPTED are derived from ACTIVE pledges by recomputeCause; PAUSED is the admin pause toggle. */
export const CAUSE_STATUSES = ["SEEKING", "PARTIAL", "ADOPTED", "PAUSED"];

/**
 * Admin pause machine for PATCH /api/causes/:id — pause any cause, resume to
 * SEEKING/PARTIAL (recomputeCause corrects the derived value on the next
 * pledge event and bypasses this table — it writes the row directly).
 * ADOPTED can only be changed by recompute, never by the API.
 */
export const CAUSE_TRANSITIONS: Record<string, string[]> = {
  SEEKING: ["PAUSED"],
  PARTIAL: ["PAUSED"],
  ADOPTED: ["PAUSED"],
  PAUSED: ["SEEKING", "PARTIAL"],
};


/**
 * Recompute a Cause's raised total / status / adopter from its ACTIVE pledges.
 *  raised   = Σ amountPerMonth of ACTIVE pledges
 *  status   = "SEEKING" (raised 0) | "PARTIAL" (< monthlyCost) | "ADOPTED" (>= monthlyCost)
 *  adopter  = first (oldest) ACTIVE pledge's donor
 * Returns the updated cause (incl. pledges) or null if the cause does not exist.
 */
export async function recomputeCause(causeId: string) {
  const cause = await db.cause.findUnique({ where: { id: causeId } });
  if (!cause) return null;

  const active = await db.pledge.findMany({
    where: { causeId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });

  const raised = active.reduce((sum, p) => sum + (Number(p.amountPerMonth) || 0), 0);
  const status =
    raised === 0 ? "SEEKING" : raised >= cause.monthlyCost ? "ADOPTED" : "PARTIAL";
  const first = active[0];

  return db.cause.update({
    where: { id: causeId },
    data: {
      raised,
      status,
      adoptedById: first?.donorId ?? null,
      adoptedByName: first?.donorName ?? null,
    },
    include: { pledges: { orderBy: { createdAt: "desc" } } },
  });
}
