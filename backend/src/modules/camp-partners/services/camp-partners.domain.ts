/**
 * Camp partner (organisation invited to a medical camp) response workflow —
 * single source of truth.
 *
 *   INVITED → ACCEPTED | DECLINED   (the org responds once)
 *   ACCEPTED / DECLINED are terminal.
 *
 * Consumed by PATCH /api/camp-partners/:id (guard, stamps respondedAt) and
 * the hospital portal's invite cards.
 */

export const PARTNER_RESPONSE_STATUSES = ["ACCEPTED", "DECLINED"];

export const PARTNER_TRANSITIONS: Record<string, string[]> = {
  INVITED: ["ACCEPTED", "DECLINED"],
  ACCEPTED: [],
  DECLINED: [],
};
