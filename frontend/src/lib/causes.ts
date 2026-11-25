/**
 * Cause status vocabulary — SEEKING/PARTIAL/ADOPTED are derived from ACTIVE
 * pledges by recomputeCause (backend/src/lib/causes.ts); PAUSED is the admin
 * pause toggle. This frontend copy holds ONLY the shared constants — all
 * server logic (recomputeCause, transitions) lives in the backend service.
 */
export const CAUSE_STATUSES = ["SEEKING", "PARTIAL", "ADOPTED", "PAUSED"];

export const CAUSE_TRANSITIONS: Record<string, string[]> = {
  SEEKING: ["PAUSED"],
  PARTIAL: ["PAUSED"],
  ADOPTED: ["PAUSED"],
  PAUSED: ["SEEKING", "PARTIAL"],
};
