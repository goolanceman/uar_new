/**
 * Mobile Causes → Campaigns (vitest + supertest).
 *
 * The mobile Causes feature consumes the SAME endpoints as the public website
 * (frontend/src/components/public/campaigns.tsx + donate.tsx):
 *   GET  /api/campaigns          — list (non-DRAFT only)
 *   GET  /api/campaigns/:id      — detail (id or slug)
 *   POST /api/donations          — PENDING Donation with campaignId
 *   POST /api/payments           — gateway order (errors must reach the app)
 *   POST /api/payments/verify    — settle (HMAC contract)
 *   GET  /api/donations?mine=1   — mobile donation history (session)
 *
 * Mobile requests carry `apikey: test` (mobileGate) and fall through the
 * mobile compat router to these routers, mounted like src/index.ts.
 * Only touches rows it creates (unique prefixes; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";

const PREFIX = `mct-${Date.now()}`;
const KEY_ID = `${PREFIX}-key`;
const KEY_SECRET = `${PREFIX}-secret`;

let app: express.Express;
let me: { id: string; email: string };
let activeCampaignId: string;
let draftCampaignId: string;
let receiptNumber: string;
let donationId: string;
let authToken: string;

async function buildApp() {
  const { router: mobileRouter } = await import("@/routes/mobile");
  const { router: campaignsRouter } = await import("@/routes/campaigns");
  const { router: donationsRouter } = await import("@/routes/donations");
  const { router: paymentsRouter } = await import("@/routes/payments");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  // same order AND same gate placement as src/index.ts: the apikey gate lives
  // OUTSIDE the compat router so non-apikey requests never reach it
  a.use("/api", (req, res, next) => {
    if (!req.header("apikey")) return next();
    return mobileRouter(req, res, next);
  });
  a.use("/api/auth", authRouter);
  a.use("/api/campaigns", campaignsRouter);
  a.use("/api/donations", donationsRouter);
  a.use("/api/payments", paymentsRouter);
  return a;
}

/** Mobile-style call: apikey header like ApiService/NewApiService. */
function mget(path: string) {
  return request(app).get(`/api/${path}`).set("apikey", "test");
}
function mpost(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).post(`/api/${path}`).set("apikey", "test");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

async function setSetting(key: string, value: string) {
  const { db } = await import("@/lib/db");
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function cleanup() {
  const { db } = await import("@/lib/db");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  // donations are found via donorName prefix (server-generated receipt numbers
  // carry no prefix; guest-created rows have donorId null)
  await db.donation.deleteMany({ where: { donorName: { startsWith: PREFIX } } });
  await db.donor.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await db.campaign.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.setting.deleteMany({ where: { key: { startsWith: "finance.gateway" } } });
  await db.setting.deleteMany({ where: { key: { startsWith: "finance.razorpayKeyId" } } });
  await db.activityLog.deleteMany({ where: { details: { contains: PREFIX } } });
  if (ids.length) await db.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/lib/db");

  me = await db.user.create({
    data: { email: `${PREFIX}-me@test.local`, name: `${PREFIX} donor`, password: "test-1234" },
  });
  const meEmail = `${PREFIX}-me@test.local`;

  const active = await db.campaign.create({
    data: {
      code: `${PREFIX}-CMP-1`,
      title: `${PREFIX} mobile campaign`,
      slug: `${PREFIX}-mobile-campaign`,
      description: "visible on the website and in the app",
      category: "MEDICAL",
      targetAmount: 100000,
      raisedAmount: 0,
      status: "ACTIVE",
      featured: true,
      urgent: true,
      endDate: new Date(Date.now() + 30 * 864e5),
    },
  });
  activeCampaignId = active.id;
  const draft = await db.campaign.create({
    data: {
      code: `${PREFIX}-CMP-2`,
      title: `${PREFIX} draft campaign`,
      slug: `${PREFIX}-draft-campaign`,
      description: "admin draft — hidden from the website and the app",
      category: "GENERAL",
      targetAmount: 50000,
      status: "DRAFT",
    },
  });
  draftCampaignId = draft.id;

  // Gateway enabled with NO keys — the local dev reality (order creation must
  // fail with the backend's message so the app can show it).
  await setSetting("finance.gatewayEnabled", "true");
  await setSetting("finance.gatewayProvider", "RAZORPAY");
  await setSetting("finance.razorpayKeyId", "");
  await setSetting("finance.gatewayKeySecret", "");

  // the mobile app logs in like the website does and sends the bearer token
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: meEmail, password: "test-1234" });
  expect(login.status).toBe(200);
  authToken = login.body.token;
  expect(authToken).toBeTruthy();
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

// ═══════════════════════ LIST — website parity ═══════════════════════
describe("GET /api/campaigns (mobile apikey falls through to the website router)", () => {
  it("returns exactly the website-visible campaigns (no DRAFTs)", async () => {
    const res = await mget("campaigns");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const list = res.body as Array<Record<string, unknown>>;
    const mine = list.filter((c) => String(c.code).startsWith(PREFIX));
    expect(mine).toHaveLength(1); // the DRAFT never leaks
    expect(mine[0].id).toBe(activeCampaignId);
    expect(mine[0].status).toBe("ACTIVE");
    // website parity: string cuid ids + supporterCount projection
    expect(typeof mine[0].id).toBe("string");
    expect(mine[0]).toHaveProperty("supporterCount", 0);
    expect(mine[0].title).toBe(`${PREFIX} mobile campaign`);
  });

  it("GET /api/campaigns/:id returns the detail by id and by slug", async () => {
    const byId = await mget(`campaigns/${activeCampaignId}`);
    expect(byId.status).toBe(200);
    expect(byId.body.id).toBe(activeCampaignId);
    expect(byId.body.urgent).toBe(true);
    expect(byId.body.targetAmount).toBe(100000);

    const bySlug = await mget(`campaigns/${encodeURIComponent(`${PREFIX}-mobile-campaign`)}`);
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.id).toBe(activeCampaignId); // slug fallback like the website
  });
});

// ═══════════════════════ DONATION ORDER ═══════════════════════
describe("POST /api/donations + /api/payments — the website pipeline", () => {
  it("creates the same PENDING campaign donation the website creates", async () => {
    const res = await mpost(
      "donations",
      {
        amount: 500,
        campaignId: activeCampaignId,
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-me@test.local`,
        paymentMethod: "RAZORPAY",
        message: "from the mobile app",
      },
      authToken
    );
    expect(res.status).toBe(201);
    expect(res.body.campaignId).toBe(activeCampaignId);
    expect(res.body.donorId).toBe(me.id); // linked like a website session donation
    expect(res.body.paymentStatus).toBe("PENDING");
    expect(res.body.receiptNumber).toMatch(/^UAR-RCPT-/);
    expect(res.body.checkoutPending).toBe(true);
    receiptNumber = res.body.receiptNumber;
    donationId = res.body.id;
  });

  it("surfaces the backend's gateway-not-configured message (no keys locally)", async () => {
    const res = await mpost("payments", { receiptNumber });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not configured");
  });
});

// ═══════════════════════ VERIFY CONTRACT ═══════════════════════
describe("POST /api/payments/verify — website contract, mobile caller", () => {
  it("settles with a valid Razorpay HMAC signature and bumps the campaign total", async () => {
    const { db } = await import("@/lib/db");
    await setSetting("finance.razorpayKeyId", KEY_ID);
    await setSetting("finance.gatewayKeySecret", KEY_SECRET);
    // simulate the order step (real one calls Razorpay; not needed for verify)
    await db.donation.update({
      where: { id: donationId },
      data: { gatewayOrderId: `order_${PREFIX}_1` },
    });

    const paymentId = `pay_${PREFIX}_1`;
    const signature = crypto
      .createHmac("sha256", KEY_SECRET)
      .update(`order_${PREFIX}_1|${paymentId}`)
      .digest("hex");

    const res = await mpost(
      "payments/verify",
      {
        razorpay_order_id: `order_${PREFIX}_1`,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      },
      authToken
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.donation.paymentStatus).toBe("COMPLETED");

    const campaign = await db.campaign.findUnique({ where: { id: activeCampaignId } });
    expect(campaign?.raisedAmount).toBe(500);
  });

  it("rejects a bad signature and keeps the donation unpaid", async () => {
    const { db } = await import("@/lib/db");
    const d2 = await db.donation.create({
      data: {
        donorId: me.id,
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-me@test.local`,
        amount: 250,
        currency: "INR",
        type: "ONE_TIME",
        paymentMethod: "RAZORPAY",
        paymentStatus: "PENDING",
        receiptNumber: `UAR-RCPT-${PREFIX}-2`,
        campaignId: activeCampaignId,
        gatewayOrderId: `order_${PREFIX}_2`,
      },
    });

    const res = await mpost("payments/verify", {
      razorpay_order_id: `order_${PREFIX}_2`,
      razorpay_payment_id: "pay_bad",
      razorpay_signature: "deadbeef",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("signature");

    const row = await db.donation.findUnique({ where: { id: d2.id } });
    expect(row?.paymentStatus).toBe("PENDING"); // not evidence of failure — retryable
    await db.donation.delete({ where: { id: d2.id } });
  });

  it("replays idempotently ({ ok, already }) once COMPLETED", async () => {
    const paymentId = `pay_${PREFIX}_1`;
    const signature = crypto
      .createHmac("sha256", KEY_SECRET)
      .update(`order_${PREFIX}_1|${paymentId}`)
      .digest("hex");
    const res = await mpost(
      "payments/verify",
      {
        razorpay_order_id: `order_${PREFIX}_1`,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      },
      authToken
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.already).toBe(true);
  });
});

// ═══════════════════════ MOBILE DONATION HISTORY ═══════════════════════
describe("GET /api/donations?mine=1 — mobile donation history", () => {
  it("rejects mine=1 without a session (history is private)", async () => {
    const anon = await mget("donations?mine=1");
    expect(anon.status).toBe(401);
  });

  it("returns only my donations with their campaign", async () => {
    const { db } = await import("@/lib/db");
    const other = await db.user.create({
      data: { email: `${PREFIX}-other@test.local`, name: `${PREFIX} other`, password: "test-1234" },
    });
    await db.donation.create({
      data: {
        donorId: other.id,
        donorName: `${PREFIX} other`,
        donorEmail: `${PREFIX}-other@test.local`,
        amount: 999,
        currency: "INR",
        type: "ONE_TIME",
        paymentMethod: "UPI",
        paymentStatus: "COMPLETED",
        receiptNumber: `UAR-RCPT-${PREFIX}-3`,
        campaignId: activeCampaignId,
      },
    });

    const res = await mget("donations?mine=1").set("Authorization", `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    expect(list.every((d) => d.donorId === me.id)).toBe(true);
    expect(list.some((d) => d.receiptNumber === receiptNumber)).toBe(true);
    const completed = list.find((d) => d.paymentStatus === "COMPLETED");
    expect((completed?.campaign as { title: string } | undefined)?.title).toBe(
      `${PREFIX} mobile campaign`
    );
  });
});
