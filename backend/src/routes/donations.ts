/**
 * Donations routes — /api/donations, /api/donations/recurring, /api/donations/:id
 * Thin endpoint definitions; all logic lives in src/modules/donations
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/donations`) is preserved: tests and the app entry import
 * `router` from here.
 *
 * Route registration order matches the legacy file exactly — the parameterized
 * GET /:id must not shadow GET /recurring/mine.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  createDonationBodySchema,
  updateDonationBodySchema,
  updateRecurringBodySchema,
} from "@/modules/donations/schemas/donation.schema";
import { donationController } from "@/modules/donations";

export const router = Router();

// GET /api/donations — mine=1 | public feed | wall=1 donor wall | admin
// filtered list. PUBLIC route: the mine branch gates with requireAuth
// mid-handler (kept in the controller — legacy ordering), the wall/public
// branches are anonymous, the signed-in branch is session-enriched. No
// validate() — the legacy handler parsed raw URLSearchParams; the exact
// branch/parse semantics live in the controller + service.
router.get("/", donationController.list);

// POST /api/donations — public or logged-in donor. PUBLIC (guest donations
// allowed): the optional session only enriches the donor identity. Per-field
// validation (amount, campaign/food-event existence, donor identity, phone,
// PAN, recurring parent/pledge ownership, currency) runs in the service in
// the exact legacy order — body schema is a permissive envelope.
router.post("/", validate({ body: createDonationBodySchema }), donationController.create);

// GET /api/donations/recurring/mine — the signed-in donor's monthly-giving
// commitments. (Legacy gate: `await requireAuth(req)` as the first step.)
router.get("/recurring/mine", authenticate, donationController.listMyRecurring);

// PATCH /api/donations/recurring/:id — the owner (or an admin) manages their
// recurring commitment (pause/resume/cancel, amount, frequency). (Legacy
// gate: `await requireAuth(req)` first step; per-field checks in the service.)
router.patch(
  "/recurring/:id",
  authenticate,
  validate({ params: stringIdParamSchema, body: updateRecurringBodySchema }),
  donationController.updateRecurring
);

// GET /api/donations/:id — single record with full detail. (Legacy gate:
// `await requireRole(req, "ADMIN", "VOLUNTEER")` as the first step.)
router.get(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ params: stringIdParamSchema }),
  donationController.get
);

// PATCH /api/donations/:id — admin edits the full record (whitelisted).
// (Legacy gate: `await requireRole(req, "ADMIN")` first step.)
router.patch(
  "/:id",
  authorize("ADMIN"),
  validate({ params: stringIdParamSchema, body: updateDonationBodySchema }),
  donationController.update
);

// DELETE /api/donations/:id — admin removes a donation.
router.delete("/:id", authorize("ADMIN"), validate({ params: stringIdParamSchema }), donationController.remove);
