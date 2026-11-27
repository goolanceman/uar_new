/**
 * Relief-kit scanning — batch roll-up status derivation.
 *
 * KitUnit machine: READY → SCANNED (one-way, re-scan is a 409) · EXPIRED
 * terminal. The parent KitBatch status is fully derived from scanned-unit
 * counts via `kitBatchStatus` — keep the two machines in sync here.
 */

/** READY → IN_PROGRESS once scanning starts → DEPLETED when every unit is scanned. */
export function kitBatchStatus(
  scannedUnits: number,
  totalUnits: number
): "IN_PROGRESS" | "DEPLETED" {
  return scannedUnits >= totalUnits ? "DEPLETED" : "IN_PROGRESS";
}
