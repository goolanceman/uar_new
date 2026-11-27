/**
 * Campaign lifecycle — shared status vocabulary.
 *
 * Intentionally NOT transition-enforced: admins manage campaigns through a
 * free status dropdown plus one-click Activate/Pause/Complete actions, and
 * re-running a finished campaign is a legitimate operation. Only membership
 * is enforced (PATCH /api/campaigns/:id); both sides import this list so the
 * dropdown and the API can never drift.
 */

export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"];
