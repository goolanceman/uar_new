/**
 * Screening routes — /api/screenings
 * Thin endpoint definitions; all logic lives in src/modules/screenings
 * (routes → controllers → services → repositories).
 * Converted 1:1 from src/app/api/screenings/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createScreeningSchema,
  listScreeningsQuerySchema,
} from "@/modules/screenings/schemas/screening.schema";
import { screeningController } from "@/modules/screenings";

export const router = Router();

// GET /api/screenings — ADMIN | DOCTOR | NURSE.
// Filters: beneficiaryId, campId, encounterId, type, abnormal=1/0.
router.get(
  "/",
  authorize("ADMIN", "DOCTOR", "NURSE"),
  validate({ query: listScreeningsQuerySchema }),
  screeningController.list
);

// POST /api/screenings — ADMIN | DOCTOR | NURSE.
// { campId?, beneficiaryId, encounterId?, type, result, abnormal?, notes? }
// Screening observations only — these records never constitute a diagnosis.
// NOTE: the ScreeningRecord table has no notes column yet — `notes` is
// accepted in the payload but not persisted (schema-change request filed).
router.post(
  "/",
  authorize("ADMIN", "DOCTOR", "NURSE"),
  validate({ body: createScreeningSchema }),
  screeningController.create
);
