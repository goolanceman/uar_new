/**
 * Prescription routes — /api/prescriptions, /api/prescriptions/:id,
 * /api/prescriptions/:id/dispense, /api/prescriptions/:id/print,
 * /api/prescriptions/:id/sign. Thin endpoint definitions; all logic lives in
 * src/modules/prescriptions (routes → controllers → services →
 * repositories). The historical export path (`@/routes/prescriptions`) is
 * preserved: tests and the app entry import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createPrescriptionBodySchema,
  dispensePrescriptionBodySchema,
  listPrescriptionsQuerySchema,
  prescriptionIdParamSchema,
  updatePrescriptionBodySchema,
} from "@/modules/prescriptions/schemas/prescription.schema";
import { prescriptionController } from "@/modules/prescriptions";

export const router = Router();

// GET /api/prescriptions — ADMIN | DOCTOR | PHARMACIST (full list);
// BENEFICIARY role sees only prescriptions issued to their own patient record.
// Filters: beneficiaryId, campId, doctorId, status, q (code search).
router.get(
  "/",
  authorize("ADMIN", "DOCTOR", "PHARMACIST", "BENEFICIARY"),
  validate({ query: listPrescriptionsQuerySchema }),
  prescriptionController.list
);

// POST /api/prescriptions — DOCTOR only. Auto code (UAR-RX-NNNNN), status
// DRAFT until the doctor signs. (Field checks run in the service — legacy
// order, interleaved with beneficiary/encounter/camp/professional lookups.)
router.post(
  "/",
  authorize("DOCTOR"),
  validate({ body: createPrescriptionBodySchema }),
  prescriptionController.create
);

// GET /api/prescriptions/:id — ADMIN | DOCTOR | PHARMACIST, plus the
// BENEFICIARY account linked to the patient record itself.
router.get(
  "/:id",
  authorize("ADMIN", "DOCTOR", "PHARMACIST", "BENEFICIARY"),
  validate({ params: prescriptionIdParamSchema }),
  prescriptionController.get
);

// PATCH /api/prescriptions/:id
// 1) Cancel path: { status: "CANCELLED", cancelReason } — the owning DOCTOR
//    or ADMIN; rejected once FULLY_DISPENSED.
// 2) Edit path: the owning DOCTOR (or ADMIN) edits a DRAFT prescription —
//    diagnosis / followUpDate and a wholesale replacement of items when the
//    `items` array is provided. SIGNED prescriptions are immutable (409).
router.patch(
  "/:id",
  authorize("ADMIN", "DOCTOR"),
  validate({ params: prescriptionIdParamSchema, body: updatePrescriptionBodySchema }),
  prescriptionController.update
);

// POST /api/prescriptions/:id/dispense — ADMIN | PHARMACIST only. Stock
// decrements, inventory ledger rows and dispense rows land in one
// transaction (withTransaction in the service, tx client into the repos).
router.post(
  "/:id/dispense",
  authorize("ADMIN", "PHARMACIST"),
  validate({ params: prescriptionIdParamSchema, body: dispensePrescriptionBodySchema }),
  prescriptionController.dispense
);

// POST /api/prescriptions/:id/sign — the owning DOCTOR (or ADMIN) signs the
// prescription, freezing its items. Requires at least one medicine.
router.post(
  "/:id/sign",
  authorize("ADMIN", "DOCTOR"),
  validate({ params: prescriptionIdParamSchema }),
  prescriptionController.sign
);

// GET /api/prescriptions/:id/print — self-contained, print-ready A4
// prescription document (receipts print pattern: UAR letterhead + auto
// window.print). The Rx code in the footer acts as the verification
// reference.
router.get(
  "/:id/print",
  authorize("ADMIN", "DOCTOR", "PHARMACIST", "BENEFICIARY"),
  validate({ params: prescriptionIdParamSchema }),
  prescriptionController.print
);
