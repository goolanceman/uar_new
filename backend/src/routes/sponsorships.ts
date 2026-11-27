/**
 * Sponsorships routes — /api/sponsorships, /api/sponsorships/match, /api/sponsorships/:id
 * Thin endpoint definitions; all logic lives in src/modules/sponsorships
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/sponsorships`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  createSponsorshipBodySchema,
  listSponsorshipsQuerySchema,
  sponsorshipIdParamSchema,
  updateSponsorshipBodySchema,
} from "@/modules/sponsorships/schemas/sponsorship.schema";
import { sponsorshipController } from "@/modules/sponsorships";

export const router = Router();

// GET /api/sponsorships?beneficiaryId=&donorId=&status=&mine=1
// Staff (ADMIN | VOLUNTEER) see any slice via query filters. A logged-in
// DONOR may only pass mine=1, which scopes to their own Donor record
// (resolved via Donor.userId) — so donors can see what they're sponsoring.
// (Legacy gate: `await requireAuth(req)` as the handler's first step.)
router.get(
  "/",
  authenticate,
  validate({ query: listSponsorshipsQuerySchema }),
  sponsorshipController.list
);

// GET /api/sponsorships/match (ADMIN | VOLUNTEER) — donor <-> beneficiary
// pairing suggestions (preview-only).
// NOTE: declared before the "/:id" pattern.
router.get("/match", authorize("ADMIN", "VOLUNTEER"), sponsorshipController.match);

// POST /api/sponsorships (ADMIN | VOLUNTEER) — manually assign a donor to
// sponsor a beneficiary's monthly support (optionally tied to one recurring
// need, e.g. "cover BP tablets every month"). (Field checks run in the
// service — legacy order.)
router.post(
  "/",
  authorize("ADMIN", "VOLUNTEER"),
  validate({ body: createSponsorshipBodySchema }),
  sponsorshipController.create
);

// PATCH /api/sponsorships/:id
// Staff (ADMIN | VOLUNTEER) may edit anything. A DONOR may only pause/resume
// or cancel a sponsorship that belongs to their own Donor record.
router.patch(
  "/:id",
  authenticate,
  validate({ params: sponsorshipIdParamSchema, body: updateSponsorshipBodySchema }),
  sponsorshipController.update
);

// DELETE /api/sponsorships/:id (ADMIN only) — remove a sponsorship assignment
router.delete("/:id", authorize("ADMIN"), validate({ params: sponsorshipIdParamSchema }), sponsorshipController.remove);
