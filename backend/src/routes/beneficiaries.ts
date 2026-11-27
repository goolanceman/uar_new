/**
 * Beneficiary routes — /api/beneficiaries, /api/beneficiaries/:id,
 * /api/beneficiaries/:id/kyc, /api/beneficiaries/:id/kyc/review,
 * /api/beneficiaries/:id/notes
 * Thin endpoint definitions; all logic lives in src/modules/beneficiaries
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/beneficiaries`) is preserved: tests and the app entry
 * import `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  beneficiaryIdParamSchema,
  createBeneficiaryBodySchema,
  createNoteBodySchema,
  listBeneficiariesQuerySchema,
  reviewKycBodySchema,
  submitKycBodySchema,
  updateBeneficiaryBodySchema,
} from "@/modules/beneficiaries/schemas/beneficiary.schema";
import { beneficiaryController } from "@/modules/beneficiaries";

export const router = Router();

// GET /api/beneficiaries?q=&category=&active=0/1 (staff) · ?mine=1 (self case)
// (Legacy auth gate is branch-dependent — mine=1 → requireAuth, otherwise
// staff requireRole — so it stays inside the controller as lib calls.)
router.get("/", validate({ query: listBeneficiariesQuerySchema }), beneficiaryController.list);

// POST /api/beneficiaries (ADMIN | VOLUNTEER)
// (Legacy gate: `await requireRole(...)` as the handler's first step; field
// checks run in the service — legacy order.)
router.post(
  "/",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ body: createBeneficiaryBodySchema }),
  beneficiaryController.create
);

// PATCH /api/beneficiaries/:id (ADMIN | VOLUNTEER)
// (The 404 fires before body processing — service keeps that order.)
router.patch(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: beneficiaryIdParamSchema, body: updateBeneficiaryBodySchema }),
  beneficiaryController.update
);

// DELETE /api/beneficiaries/:id (ADMIN)
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: beneficiaryIdParamSchema }),
  beneficiaryController.remove
);

// ─── KYC verification workflow ─────────────────────────────────────────

// POST /api/beneficiaries/:id/kyc — the owning BENEFICIARY (or ADMIN) submits
// KYC documents. (Legacy first step: requireAuth inside the owner check — the
// 404/403 ownership checks that follow it live in the service, same order.)
router.post(
  "/:id/kyc",
  authenticate,
  validate({ params: beneficiaryIdParamSchema, body: submitKycBodySchema }),
  beneficiaryController.submitKyc
);

// POST /api/beneficiaries/:id/kyc/review (ADMIN) — approve/reject a KYC
// submission: { status: "VERIFIED" | "REJECTED", notes? }.
router.post(
  "/:id/kyc/review",
  authorize("ADMIN"),
  validate({ params: beneficiaryIdParamSchema, body: reviewKycBodySchema }),
  beneficiaryController.reviewKyc
);

// GET /api/beneficiaries/:id/notes — case-note timeline
router.get(
  "/:id/notes",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: beneficiaryIdParamSchema }),
  beneficiaryController.listNotes
);

// POST /api/beneficiaries/:id/notes — add a case note
router.post(
  "/:id/notes",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: beneficiaryIdParamSchema, body: createNoteBodySchema }),
  beneficiaryController.addNote
);
