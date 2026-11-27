/**
 * Volunteer assignment routes — thin endpoint definitions; all logic lives in
 * src/modules/volunteer-assignments (routes → controllers → services →
 * repositories). The historical export path (`@/routes/volunteer-assignments`)
 * is preserved: tests and the app entry import `router` from here.
 *
 * /api/volunteer-assignments — converted 1:1 from
 * src/app/api/volunteer-assignments/route.ts (Next.js route handler) to Express.
 *
 * CONTRACT (consumed by the distributions detail view — do not break):
 *
 * POST /api/volunteer-assignments (ADMIN)
 *   body: {
 *     refType: "DISTRIBUTION" | "CAMPAIGN" | "EVENT",
 *     refId: string,
 *     volunteerIds: string[]   // ≥ 1
 *     title?: string,          // default `${RefType} support`
 *     scheduledDate?: string,  // ISO — default now + 3 days
 *     priority?: "LOW" | "MEDIUM" | "HIGH",
 *     location?: string, notes?: string
 *   }
 *   → 201 { tasks: VolunteerTask[] }   // ONE task per volunteer, createdFrom "AUTO"
 *   Duplicates skipped: volunteer+refType+refId already has a task with
 *   status != CANCELLED. Unknown volunteers → 404. Every task description
 *   mentions the source refId.
 *
 * GET /api/volunteer-assignments?refType=DISTRIBUTION&refId=xxx (ADMIN)
 *   → VolunteerTask[] for that record, newest first, incl. volunteer.user.name
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createAssignmentBodySchema,
  listAssignmentsQuerySchema,
} from "@/modules/volunteer-assignments/schemas/volunteer-assignment.schema";
import { volunteerAssignmentController } from "@/modules/volunteer-assignments";

export const router = Router();

// GET /api/volunteer-assignments?refType=&refId= (ADMIN)
router.get(
  "/",
  authorize("ADMIN"),
  validate({ query: listAssignmentsQuerySchema }),
  volunteerAssignmentController.list
);

// POST /api/volunteer-assignments (ADMIN)
router.post(
  "/",
  authorize("ADMIN"),
  validate({ body: createAssignmentBodySchema }),
  volunteerAssignmentController.create
);
