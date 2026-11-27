/**
 * Referrals routes — /api/referrals, /api/referrals/:id
 * Thin endpoint definitions; all logic lives in src/modules/referrals
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/referrals`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  listReferralsQuerySchema,
  referralBodySchema,
  referralIdParamSchema,
} from "@/modules/referrals/schemas/referral.schema";
import { referralController } from "@/modules/referrals";

export const router = Router();

// GET /api/referrals — ADMIN | DOCTOR | NURSE see all; HOSPITAL users see
// only referrals addressed to their own organisation; BENEFICIARY sees own.
// Filters: beneficiaryId, status, priority.
router.get(
  "/",
  authorize("ADMIN", "DOCTOR", "NURSE", "HOSPITAL", "BENEFICIARY"),
  validate({ query: listReferralsQuerySchema }),
  referralController.list
);

// POST /api/referrals — DOCTOR | ADMIN.
// { beneficiaryId, campId?, encounterId?, reason, priority, receivingOrgId?,
//   speciality? } → code UAR-REF-NNNNN, status CREATED.
// (Field checks run in the service — legacy order interleaved with lookups.)
router.post(
  "/",
  authorize("DOCTOR", "ADMIN"),
  validate({ body: referralBodySchema }),
  referralController.create
);

// GET /api/referrals/:id — ADMIN | DOCTOR | NURSE; HOSPITAL users only for
// referrals addressed to their own organisation.
router.get(
  "/:id",
  authorize("ADMIN", "DOCTOR", "NURSE", "HOSPITAL"),
  validate({ params: referralIdParamSchema }),
  referralController.get
);

// PATCH /api/referrals/:id {status?, notes?} — workflow transitions; the
// receiving organisation's HOSPITAL user may set ACCEPTED only.
router.patch(
  "/:id",
  authorize("ADMIN", "DOCTOR", "HOSPITAL"),
  validate({ params: referralIdParamSchema, body: referralBodySchema }),
  referralController.update
);
