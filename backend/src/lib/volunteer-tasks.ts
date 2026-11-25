/**
 * Volunteer task workflow — single source of truth.
 *
 *   ASSIGNED → IN_PROGRESS → COMPLETED, with CANCELLED from any open state.
 *   COMPLETED / CANCELLED are terminal.
 *
 * Consumed by PATCH /api/volunteer-tasks/:id (guard) and both task UIs
 * (admin volunteers view + volunteer portal) for their action buttons.
 */

export const TASK_STATUSES = ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

export const TASK_TRANSITIONS: Record<string, string[]> = {
  ASSIGNED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** Action buttons per status, in workflow order (UI attaches icons). */
export function taskTransitions(status: string): Array<{ label: string; status: string }> {
  switch (status) {
    case "ASSIGNED":
      return [
        { label: "Start", status: "IN_PROGRESS" },
        { label: "Complete", status: "COMPLETED" },
        { label: "Cancel", status: "CANCELLED" },
      ];
    case "IN_PROGRESS":
      return [
        { label: "Complete", status: "COMPLETED" },
        { label: "Cancel", status: "CANCELLED" },
      ];
    default:
      return [];
  }
}
