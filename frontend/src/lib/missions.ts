/**
 * Mission (emergency ambulance dispatch) flow — single source of truth.
 *
 * Canonical status flow (CANCELLED is a side-state allowed from any open state):
 *   REQUESTED → DISPATCHED → EN_ROUTE → ARRIVED → COMPLETED
 *
 * Consumed by:
 *  - PATCH /api/missions/:id     (stepper validation + auto progress)
 *  - admin ambulance view        (stepper, labels, progress bar, advance button)
 */

export const MISSION_FLOW = [
  "REQUESTED",
  "DISPATCHED",
  "EN_ROUTE",
  "ARRIVED",
  "COMPLETED",
] as const;

/** Auto progress per status (PATCH /api/missions/:id derives it from here). */
export const MISSION_PROGRESS: Record<string, number> = {
  REQUESTED: 10,
  DISPATCHED: 40,
  EN_ROUTE: 70,
  ARRIVED: 95,
  COMPLETED: 100,
};

/** Human label per status (UI stepper). */
export const MISSION_STEP_LABEL: Record<string, string> = {
  REQUESTED: "Requested",
  DISPATCHED: "Dispatched",
  EN_ROUTE: "En route",
  ARRIVED: "Arrived",
  COMPLETED: "Completed",
};

/**
 * Advance button per status (UI). REQUESTED is intentionally absent —
 * dispatch requires an ambulance assignment and goes through the
 * action:dispatch flow / dispatch dialog, not a plain status patch.
 */
export const MISSION_NEXT_STEP: Record<
  string,
  { label: string; status: string }
> = {
  DISPATCHED: { label: "Start en route", status: "EN_ROUTE" },
  EN_ROUTE: { label: "Mark arrived", status: "ARRIVED" },
  ARRIVED: { label: "Complete mission", status: "COMPLETED" },
};
