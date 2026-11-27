/**
 * Medical document routes — /api/medical-documents, /api/medical-documents/:id
 * Thin endpoint definitions; all logic lives in src/modules/medical-documents
 * (routes → controllers → services → repositories).
 * The historical export path (`@/routes/medical-documents`) is preserved.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  listMedicalDocumentsQuerySchema,
  medicalDocumentIdParamSchema,
} from "@/modules/medical-documents/schemas/medical-document.schema";
import { medicalDocumentController } from "@/modules/medical-documents";

export const router = Router();

// GET /api/medical-documents?beneficiaryId= — ADMIN | DOCTOR | NURSE (all);
// BENEFICIARY role sees documents of their own patient record only.
router.get(
  "/",
  authorize("ADMIN", "DOCTOR", "NURSE", "BENEFICIARY"),
  validate({ query: listMedicalDocumentsQuerySchema }),
  medicalDocumentController.list
);

// POST /api/medical-documents — ADMIN | DOCTOR | NURSE; BENEFICIARY adds to
// their own patient record only. { beneficiaryId, campId?, name, kind, url }
// (no body schema: the legacy checks interleave with DB lookups in the service)
router.post("/", authorize("ADMIN", "DOCTOR", "NURSE", "BENEFICIARY"), medicalDocumentController.create);

// GET /api/medical-documents/:id — ADMIN | DOCTOR | NURSE, plus the
// BENEFICIARY account linked to the patient record itself.
router.get(
  "/:id",
  authorize("ADMIN", "DOCTOR", "NURSE", "BENEFICIARY"),
  validate({ params: medicalDocumentIdParamSchema }),
  medicalDocumentController.getById
);

// DELETE /api/medical-documents/:id — ADMIN only.
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: medicalDocumentIdParamSchema }),
  medicalDocumentController.remove
);
