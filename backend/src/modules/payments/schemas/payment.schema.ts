/**
 * Payment schemas — /api/payments input.
 *
 * All three payment endpoints validated their bodies mid-handler with
 * hand-rolled checks and bespoke error messages (the verify endpoint
 * discriminates the provider by which fields are present and falls through
 * to a generic "missing fields" 400; the webhook consumes the raw request
 * bytes for HMAC verification), so — like the certificates module — the body
 * schemas are permissive whole-body envelopes and the exact legacy checks
 * live in the service. Do not add Zod-level rejections here: the legacy
 * endpoints accepted anything express.json() parsed.
 */
import { z } from "zod";

/** POST /api/payments — legacy read `(req.body ?? {}).receiptNumber` and ran
 *  the String()/trim()/required check in-handler ("A donation receipt number
 *  is required"). */
export const createPaymentOrderBodySchema = z.any();
export type CreatePaymentOrderBody = Record<string, unknown>;

/** POST /api/payments/verify — Razorpay {razorpay_order_id,
 *  razorpay_payment_id, razorpay_signature} vs Stripe {sessionId} vs Cashfree
 *  {orderId} are discriminated mid-handler by field presence; any other body
 *  falls through to "Missing payment confirmation fields — nothing to
 *  verify.". */
export const verifyPaymentBodySchema = z.any();
export type VerifyPaymentBody = Record<string, unknown>;

/** POST /api/payments/webhook — Razorpay sends application/json; the HMAC
 *  input is the RAW request body stashed by the app-level express.json verify
 *  callback, so the parsed body must be passed through untouched. */
export const webhookBodySchema = z.any();
export type WebhookBody = Record<string, unknown>;
