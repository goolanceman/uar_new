/**
 * Camp partner routes — thin endpoint definitions; all logic lives in
 * src/modules/camp-partners (routes → controllers → services → repositories).
 * The historical export path (`@/routes/camp-partners`) is preserved: tests
 * and the app entry import `router` from here.
 *
 * /api/camp-partners, /api/camp-partners/:id — converted 1:1 from
 * src/app/api/camp-partners/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  createCampPartnerBodySchema,
  listCampPartnersQuerySchema,
  updateCampPartnerBodySchema,
} from "@/modules/camp-partners/schemas/camp-partner.schema";
import { campPartnerController } from "@/modules/camp-partners";

export const router = Router();

// GET /api/camp-partners?campId&status — ADMIN all; HOSPITAL its own invitations
router.get(
  "/",
  authorize("ADMIN", "HOSPITAL"),
  validate({ query: listCampPartnersQuerySchema }),
  campPartnerController.list
);

// POST /api/camp-partners (ADMIN) {campId, orgId, role} — invite an org (INVITED)
router.post("/", authorize("ADMIN"), validate({ body: createCampPartnerBodySchema }), campPartnerController.create);

// PATCH /api/camp-partners/:id — ADMIN, or the HOSPITAL owning the invited org.
// {status: ACCEPTED|DECLINED, notes?} — respondedAt is stamped server-side.
router.patch(
  "/:id",
  authorize("ADMIN", "HOSPITAL"),
  validate({ params: stringIdParamSchema, body: updateCampPartnerBodySchema }),
  campPartnerController.update
);
