/** Medical referral status workflow shared by admin UI and PATCH API. */
export const REFERRAL_FLOW: readonly string[] = [
  "CREATED",
  "SHARED",
  "ACCEPTED",
  "SCHEDULED",
  "ATTENDED",
  "REPORT_RECEIVED",
  "COMPLETED",
] as const;

export const REFERRAL_TERMINAL_STATUSES = ["CANCELLED", "LOST_TO_FOLLOWUP"] as const;
export const REFERRAL_STATUSES: readonly string[] = [...REFERRAL_FLOW, ...REFERRAL_TERMINAL_STATUSES];

/** Existing API semantics allow any strictly-forward move and side exits. */
export const REFERRAL_TRANSITIONS: Record<string, string[]> = Object.fromEntries(
  REFERRAL_FLOW.map((status, index) => [
    status,
    [
      ...REFERRAL_FLOW.slice(index + 1),
      ...(status === "COMPLETED" ? [] : [...REFERRAL_TERMINAL_STATUSES]),
    ],
  ])
);

for (const status of REFERRAL_TERMINAL_STATUSES) REFERRAL_TRANSITIONS[status] = [];

export function referralTransitions(status: string): string[] {
  return REFERRAL_TRANSITIONS[status] ?? [];
}
