/**
 * Ambulance fleet status vocabulary — shared between the fleet API and the
 * ambulance view's roster form.
 *
 * Intentionally NOT transition-enforced: ON_MISSION is set programmatically
 * by the mission dispatch/complete flows (PATCH /api/missions/:id writes the
 * ambulance directly) and the fleet form offers free status selection for
 * maintenance handling. Only membership is enforced on PATCH.
 */

export const AMBULANCE_STATUSES = ["AVAILABLE", "ON_MISSION", "MAINTENANCE"];
