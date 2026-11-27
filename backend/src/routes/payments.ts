/**
 * Payments routes — /api/payments, /api/payments/verify, /api/payments/webhook
 * Thin endpoint definitions; all logic lives in src/modules/payments
 * (routes → controllers → services → repositories). The historical export
 * path (`@/routes/payments`) is preserved: tests and the app entry import
 * `router` from here.
 */
import { Router } from "express";
import { validate } from "@/shared/middleware/validate";
import {
  createPaymentOrderBodySchema,
  verifyPaymentBodySchema,
  webhookBodySchema,
} from "@/modules/payments/schemas/payment.schema";
import { paymentController } from "@/modules/payments";

export const router = Router();

// POST /api/payments — { receiptNumber } → provider checkout payload.
// PUBLIC endpoint (no auth): the receiptNumber acts as the capability — it is
// only issued to the donor who created the donation, and the donation must be
// PENDING with a gateway payment method. The order is created against the
// provider configured by admins (finance.gateway*) and the public checkout
// payload is returned so the donor's browser can open hosted checkout.
// No secrets are ever returned — only the public key id (Razorpay key id).
// (Legacy receiptNumber/eligibility checks run in the service with the exact
// legacy messages — mid-handler validation, like the certificates module.)
router.post(
  "/",
  validate({ body: createPaymentOrderBodySchema }),
  paymentController.createOrder
);

// POST /api/payments/verify — provider callback → settle the donation.
// PUBLIC endpoint (no auth): called by the donor's browser right after the
// provider checkout succeeds. The provider is discriminated by which fields
// are present (Razorpay HMAC-SHA256 signature, timing-safe; Stripe/Cashfree
// server-side polls) — provider checks live in the service.
router.post(
  "/verify",
  validate({ body: verifyPaymentBodySchema }),
  paymentController.verify
);

// POST /api/payments/webhook — Razorpay server-to-server settlement (moved
// from the mobile compat router /razorpay/webhook). NO session auth: the
// Razorpay HMAC-SHA256 signature over the RAW request body is the auth
// (RAZORPAY_WEBHOOK_SECRET, falling back to RAZORPAY_KEY_SECRET). The
// rawBody stash middleware stays app-level (express.json verify in
// src/index.ts) — the controller passes the stashed bytes to the service.
router.post(
  "/webhook",
  validate({ body: webhookBodySchema }),
  paymentController.webhook
);
