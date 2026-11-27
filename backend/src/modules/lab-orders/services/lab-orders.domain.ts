/**
 * Lab order (DiagnosticOrder) pipeline — single source of truth.
 *
 * Enforced linear state machine — out-of-order transitions are rejected 409:
 *   ORDERED → SAMPLE_COLLECTED → RECEIVED → PROCESSING → RESULT_AVAILABLE
 *           → VERIFIED → DOCTOR_REVIEWED
 *
 * Consumed by:
 *  - PATCH /api/lab-orders/:id  (transition guard + role gates)
 *  - lab-tech queue UI          (advance button per row)
 */

export const LAB_ORDER_FLOW = [
  "ORDERED",
  "SAMPLE_COLLECTED",
  "RECEIVED",
  "PROCESSING",
  "RESULT_AVAILABLE",
  "VERIFIED",
  "DOCTOR_REVIEWED",
] as const;

/** Strictly linear: the only legal move from each state (absent = terminal). */
export const LAB_ORDER_NEXT: Record<string, string> = {
  ORDERED: "SAMPLE_COLLECTED",
  SAMPLE_COLLECTED: "RECEIVED",
  RECEIVED: "PROCESSING",
  PROCESSING: "RESULT_AVAILABLE",
  RESULT_AVAILABLE: "VERIFIED",
  VERIFIED: "DOCTOR_REVIEWED",
};

/** Button label for advancing INTO each state (UI). */
const LAB_ORDER_STEP_LABEL: Record<string, string> = {
  SAMPLE_COLLECTED: "Sample collected",
  RECEIVED: "Mark received",
  PROCESSING: "Start processing",
  RESULT_AVAILABLE: "Enter result",
  VERIFIED: "Verify result",
};

/** Next step the lab tech can advance to from the current one, or null. */
export function nextLabOrderStep(
  status: string | null | undefined
): { status: string; label: string } | null {
  const next = LAB_ORDER_NEXT[(status ?? "").toUpperCase()];
  if (!next) return null;
  return { status: next, label: LAB_ORDER_STEP_LABEL[next] ?? next };
}
