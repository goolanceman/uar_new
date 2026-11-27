/**
 * Payments — /api/payments (vitest + supertest, integration style).
 *
 * The local environment has NO Razorpay keys (RAZORPAY_KEY_SECRET empty), so
 * the legitimate contract here is the "gateway not configured/disabled" 400
 * path for order creation, and for /verify: the not-configured 400, the
 * bad-signature 400, the idempotent replay and the missing-fields 400. The
 * webhook contract (env-secret HMAC over the RAW body) is covered too.
 * No real Razorpay calls are attempted anywhere.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `tpy-${Date.now()}`;
const PASSWORD = "Passw0rd!";
const WEBHOOK_SECRET = `${PREFIX}-whsec`;

let app: express.Express;
let donorToken: string;
let donorId: string;
let campaignId: string;

let razorReceipt: string; // PENDING RAZORPAY donation (order-creation paths)
let razorOrderId: string; // gateway order id stamped on it
let upiReceipt: string; // COMPLETED UPI donation (already-paid path)
let cashReceipt: string; // PENDING CASH donation (offline path)
let webhookDonationId: string; // PENDING donation settled by the webhook

async function buildApp() {
  const { router: paymentsRouter } = await import("@/routes/payments");
  const { router: donationsRouter } = await import("@/routes/donations");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  // mirror src/index.ts: stash the raw bytes for webhook HMAC verification
  a.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/donations", donationsRouter);
  a.use("/api/payments", paymentsRouter);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

function post(path: string, body?: Record<string, unknown>, headers?: Record<string, string>) {
  const r = request(app).post(`/api/${path}`);
  if (headers) for (const [k, v] of Object.entries(headers)) r.set(k, v);
  return r.send(body ?? {});
}
async function setSetting(key: string, value: string) {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function cleanup() {
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  const { db } = await import("@/infrastructure/database/prisma");
  await db.donation.deleteMany({ where: { donorEmail: { startsWith: PREFIX } } });
  await db.donor.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await db.campaign.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.donationPoint.deleteMany({ where: { userId: donorId } });
  await db.notification.deleteMany({ where: { userId: donorId } });
  await db.setting.deleteMany({ where: { key: { startsWith: "finance.gateway" } } });
  await db.setting.deleteMany({ where: { key: { startsWith: "finance.razorpayKeyId" } } });
  await db.activityLog.deleteMany({
    where: { OR: [{ actorName: { startsWith: PREFIX } }, { details: { contains: PREFIX } }] },
  });
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");

  const donor = await db.user.create({
    data: { email: `${PREFIX}-donor@test.local`, name: `${PREFIX} donor`, password: PASSWORD, role: "DONOR" },
  });
  donorId = donor.id;

  const campaign = await db.campaign.create({
    data: {
      code: `${PREFIX}-CMP`,
      title: `${PREFIX} campaign`,
      slug: `${PREFIX}-campaign`,
      description: "payments integration suite",
      category: "GENERAL",
      targetAmount: 10000,
      status: "ACTIVE",
      createdBy: donor.id,
    },
  });
  campaignId = campaign.id;

  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: `${PREFIX}-donor@test.local`, password: PASSWORD });
  donorToken = login.body.token;

  // PENDING gateway donation (the checkout pipeline's entry state)
  const razor = await post(
    "donations",
    { amount: 500, campaignId, paymentMethod: "RAZORPAY" },
    { Authorization: `Bearer ${donorToken}` }
  );
  expect(razor.status).toBe(201);
  razorReceipt = razor.body.receiptNumber;
  razorOrderId = `order_${PREFIX}_1`;
  await db.donation.update({ where: { id: razor.body.id }, data: { gatewayOrderId: razorOrderId } });

  // already-paid donation
  const upi = await post("donations", {
    amount: 50,
    donorName: `${PREFIX} upi`,
    donorEmail: `${PREFIX}-upi@test.local`,
    paymentMethod: "UPI",
  });
  upiReceipt = upi.body.receiptNumber;

  // offline PENDING donation
  const cash = await post("donations", {
    amount: 75,
    donorName: `${PREFIX} cash`,
    donorEmail: `${PREFIX}-cash@test.local`,
    paymentMethod: "CASH",
  });
  cashReceipt = cash.body.receiptNumber;

  // a second PENDING razorpay donation the webhook will settle
  const wh = await post(
    "donations",
    { amount: 300, campaignId, paymentMethod: "RAZORPAY" },
    { Authorization: `Bearer ${donorToken}` }
  );
  webhookDonationId = wh.body.id;
  await db.donation.update({
    where: { id: webhookDonationId },
    data: { gatewayOrderId: `order_${PREFIX}_wh` },
  });

  // Gateway enabled with NO keys — the local dev reality.
  await setSetting("finance.gatewayEnabled", "true");
  await setSetting("finance.gatewayProvider", "RAZORPAY");
  await setSetting("finance.razorpayKeyId", "");
  await setSetting("finance.gatewayKeySecret", "");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ─── POST /api/payments — order creation ─────────────────────────────────────
describe("POST /api/payments — gateway order creation", () => {
  it("requires the receipt number", async () => {
    const res = await post("payments", {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("A donation receipt number is required");
  });

  it("404 for an unknown receipt number", async () => {
    const res = await post("payments", { receiptNumber: `UAR-RCPT-${PREFIX}-missing` });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("No donation found for this receipt number");
  });

  it("400 when the donation is already paid", async () => {
    const res = await post("payments", { receiptNumber: upiReceipt });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("already been paid");
  });

  it("400 for non-gateway (offline) payment methods", async () => {
    const res = await post("payments", { receiptNumber: cashReceipt });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This donation is not set up for online gateway payment.");
  });

  it("400 when the gateway is disabled", async () => {
    await setSetting("finance.gatewayEnabled", "false");
    const res = await post("payments", { receiptNumber: razorReceipt });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Online payments are currently disabled. Please use UPI or pay offline.");
    await setSetting("finance.gatewayEnabled", "true");
  });

  it("400 naming the missing credentials when the gateway has no keys (local contract)", async () => {
    const res = await post("payments", { receiptNumber: razorReceipt });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Razorpay key ID and Razorpay key secret are not configured — online payments cannot start. Please use UPI or pay offline."
    );
  });
});

// ─── POST /api/payments/verify ───────────────────────────────────────────────
describe("POST /api/payments/verify", () => {
  it("400 when no provider fields are present", async () => {
    const res = await post("payments/verify", {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing payment confirmation fields — nothing to verify.");
  });

  it("400 when the gateway is disabled", async () => {
    await setSetting("finance.gatewayEnabled", "false");
    const res = await post("payments/verify", {
      razorpay_order_id: razorOrderId,
      razorpay_payment_id: `pay_${PREFIX}_1`,
      razorpay_signature: "deadbeef",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Online payments are currently disabled. Please use UPI or pay offline.");
    await setSetting("finance.gatewayEnabled", "true");
  });

  it("400 (not configured) when the Razorpay key secret is empty", async () => {
    const res = await post("payments/verify", {
      razorpay_order_id: razorOrderId,
      razorpay_payment_id: `pay_${PREFIX}_1`,
      razorpay_signature: "deadbeef",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Razorpay key secret is not configured — payment verification is impossible.");
  });

  it("400 for an unknown gateway order id", async () => {
    await setSetting("finance.razorpayKeyId", `${PREFIX}-kid`);
    await setSetting("finance.gatewayKeySecret", `${PREFIX}-ksec`);
    const res = await post("payments/verify", {
      razorpay_order_id: `order_${PREFIX}_missing`,
      razorpay_payment_id: `pay_${PREFIX}_x`,
      razorpay_signature: "deadbeef",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No donation was found for this payment reference.");
  });

  it("400 on a bad signature and the donation stays PENDING (retryable)", async () => {
    const res = await post("payments/verify", {
      razorpay_order_id: razorOrderId,
      razorpay_payment_id: `pay_${PREFIX}_1`,
      razorpay_signature: "deadbeef",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Payment signature verification failed");

    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.donation.findFirst({ where: { gatewayOrderId: razorOrderId } });
    expect(row?.paymentStatus).toBe("PENDING"); // not evidence of failure — retryable
  });

  it("settles with the correct HMAC and bumps the campaign total", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const paymentId = `pay_${PREFIX}_1`;
    const signature = crypto
      .createHmac("sha256", `${PREFIX}-ksec`)
      .update(`${razorOrderId}|${paymentId}`)
      .digest("hex");

    const res = await post("payments/verify", {
      razorpay_order_id: razorOrderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.already).toBeUndefined(); // settled now
    expect(res.body.donation).toMatchObject({
      receiptNumber: razorReceipt,
      paymentStatus: "COMPLETED",
    });

    const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.raisedAmount).toBe(500);

    const row = await db.donation.findFirst({ where: { gatewayOrderId: razorOrderId } });
    expect(row?.receiptStatus).toBe("ISSUED"); // receipt invariant
  });

  it("replays idempotently ({ ok, already }) once COMPLETED", async () => {
    const paymentId = `pay_${PREFIX}_1`;
    const signature = crypto
      .createHmac("sha256", `${PREFIX}-ksec`)
      .update(`${razorOrderId}|${paymentId}`)
      .digest("hex");
    const res = await post("payments/verify", {
      razorpay_order_id: razorOrderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.already).toBe(true);
  });
});

// ─── POST /api/payments/webhook ──────────────────────────────────────────────
describe("POST /api/payments/webhook — raw-body HMAC contract", () => {
  const payload = (event: string, orderId: string, paymentId?: string) => ({
    event,
    payload: { payment: { entity: { id: paymentId ?? `pay_${PREFIX}_wh`, order_id: orderId } } },
  });

  it("400 when no webhook secret is configured (env unset)", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const res = await post("payments/webhook", payload("payment.captured", `order_${PREFIX}_wh`));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Webhook secret not configured");
  });

  it("400 on an invalid signature", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const res = await post(
      "payments/webhook",
      payload("payment.captured", `order_${PREFIX}_wh`),
      { "X-Razorpay-Signature": "deadbeef" }
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid webhook signature");
  });

  it("settles a PENDING donation on a signed payment.captured event", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const body = payload("payment.captured", `order_${PREFIX}_wh`, `pay_${PREFIX}_wh1`);
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");

    const res = await post("payments/webhook", body, { "X-Razorpay-Signature": signature });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.donation.findUnique({ where: { id: webhookDonationId } });
    expect(row?.paymentStatus).toBe("COMPLETED");
    expect(row?.transactionId).toBe(`pay_${PREFIX}_wh1`);
    expect(row?.receiptStatus).toBe("ISSUED");

    const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.raisedAmount).toBe(800); // 500 (verify) + 300 (webhook)
  });

  it("marks the donation FAILED on a signed payment.failed event", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const failed = await post(
      "donations",
      { amount: 120, campaignId, paymentMethod: "RAZORPAY" },
      { Authorization: `Bearer ${donorToken}` }
    );
    const failedId = failed.body.id;
    const orderId = `order_${PREFIX}_fail`;
    await db.donation.update({ where: { id: failedId }, data: { gatewayOrderId: orderId } });

    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const body = payload("payment.failed", orderId);
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    const res = await post("payments/webhook", body, { "X-Razorpay-Signature": signature });
    expect(res.status).toBe(200);

    const row = await db.donation.findUnique({ where: { id: failedId } });
    expect(row?.paymentStatus).toBe("FAILED");
  });

  it("ignores signed non-payment events without touching anything", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const body = { event: "subscription.charged", payload: {} };
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    const res = await post("payments/webhook", body, { "X-Razorpay-Signature": signature });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
