/** Camp staff assignment lifecycle shared by the admin roster and PATCH API. */
export const CAMP_STAFF_STATUSES = [
  "ASSIGNED",
  "CONFIRMED",
  "ATTENDED",
  "WITHDRAWN",
] as const;

export const CAMP_STAFF_TRANSITIONS: Record<string, string[]> = {
  ASSIGNED: ["CONFIRMED", "WITHDRAWN"],
  CONFIRMED: ["ATTENDED", "WITHDRAWN"],
  ATTENDED: [],
  WITHDRAWN: [],
};

export const CAMP_STAFF_ACTION_LABELS: Record<string, string> = {
  CONFIRMED: "Confirm attendance",
  ATTENDED: "Mark attended",
  WITHDRAWN: "Withdraw",
};
