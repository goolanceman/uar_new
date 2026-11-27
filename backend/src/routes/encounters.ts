/**
 * Encounter routes — /api/encounters, /api/encounters/:id, /api/encounters/:id/sign
 * Thin endpoint definitions; all logic lives in src/modules/encounters
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/encounters`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createEncounterBodySchema,
  encounterIdParamSchema,
  listEncountersQuerySchema,
  updateEncounterBodySchema,
} from "@/modules/encounters/schemas/encounter.schema";
import { encounterController } from "@/modules/encounters";

export const router = Router();

// GET /api/encounters — staff list (newest first)
// Roles: ADMIN | DOCTOR | NURSE. Filters: beneficiaryId, campId, doctorId,
// status, from/to (createdAt range). Envelope { items, total, page, pages }.
router.get(
  "/",
  authorize("ADMIN", "DOCTOR", "NURSE"),
  validate({ query: listEncountersQuerySchema }),
  encounterController.list
);

// POST /api/encounters — DOCTOR only. doctorId is resolved from the caller's
// HealthProfessional row (linked by userId). New encounters start as DRAFT.
// (Field checks run in the service — legacy order.)
router.post("/", authorize("DOCTOR"), validate({ body: createEncounterBodySchema }), encounterController.create);

// GET /api/encounters/:id — ADMIN | DOCTOR | NURSE, plus the BENEFICIARY
// account linked to the patient record itself.
router.get(
  "/:id",
  authorize("ADMIN", "DOCTOR", "NURSE", "BENEFICIARY"),
  validate({ params: encounterIdParamSchema }),
  encounterController.get
);

// PATCH /api/encounters/:id
// - DRAFT: the owning DOCTOR (or ADMIN) edits chiefComplaint / observations /
//   diagnosis / advice / followUpDate.
// - SIGNED: immutable by design — the owning DOCTOR (or ADMIN) may send
//   { amendment: "..." } (alias: amendmentNote) together with updated fields.
router.patch(
  "/:id",
  authorize("ADMIN", "DOCTOR"),
  validate({ params: encounterIdParamSchema, body: updateEncounterBodySchema }),
  encounterController.update
);

// POST /api/encounters/:id/sign — the owning DOCTOR (or ADMIN) signs the
// encounter. Signed encounters are immutable; further corrections go through
// PATCH with { amendment }.
router.post(
  "/:id/sign",
  authorize("ADMIN", "DOCTOR"),
  validate({ params: encounterIdParamSchema }),
  encounterController.sign
);
