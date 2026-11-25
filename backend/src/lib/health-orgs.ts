/**
 * Healthcare organisation (partner org) verification workflow — single source
 * of truth.
 *
 *   PENDING → VERIFIED | REJECTED   (admin verification review)
 *   VERIFIED ⇄ SUSPENDED            (revoke / reinstate partnership)
 *   REJECTED is terminal.
 *
 * Consumed by PATCH /api/health-orgs/:id (guard; verification events are
 * stamped server-side there) and the admin partners view (filters/actions).
 */

export const ORG_STATUSES = ["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"];

export const ORG_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["VERIFIED", "REJECTED"],
  VERIFIED: ["SUSPENDED"],
  SUSPENDED: ["VERIFIED"],
  REJECTED: [],
};
