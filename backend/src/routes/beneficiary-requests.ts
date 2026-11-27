/**
 * Beneficiary-request routes — /api/beneficiary-requests, /api/beneficiary-requests/:id
 * Thin endpoint definitions; all logic lives in src/modules/beneficiary-requests
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/beneficiary-requests`) is preserved: tests and the app
 * entry import `router` from here.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  beneficiaryRequestIdParamSchema,
  createBeneficiaryRequestBodySchema,
  listBeneficiaryRequestsQuerySchema,
  updateBeneficiaryRequestBodySchema,
} from "@/modules/beneficiary-requests/schemas/beneficiary-request.schema";
import { beneficiaryRequestController } from "@/modules/beneficiary-requests";

export const router = Router();

// GET /api/beneficiary-requests — admin queue, or ?mine=1 for the caller
// (the role gate depends on ?mine=1, so it stays a mid-handler lib call).
router.get(
  "/",
  validate({ query: listBeneficiaryRequestsQuerySchema }),
  beneficiaryRequestController.list
);

// POST /api/beneficiary-requests — beneficiary submits a help request
// (legacy gate: optional `await validateSession(req)` first step — kept in
// the controller; field validation runs in the service with the exact
// legacy messages).
router.post(
  "/",
  validate({ body: createBeneficiaryRequestBodySchema }),
  beneficiaryRequestController.create
);

// PATCH /api/beneficiary-requests/:id — admin reviews a request (field
// checks run in the service, after the legacy existence lookup).
router.patch(
  "/:id",
  authorize("ADMIN", "VOLUNTEER"),
  validate({
    params: beneficiaryRequestIdParamSchema,
    body: updateBeneficiaryRequestBodySchema,
  }),
  beneficiaryRequestController.update
);

// DELETE /api/beneficiary-requests/:id
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: beneficiaryRequestIdParamSchema }),
  beneficiaryRequestController.remove
);
