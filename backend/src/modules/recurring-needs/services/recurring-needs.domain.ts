/**
 * Recurring need status vocabulary — shared between the API and the admin
 * beneficiaries view.
 *
 * Intentionally NOT transition-enforced: the admin UI uses an unconditional
 * pause/resume toggle (a completed need can legitimately be resumed). Only
 * membership is enforced on PATCH.
 */

export const RECURRING_NEED_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED"];
