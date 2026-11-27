/**
 * Vitals routes — /api/vitals
 * Thin endpoint definitions; all logic lives in src/modules/vitals
 * (routes → controllers → services → repositories).
 * Converted 1:1 from src/app/api/vitals/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { createVitalsSchema, listVitalsQuerySchema } from "@/modules/vitals/schemas/vitals.schema";
import { vitalsController } from "@/modules/vitals";

export const router = Router();

// GET /api/vitals — ADMIN | DOCTOR | NURSE. Filters: beneficiaryId, campId,
// encounterId. Newest first.
router.get(
  "/",
  authorize("ADMIN", "DOCTOR", "NURSE"),
  validate({ query: listVitalsQuerySchema }),
  vitalsController.list
);

// POST /api/vitals — ADMIN | NURSE | DOCTOR.
// { beneficiaryId, campId?, encounterId?, bpSystolic?, bpDiastolic?, pulse?,
//   tempC?, respRate?, spo2?, heightCm?, weightKg?, glucose?, notes? }
// BMI is computed when height + weight are given (kg/m², 1 decimal).
router.post(
  "/",
  authorize("ADMIN", "NURSE", "DOCTOR"),
  validate({ body: createVitalsSchema }),
  vitalsController.create
);
