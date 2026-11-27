/**
 * Payments routes — /api/payments, /api/payments/verify
 * Converted 1:1 from src/app/api/payments/* (Next.js route handlers) to Express.
 */

/**
 * payments — POST /api/payments · create a gateway order for a pending donation.
 *
 * PUBLIC endpoint (no auth): the receiptNumber acts as the capability — it is
 * only issued to the donor who created the donation, and the donation must be
 * PENDING with a gateway payment method. The order is created against the
 * provider configured by admins (finance.gateway*) and the public checkout
 * payload is returned so the donor's browser can open hosted checkout.
 * No secrets are ever returned — only the public key id (Razorpay key id).
 */
import crypto from "crypto";
import { Router, type Request } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ApiError, json, handleError, logActivity } from "@/lib/session";
import { gatewayConfig, loadSettings, type GatewayConfig } from "@/lib/notify";
import { getCurrency } from "@/lib/settings-core";
import { broadcastEvent } from "@/lib/events";
import { settleDonationSideEffects } from "@/lib/charity/settlement";
import { settleDonationCommitments } from "@/lib/recurring";
import { invalidateCampaigns, invalidateStats } from "@/lib/cache";

export const router = Router();

const log = logger.child("payments");

const HTTP_TIMEOUT_MS = 15_000;

/** Donation payment methods that settle through the online gateway. */
const GATEWAY_METHODS = new Set(["RAZORPAY", "STRIPE", "CASHFREE"]);

/** major-unit amount → smallest currency unit (paise/cents/…) for gateway APIs. */
function smallestUnit(amount: number, currency: string): number {
  return Math.round(amount * 10 ** getCurrency(currency).decimals);
}

/**
 * Performs the provider REST call and converts transport/HTTP failures into
 * provider-tagged 502 ApiErrors (the upstream gateway is down or unhappy —
 * never a 500 of ours). Returns the parsed JSON body.
 */
async function providerFetch(provider: string, url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  } catch {
    throw new ApiError(`${provider} could not be reached — please try again in a moment.`, 502);
  }
  const raw = await res.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    // non-JSON error body — fall through to the status-only message
  }
  if (!res.ok) {
    const body = (parsed as { error?: { description?: string; message?: string }; message?: string } | null) ?? {};
    const detail = body.error?.description ?? body.error?.message ?? body.message ?? raw.slice(0, 140);
    throw new ApiError(
      `${provider} request failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
      502
    );
  }
  return parsed;
}

/** Fails fast (400) naming exactly which gateway credentials are missing. */
function requireCredentials(cfg: GatewayConfig): void {
  const missing: string[] = [];
  if (cfg.provider === "RAZORPAY") {
    if (!cfg.keyId) missing.push("Razorpay key ID");
    if (!cfg.keySecret) missing.push("Razorpay key secret");
  } else if (cfg.provider === "STRIPE") {
    if (!cfg.keySecret) missing.push("Stripe secret key");
  } else if (cfg.provider === "CASHFREE") {
    if (!cfg.cashfreeAppId) missing.push("Cashfree app ID");
    if (!cfg.keySecret) missing.push("Cashfree secret key");
  }
  if (missing.length > 0)
    throw new ApiError(
      `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not configured — online payments cannot start. Please use UPI or pay offline.`,
      400
    );
}

// POST /api/payments — { receiptNumber } → provider checkout payload
router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const receiptNumber = body?.receiptNumber ? String(body.receiptNumber).trim() : "";
    if (!receiptNumber) throw new ApiError("A donation receipt number is required", 400);

    const donation = await db.donation.findUnique({ where: { receiptNumber } });
    if (!donation) {
      log.warn("payment_order_not_found", { receiptNumber });
      throw new ApiError("No donation found for this receipt number", 404);
    }
    if (donation.paymentStatus === "COMPLETED") {
      log.warn("payment_order_already_paid", {
        donationId: donation.id,
        receiptNumber,
        paymentStatus: donation.paymentStatus,
      });
      throw new ApiError("This donation has already been paid — no further payment is due.", 400);
    }
    if (donation.paymentStatus !== "PENDING") {
      log.warn("payment_order_blocked", {
        donationId: donation.id,
        receiptNumber,
        paymentStatus: donation.paymentStatus,
        method: donation.paymentMethod,
      });
      throw new ApiError(`This donation cannot be paid online right now (status: ${donation.paymentStatus}).`, 400);
    }
    if (!GATEWAY_METHODS.has(donation.paymentMethod)) {
      log.warn("payment_order_blocked", {
        donationId: donation.id,
        receiptNumber,
        method: donation.paymentMethod,
      });
      throw new ApiError("This donation is not set up for online gateway payment.", 400);
    }

    const cfg = gatewayConfig(await loadSettings());
    if (!cfg.enabled) {
      log.warn("payment_order_blocked", {
        donationId: donation.id,
        receiptNumber,
        reason: "gateway_disabled",
      });
      throw new ApiError("Online payments are currently disabled. Please use UPI or pay offline.", 400);
    }
    if (cfg.provider === "PAYU") {
      log.warn("payment_order_blocked", {
        donationId: donation.id,
        receiptNumber,
        reason: "provider_not_configured",
      });
      throw new ApiError("PayU online checkout is not configured — use Razorpay, Stripe or Cashfree.", 400);
    }
    requireCredentials(cfg);

    const amount = smallestUnit(donation.amount, donation.currency);

    if (cfg.provider === "RAZORPAY") {
      log.debug("payment_order_razorpay_attempt", {
        donationId: donation.id,
        receiptNumber: donation.receiptNumber,
        amount,
      });
      const order = (await providerFetch("Razorpay", "https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount,
          currency: donation.currency,
          receipt: donation.receiptNumber,
        }),
      })) as { id?: string } | null;
      if (!order?.id) throw new ApiError("Razorpay did not return an order id — please try again.", 502);

      await db.donation.update({
        where: { id: donation.id },
        data: { gatewayOrderId: order.id, paymentProvider: "RAZORPAY" },
      });
      log.info("payment_order_created", {
        donationId: donation.id,
        receiptNumber: donation.receiptNumber,
        provider: "RAZORPAY",
        orderId: order.id,
      });
      await logActivity(
        donation.donorName,
        "PAYMENT_ORDER_CREATED",
        "DONATION",
        `${donation.receiptNumber} · Razorpay order ${order.id}`
      );
      return json(res, {
        provider: "RAZORPAY",
        orderId: order.id,
        keyId: cfg.keyId,
        amount,
        currency: donation.currency,
        testMode: cfg.testMode,
      });
    }

    if (cfg.provider === "STRIPE") {
      log.debug("payment_order_stripe_attempt", {
        donationId: donation.id,
        receiptNumber: donation.receiptNumber,
        amount,
      });
      // The SPA is hash-routed (#/donate), so the session id must land in
      // location.search BEFORE the fragment for the donate page to pick it
      // up on return (Stripe appends query params before the #).
      const origin = new URL(req.url, "http://localhost").origin;
      const form = new URLSearchParams({
        mode: "payment",
        success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}#/donate`,
        cancel_url: `${origin}/#/donate`,
        client_reference_id: donation.receiptNumber,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": donation.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(amount),
        "line_items[0][price_data][product_data][name]": `Donation — receipt ${donation.receiptNumber}`,
        "metadata[receiptNumber]": donation.receiptNumber,
      });
      const session = (await providerFetch("Stripe", "https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.keySecret}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      })) as { id?: string; url?: string } | null;
      if (!session?.id || !session.url)
        throw new ApiError("Stripe did not return a checkout session — please try again.", 502);

      await db.donation.update({
        where: { id: donation.id },
        data: { gatewayOrderId: session.id, paymentProvider: "STRIPE" },
      });
      log.info("payment_order_created", {
        donationId: donation.id,
        receiptNumber: donation.receiptNumber,
        provider: "STRIPE",
        orderId: session.id,
      });
      await logActivity(
        donation.donorName,
        "PAYMENT_ORDER_CREATED",
        "DONATION",
        `${donation.receiptNumber} · Stripe session ${session.id}`
      );
      return json(res, { provider: "STRIPE", checkoutUrl: session.url });
    }

    // CASHFREE — order_amount stays in major units (Cashfree is not subunit-based)
    const base = cfg.testMode ? "https://sandbox.cashfree.com" : "https://api.cashfree.com";
    log.debug("payment_order_cashfree_attempt", {
      donationId: donation.id,
      receiptNumber: donation.receiptNumber,
      amount,
      testMode: cfg.testMode,
    });
    const order = (await providerFetch("Cashfree", `${base}/pg/orders`, {
      method: "POST",
      headers: {
        "x-client-id": cfg.cashfreeAppId,
        "x-client-secret": cfg.keySecret,
        "x-api-version": "2023-08-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order_amount: donation.amount,
        order_currency: donation.currency,
        order_id: `UAR-${donation.receiptNumber}`,
        customer_details: {
          customer_email: donation.donorEmail,
          customer_phone: donation.donorPhone?.replace(/\D/g, "") || "9999999999",
        },
      }),
    })) as { order_id?: string; payment_session_id?: string } | null;
    if (!order?.order_id || !order.payment_session_id)
      throw new ApiError("Cashfree did not return a payment session — please try again.", 502);

    await db.donation.update({
      where: { id: donation.id },
      data: { gatewayOrderId: order.order_id, paymentProvider: "CASHFREE" },
    });
    log.info("payment_order_created", {
      donationId: donation.id,
      receiptNumber: donation.receiptNumber,
      provider: "CASHFREE",
      orderId: order.order_id,
    });
    await logActivity(
      donation.donorName,
      "PAYMENT_ORDER_CREATED",
      "DONATION",
      `${donation.receiptNumber} · Cashfree order ${order.order_id}`
    );
    return json(res, {
      provider: "CASHFREE",
      paymentSessionId: order.payment_session_id,
      orderId: order.order_id,
      testMode: cfg.testMode,
    });
  } catch (e) {
    return handleError(e, res);
  }
});

/**
 * payments/verify — POST /api/payments/verify · settle a gateway payment.
 *
 * PUBLIC endpoint (no auth): called by the donor's browser right after the
 * provider checkout succeeds. Verification differs per provider —
 *  - Razorpay: HMAC-SHA256(order_id|payment_id, keySecret) signature (timing-safe)
 *  - Stripe:   server-side poll of the Checkout Session (payment_status === "paid")
 *  - Cashfree: server-side poll of the order payments (payment_status === "SUCCESS")
 *
 * Only PENDING → COMPLETED transitions are allowed, so replays are idempotent:
 * an already-COMPLETED donation answers { ok: true, already: true } without
 * touching the record. Nothing here trusts client-supplied amounts or status.
 */

function donationView(d: {
  receiptNumber: string;
  amount: number;
  currency: string;
  paymentStatus: string;
}) {
  return {
    receiptNumber: d.receiptNumber,
    amount: d.amount,
    currency: d.currency,
    paymentStatus: d.paymentStatus,
  };
}

/**
 * Settles a donation: the only legal transition is PENDING → COMPLETED
 * (guarded in the WHERE clause so concurrent verifications stay idempotent).
 * Gateway donations are created PENDING, so the campaign total is bumped
 * here — the moment the money is actually confirmed — instead of at creation.
 *
 * Receipt invariant: `receiptStatus == "ISSUED" iff paymentStatus ==
 * "COMPLETED"` for gateway donations. This function maintains both fields
 * atomically; the admin donation PATCH enforces the matching transition
 * machine (PENDING → COMPLETED|FAILED|CANCELLED|REFUNDED, COMPLETED →
 * REFUNDED only) so no path can reach COMPLETED without re-visiting this
 * rule — if you add one, issue the receipt there too.
 */
async function settleCompleted(
  donation: {
    id: string;
    amount: number;
    campaignId: string | null;
    causePostId?: string | null;
    donorId?: string | null;
    donorName: string;
    receiptNumber: string;
  },
  patch: { transactionId?: string; paymentProvider: string }
): Promise<{ settled: { receiptNumber: string; amount: number; currency: string; paymentStatus: string }; settledNow: boolean }> {
  const result = await db.donation.updateMany({
    where: { id: donation.id, paymentStatus: "PENDING" },
    data: {
      paymentStatus: "COMPLETED",
      receiptStatus: "ISSUED",
      receiptIssuedAt: new Date(),
      ...(patch.transactionId ? { transactionId: patch.transactionId } : {}),
      paymentProvider: patch.paymentProvider,
    },
  });
  const settledNow = result.count > 0;
  if (settledNow) {
    if (donation.campaignId) {
      try {
        await db.campaign.update({
          where: { id: donation.campaignId },
          data: { raisedAmount: { increment: donation.amount } },
        });
        await invalidateCampaigns();
        await invalidateStats();
      } catch {
        // campaign totals must never fail settlement
      }
    } else if (donation.causePostId) {
      // legacy community-cause donations target a CommunityPost
      try {
        await db.communityPost.update({
          where: { id: donation.causePostId },
          data: { raisedAmount: { increment: donation.amount } },
        });
      } catch {
        // cause post may be gone — donation still settles
      }
    }
    // Donor rewards — points row + charity card sync + achievements + push
    // + SSE feed (shared with the mobile app; lib/charity/settlement.ts).
    await settleDonationSideEffects({
      id: donation.id,
      donorId: donation.donorId,
      amount: donation.amount,
      campaignId: donation.campaignId,
    });
    // Recurring/pledge linkage — advance the parent's nextChargeAt when this
    // donation is a recurring installment, fold it into pledge tracking when
    // it pays a pledge installment (lib/recurring.ts; idempotent).
    try {
      await settleDonationCommitments(donation.id);
    } catch {
      // commitment tracking must never fail settlement
    }
    await logActivity(
      donation.donorName,
      "PAYMENT_VERIFIED",
      "DONATION",
      `${donation.receiptNumber} · ${patch.paymentProvider} payment ${patch.transactionId ?? ""}`
    );
    log.info("payment_settled", {
      donationId: donation.id,
      receiptNumber: donation.receiptNumber,
      amount: donation.amount,
      provider: patch.paymentProvider,
    });
  }
  const fresh = await db.donation.findUniqueOrThrow({ where: { id: donation.id } });
  if (settledNow) {
    // Live broadcast — gateway donations announce when the money actually
    // settles (same payload shape as the instant-completion broadcast in
    // routes/donations.ts).
    try {
      const campaign = fresh.campaignId
        ? await db.campaign.findUnique({
            where: { id: fresh.campaignId },
            select: { title: true },
          })
        : null;
      broadcastEvent("donation", {
        donorName: fresh.isAnonymous ? "Someone" : maskDonorName(fresh.donorName),
        amount: fresh.amount,
        currency: fresh.currency,
        campaignTitle: campaign?.title ?? null,
        receiptNumber: fresh.receiptNumber,
        at: fresh.createdAt,
      });
    } catch {
      // broadcast must never break settlement
    }
  }
  return { settled: donationView(fresh), settledNow };
}

function settleResponse(res: import("express").Response, settled: { receiptNumber: string; amount: number; currency: string; paymentStatus: string }, settledNow: boolean) {
  return json(res, { ok: true, ...(settledNow ? {} : { already: true }), donation: settled });
}

/** Same masking as the public donations wall (routes/donations.ts). */
function maskDonorName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const initial = parts[1]?.[0] ? ` ${parts[1][0]}.` : "";
  return `${first}${initial}`;
}

// POST /api/payments/verify — provider callback → settle the donation
router.post("/verify", async (req, res) => {
  try {
    const body = req.body ?? {};
    const cfg = gatewayConfig(await loadSettings());
    if (!cfg.enabled) {
      log.warn("payment_verify_blocked", { reason: "gateway_disabled" });
      throw new ApiError("Online payments are currently disabled. Please use UPI or pay offline.", 400);
    }

    /* ── Razorpay: { razorpay_order_id, razorpay_payment_id, razorpay_signature } ── */
    if (body?.razorpay_order_id && body?.razorpay_payment_id && body?.razorpay_signature) {
      if (cfg.provider !== "RAZORPAY") {
        log.warn("payment_verify_provider_mismatch", { requested: "RAZORPAY", configured: cfg.provider });
        throw new ApiError("Razorpay verification is unavailable — the configured gateway is another provider.", 400);
      }
      if (!cfg.keySecret) {
        log.warn("payment_verify_not_configured", { provider: "RAZORPAY" });
        throw new ApiError("Razorpay key secret is not configured — payment verification is impossible.", 400);
      }

      const orderId = String(body.razorpay_order_id);
      const paymentId = String(body.razorpay_payment_id);
      const signature = String(body.razorpay_signature);

      const donation = await db.donation.findFirst({ where: { gatewayOrderId: orderId } });
      if (!donation) {
        log.warn("payment_verify_not_found", { provider: "RAZORPAY", orderId });
        throw new ApiError("No donation was found for this payment reference.", 400);
      }
      if (donation.paymentStatus === "COMPLETED")
        return json(res, { ok: true, already: true, donation: donationView(donation) });
      if (donation.paymentStatus !== "PENDING") {
        log.warn("payment_verify_invalid_status", {
          donationId: donation.id,
          paymentStatus: donation.paymentStatus,
        });
        throw new ApiError(`This payment cannot be verified (status: ${donation.paymentStatus}).`, 400);
      }

      log.debug("payment_verify_razorpay_attempt", { donationId: donation.id, orderId });

      const expected = crypto
        .createHmac("sha256", cfg.keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");
      const expectedBuf = Buffer.from(expected, "utf8");
      const signatureBuf = Buffer.from(signature, "utf8");
      if (expectedBuf.length !== signatureBuf.length || !crypto.timingSafeEqual(expectedBuf, signatureBuf)) {
        // A client-supplied invalid signature is not evidence that the provider
        // failed the payment. Keep the donation PENDING so the rightful payer
        // can retry verification; only provider-confirmed failure may settle it.
        log.warn("payment_verify_signature_failed", { donationId: donation.id, orderId });
        throw new ApiError("Payment signature verification failed", 400);
      }

      const { settled, settledNow } = await settleCompleted(donation, {
        transactionId: paymentId,
        paymentProvider: "RAZORPAY",
      });
      return settleResponse(res, settled, settledNow);
    }

    /* ── Stripe: { sessionId } — poll the Checkout Session server-side ── */
    if (body?.sessionId) {
      if (cfg.provider !== "STRIPE") {
        log.warn("payment_verify_provider_mismatch", { requested: "STRIPE", configured: cfg.provider });
        throw new ApiError("Stripe verification is unavailable — the configured gateway is another provider.", 400);
      }
      if (!cfg.keySecret) {
        log.warn("payment_verify_not_configured", { provider: "STRIPE" });
        throw new ApiError("Stripe secret key is not configured — payment verification is impossible.", 400);
      }

      const sessionId = String(body.sessionId);
      const donation = await db.donation.findFirst({ where: { gatewayOrderId: sessionId } });
      if (!donation) {
        log.warn("payment_verify_not_found", { provider: "STRIPE", sessionId });
        throw new ApiError("No donation was found for this payment reference.", 400);
      }
      if (donation.paymentStatus === "COMPLETED")
        return json(res, { ok: true, already: true, donation: donationView(donation) });
      if (donation.paymentStatus !== "PENDING") {
        log.warn("payment_verify_invalid_status", {
          donationId: donation.id,
          paymentStatus: donation.paymentStatus,
        });
        throw new ApiError(`This payment cannot be verified (status: ${donation.paymentStatus}).`, 400);
      }

      log.debug("payment_verify_stripe_attempt", { donationId: donation.id, sessionId });

      let stripeRes: Response;
      try {
        stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
          headers: { Authorization: `Bearer ${cfg.keySecret}` },
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      } catch {
        throw new ApiError("Stripe could not be reached — please try again in a moment.", 502);
      }
      const session = (await stripeRes.json().catch(() => null)) as {
        id?: string;
        payment_status?: string;
        payment_intent?: string | null;
      } | null;
      if (!stripeRes.ok || !session) {
        log.warn("payment_verify_lookup_failed", {
          provider: "STRIPE",
          sessionId,
          status: stripeRes.status,
        });
        throw new ApiError(
          `Stripe session lookup failed (HTTP ${stripeRes.status}).`,
          stripeRes.status === 404 ? 400 : 502
        );
      }
      if (session.payment_status !== "paid") {
        log.warn("payment_verify_not_paid", {
          provider: "STRIPE",
          donationId: donation.id,
          sessionId,
        });
        throw new ApiError("Stripe reports this payment is not completed yet — please wait a moment and try again.", 400);
      }

      const { settled, settledNow } = await settleCompleted(donation, {
        transactionId: session.payment_intent ?? session.id ?? sessionId,
        paymentProvider: "STRIPE",
      });
      return settleResponse(res, settled, settledNow);
    }

    /* ── Cashfree: { orderId } — poll the order's payments server-side ── */
    if (body?.orderId) {
      if (cfg.provider !== "CASHFREE") {
        log.warn("payment_verify_provider_mismatch", { requested: "CASHFREE", configured: cfg.provider });
        throw new ApiError("Cashfree verification is unavailable — the configured gateway is another provider.", 400);
      }
      if (!cfg.cashfreeAppId || !cfg.keySecret) {
        log.warn("payment_verify_not_configured", { provider: "CASHFREE" });
        throw new ApiError("Cashfree app credentials are not configured — payment verification is impossible.", 400);
      }

      const orderId = String(body.orderId);
      const donation = await db.donation.findFirst({ where: { gatewayOrderId: orderId } });
      if (!donation) {
        log.warn("payment_verify_not_found", { provider: "CASHFREE", orderId });
        throw new ApiError("No donation was found for this payment reference.", 400);
      }
      if (donation.paymentStatus === "COMPLETED")
        return json(res, { ok: true, already: true, donation: donationView(donation) });
      if (donation.paymentStatus !== "PENDING") {
        log.warn("payment_verify_invalid_status", {
          donationId: donation.id,
          paymentStatus: donation.paymentStatus,
        });
        throw new ApiError(`This payment cannot be verified (status: ${donation.paymentStatus}).`, 400);
      }

      log.debug("payment_verify_cashfree_attempt", { donationId: donation.id, orderId });

      const base = cfg.testMode ? "https://sandbox.cashfree.com" : "https://api.cashfree.com";
      let cfRes: Response;
      try {
        cfRes = await fetch(`${base}/pg/orders/${encodeURIComponent(orderId)}/payments`, {
          headers: {
            "x-client-id": cfg.cashfreeAppId,
            "x-client-secret": cfg.keySecret,
            "x-api-version": "2023-08-01",
          },
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      } catch {
        throw new ApiError("Cashfree could not be reached — please try again in a moment.", 502);
      }
      const payments = (await cfRes.json().catch(() => null)) as Array<{
        cf_payment_id?: number | string;
        payment_status?: string;
      }> | null;
      if (!cfRes.ok || !Array.isArray(payments)) {
        log.warn("payment_verify_lookup_failed", {
          provider: "CASHFREE",
          orderId,
          status: cfRes.status,
        });
        throw new ApiError(`Cashfree payment lookup failed (HTTP ${cfRes.status}).`, cfRes.status === 404 ? 400 : 502);
      }
      const paid = payments.find((p) => p.payment_status === "SUCCESS");
      if (!paid) {
        log.warn("payment_verify_not_paid", {
          provider: "CASHFREE",
          donationId: donation.id,
          orderId,
        });
        throw new ApiError("Cashfree reports this payment is not completed yet — please wait a moment and try again.", 400);
      }

      const { settled, settledNow } = await settleCompleted(donation, {
        transactionId: paid.cf_payment_id != null ? String(paid.cf_payment_id) : orderId,
        paymentProvider: "CASHFREE",
      });
      return settleResponse(res, settled, settledNow);
    }

    log.warn("payment_verify_missing_fields");
    throw new ApiError("Missing payment confirmation fields — nothing to verify.", 400);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/payments/webhook — Razorpay server-to-server settlement
// (moved from the mobile compat router /razorpay/webhook). NO session auth:
// the Razorpay HMAC-SHA256 signature over the RAW request body is the auth
// (RAZORPAY_WEBHOOK_SECRET, falling back to RAZORPAY_KEY_SECRET). Settles
// async checkouts (donor closed the app before POST /verify) through the
// same settleCompleted pipeline the web verify uses — points/card/achievements
// included via lib/charity/settlement.ts.
router.post("/webhook", async (req, res) => {
  try {
    const signature = req.header("X-Razorpay-Signature") ?? "";
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      log.warn("payment_webhook_secret_missing");
      return res.status(400).json({ error: "Webhook secret not configured" });
    }

    // express.json() is configured with a `verify` callback in index.ts that
    // stashes the raw bytes — verify over those (fallback: the re-serialized
    // parsed body, byte-identical for Razorpay's compact JSON payloads).
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const hmacInput = rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const expected = crypto.createHmac("sha256", secret).update(hmacInput).digest("hex");
    const expectedBuf = Buffer.from(expected, "utf8");
    const signatureBuf = Buffer.from(signature, "utf8");
    if (
      expectedBuf.length !== signatureBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, signatureBuf)
    ) {
      log.warn("payment_webhook_signature_invalid");
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    const payload = (req.body ?? {}) as {
      event?: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string } } };
    };
    const event = payload.event ?? "";
    const entity = payload.payload?.payment?.entity;
    const paymentId = entity?.id ?? null;
    const orderId = entity?.order_id;

    log.debug("payment_webhook_received", { event, orderId: orderId ?? null });

    if ((event === "payment.authorized" || event === "payment.captured") && orderId) {
      const donation = await db.donation.findFirst({ where: { gatewayOrderId: orderId } });
      if (donation && donation.paymentStatus === "PENDING") {
        await settleCompleted(donation, {
          ...(paymentId ? { transactionId: paymentId } : {}),
          paymentProvider: "RAZORPAY",
        });
      }
    }

    if (event === "payment.failed" && orderId) {
      const donation = await db.donation.findFirst({ where: { gatewayOrderId: orderId } });
      if (donation && donation.paymentStatus === "PENDING") {
        await db.donation.update({ where: { id: donation.id }, data: { paymentStatus: "FAILED" } });
        log.info("payment_webhook_payment_failed", { donationId: donation.id, orderId });
      }
    } else if (event !== "payment.authorized" && event !== "payment.captured") {
      log.debug("payment_webhook_ignored", { event });
    }

    return res.json({ ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
