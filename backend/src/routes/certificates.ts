/**
 * Certificates routes — /api/certificates, /api/certificates/:code,
 * /api/certificates/:code/html
 * Thin endpoint definitions; all logic lives in src/modules/certificates
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/certificates`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { authenticate, authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import {
  certificateCodeParamSchema,
  createCertificateBodySchema,
  listCertificatesQuerySchema,
} from "@/modules/certificates/schemas/certificate.schema";
import { certificateController } from "@/modules/certificates";

export const router = Router();

// GET /api/certificates?limit=50 — newest first. ADMIN: all certificates ·
// other signed-in roles: only their own (userId). (Legacy gate: `await
// requireAuth(req)` as the handler's first step.)
router.get(
  "/",
  authenticate,
  validate({ query: listCertificatesQuerySchema }),
  certificateController.list
);

// POST /api/certificates — ADMIN issues a certificate. Body: { type,
// recipientName, recipientEmail?, userId?, title?, description?, refType?,
// refId?, meta? } (field checks run in the service — legacy order).
router.post(
  "/",
  authorize("ADMIN"),
  validate({ body: createCertificateBodySchema }),
  certificateController.create
);

// GET /api/certificates/:code — certificate detail. Public by capability:
// the certificate code is the shared verification link.
router.get(
  "/:code",
  validate({ params: certificateCodeParamSchema }),
  certificateController.get
);

// GET /api/certificates/:code/html — self-contained, print-ready A4 award
// certificate (inline CSS only, auto window.print). Public with the
// certificate code acting as the capability.
router.get(
  "/:code/html",
  validate({ params: certificateCodeParamSchema }),
  certificateController.html
);
