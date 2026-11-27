/**
 * Follow-up routes — /api/follow-ups, /api/follow-ups/:id
 * Thin endpoint definitions; all logic lives in src/modules/follow-ups
 * (routes → controllers → services → repositories).
 * The historical export path (`@/routes/follow-ups`) is preserved.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  followUpIdParamSchema,
  listFollowUpsQuerySchema,
} from "@/modules/follow-ups/schemas/follow-up.schema";
import { followUpController } from "@/modules/follow-ups";

export const router = Router();

// GET /api/follow-ups — ADMIN | DOCTOR | NURSE | VOLUNTEER; BENEFICIARY own.
// Filters: beneficiaryId, status, overdue=1 (dueDate in the past & PENDING).
router.get(
  "/",
  authorize("ADMIN", "DOCTOR", "NURSE", "VOLUNTEER", "BENEFICIARY"),
  validate({ query: listFollowUpsQuerySchema }),
  followUpController.list
);

// POST /api/follow-ups — DOCTOR | ADMIN | NURSE.
// { beneficiaryId, campId?, referralId?, dueDate, instructions?, ownerName? }
// → status PENDING.
// (no body schema: the legacy checks interleave with DB lookups in the service)
router.post("/", authorize("DOCTOR", "ADMIN", "NURSE"), followUpController.create);

// GET /api/follow-ups/:id — ADMIN | DOCTOR | NURSE | VOLUNTEER.
router.get(
  "/:id",
  authorize("ADMIN", "DOCTOR", "NURSE", "VOLUNTEER"),
  validate({ params: followUpIdParamSchema }),
  followUpController.getById
);

// PATCH /api/follow-ups/:id — ADMIN | DOCTOR | NURSE | VOLUNTEER.
// { status: DONE | MISSED | CANCELLED, outcome? } — DONE stamps doneAt.
// (no body schema: the 404 fires before body processing — service keeps that order)
router.patch(
  "/:id",
  authorize("ADMIN", "DOCTOR", "NURSE", "VOLUNTEER"),
  validate({ params: followUpIdParamSchema }),
  followUpController.update
);
