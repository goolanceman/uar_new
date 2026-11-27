/**
 * Lab order routes — /api/lab-orders, /api/lab-orders/:id
 * Thin endpoint definitions; all logic lives in src/modules/lab-orders
 * (routes → controllers → services → repositories).
 * The historical export path (`@/routes/lab-orders`) is preserved: tests and
 * the app entry import `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { stringIdParamSchema } from "@/shared/schemas/common";
import {
  createLabOrderBodySchema,
  listLabOrdersQuerySchema,
  updateLabOrderBodySchema,
} from "@/modules/lab-orders/schemas/lab-order.schema";
import { labOrderController } from "@/modules/lab-orders";

export const router = Router();

// GET /api/lab-orders — authenticated, then a role gate in the controller
// (legacy mid-handler check): ADMIN | DOCTOR | LAB_TECH | NURSE, and
// BENEFICIARY sees own orders only. Filters: beneficiaryId, campId, status,
// q (code/testName).
router.get("/", authenticate, validate({ query: listLabOrdersQuerySchema }), labOrderController.list);

// POST /api/lab-orders — DOCTOR | ADMIN.
// { beneficiaryId, campId?, encounterId?, testName } → code UAR-LAB-NNNNN,
// status ORDERED, orderedByName.
router.post("/", authorize("DOCTOR", "ADMIN"), validate({ body: createLabOrderBodySchema }), labOrderController.create);

// GET /api/lab-orders/:id — ADMIN | DOCTOR | LAB_TECH | NURSE.
router.get(
  "/:id",
  authorize("ADMIN", "DOCTOR", "LAB_TECH", "NURSE"),
  validate({ params: stringIdParamSchema }),
  labOrderController.get
);

// PATCH /api/lab-orders/:id — enforced transitions:
//   ORDERED→SAMPLE_COLLECTED (collectedAt) →RECEIVED→PROCESSING
//   →RESULT_AVAILABLE (resultText / resultFileUrl)   [LAB_TECH | ADMIN]
//   RESULT_AVAILABLE→VERIFIED (verifiedByName/verifiedAt)  [LAB_TECH | ADMIN]
//   VERIFIED→DOCTOR_REVIEWED (reviewedAt)                  [DOCTOR | ADMIN]
// `critical` may be set by DOCTOR | ADMIN alongside a transition or alone.
router.patch(
  "/:id",
  authorize("ADMIN", "DOCTOR", "LAB_TECH"),
  validate({ params: stringIdParamSchema, body: updateLabOrderBodySchema }),
  labOrderController.update
);
