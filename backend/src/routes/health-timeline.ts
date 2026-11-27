/**
 * Health-timeline route — /api/health-timeline
 * Thin endpoint definitions; all logic lives in src/modules/health-timeline
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/health-timeline`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { healthTimelineQuerySchema } from "@/modules/health-timeline/schemas/health-timeline.schema";
import { healthTimelineController } from "@/modules/health-timeline";

export const router = Router();

// GET /api/health-timeline?beneficiaryId= — ADMIN | DOCTOR | NURSE;
// BENEFICIARY role sees its own chronology (the authorize() middleware runs
// the same requireAuth + role check — same 401/403s — as the legacy inline
// gate). Merges encounters, vitals, screenings, prescriptions, lab orders,
// referrals, follow-ups, documents and camp attendances into one descending
// list, capped at 200 entries. generatedBy: "system" — a mechanical merge,
// NOT AI output.
router.get(
  "/",
  authorize("ADMIN", "DOCTOR", "NURSE", "BENEFICIARY"),
  validate({ query: healthTimelineQuerySchema }),
  healthTimelineController.timeline
);
