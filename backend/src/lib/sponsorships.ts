/**
 * Recurring need / sponsorship status vocabularies — shared between the APIs
 * and the admin beneficiaries view + donor portal.
 *
 * Intentionally NOT transition-enforced: both use an unconditional
 * pause/resume toggle (a completed need or sponsorship can legitimately be
 * resumed). Only membership is enforced on PATCH.
 */

export const RECURRING_NEED_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED"];

export const SPONSORSHIP_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"];

/** Statuses a DONOR may set on their own sponsorship (staff: all of the above). */
export const DONOR_ALLOWED_SPONSORSHIP_STATUSES = ["ACTIVE", "PAUSED", "CANCELLED"];
