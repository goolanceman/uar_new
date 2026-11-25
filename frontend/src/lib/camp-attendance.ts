/**
 * Camp attendance (patient journey at a medical camp) — single source of truth.
 *
 *   CHECKED_IN → WAITING → IN_CONSULTATION → COMPLETED → CHECKED_OUT
 *   with NO_SHOW (only from CHECKED_IN/WAITING) and CANCELLED side-states.
 *
 * Invariants enforced by PATCH /api/camp-attendance:
 *  - CANCELLED requires a cancelReason
 *  - CHECKED_OUT stamps checkOutAt · COMPLETED does NOT check out
 *  - re-check-in while in an ACTIVE status is a 409
 *
 * Consumed by the route (guard), health shared UI (queue-row advance buttons)
 * and the live camp dashboard (summary buckets).
 */

export const ATTENDANCE_STATUSES = [
  "CHECKED_IN",
  "WAITING",
  "IN_CONSULTATION",
  "COMPLETED",
  "CHECKED_OUT",
  "NO_SHOW",
  "CANCELLED",
];

/** Statuses settable via PATCH (CHECKED_IN only via POST check-in). */
export const ATTENDANCE_PATCH_STATUSES = [
  "WAITING",
  "IN_CONSULTATION",
  "COMPLETED",
  "CHECKED_OUT",
  "NO_SHOW",
  "CANCELLED",
];

/** Statuses that mean "currently in the queue" — re-check-in is a 409. */
export const ATTENDANCE_ACTIVE_STATUSES = [
  "CHECKED_IN",
  "WAITING",
  "IN_CONSULTATION",
];

/** Current status → statuses it may move to (source-keyed, like all machines). */
export const ATTENDANCE_TRANSITIONS: Record<string, string[]> = {
  CHECKED_IN: ["WAITING", "IN_CONSULTATION", "COMPLETED", "NO_SHOW", "CANCELLED"],
  WAITING: ["WAITING", "IN_CONSULTATION", "COMPLETED", "NO_SHOW", "CANCELLED"],
  IN_CONSULTATION: ["WAITING", "IN_CONSULTATION", "COMPLETED", "CANCELLED"],
  COMPLETED: ["CHECKED_OUT"],
  CHECKED_OUT: [],
  NO_SHOW: [],
  CANCELLED: [],
};

/** Linear happy-path advance for queue rows (UI). */
export function attTransitions(status: string): Array<{ label: string; status: string }> {
  switch (status) {
    case "CHECKED_IN":
      return [{ label: "Add to waiting queue", status: "WAITING" }];
    case "WAITING":
      return [{ label: "Send to consultation", status: "IN_CONSULTATION" }];
    case "IN_CONSULTATION":
      return [{ label: "Mark completed", status: "COMPLETED" }];
    case "COMPLETED":
      return [{ label: "Check out", status: "CHECKED_OUT" }];
    default:
      return [];
  }
}

/** True when an action is legal from the current patient-journey state. */
export function canTransitionAttendance(from: string, to: string): boolean {
  return (ATTENDANCE_TRANSITIONS[from] ?? []).includes(to);
}
