/**
 * Recurring donations + pledges pipeline (vitest + supertest).
 *
 * Covers Phase 7 through the GENERIC APIs (no mobile-only endpoints):
 *   POST /api/donations                 — RECURRING commitment + linked installments
 *   GET  /api/donations/recurring/mine  — owner-scoped commitment list
 *   PATCH /api/donations/recurring/:id  — pause/resume/cancel ownership (403 others)
 *   POST /api/payments/verify           — installment settlement advances nextChargeAt
 *   POST /api/causes/:id/pledges        — pledge creation (with startDate)
 *   GET  /api/pledges/mine + /:id      — schedule math, payments, remaining
 *   POST /api/donations (pledgeId)      — pledge installments → auto-COMPLETED
 *
 * Only touches rows it creates (unique prefixes; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";

const PREFIX = `mrc-${Date.now()}`;
const KEY_ID = `${PREFIX}-key`;
const KEY_SECRET = `${PREFIX}-secret`;

let app: express.Express;
let me: { id: string; email: string };
let other: { id: string; email: string };
let authToken: string;
let otherToken: string;
let campaignId: string;
let causeId: string;

let recurringId: string;
let oldNextChargeAt: string;

async function buildApp() {
  const { router: donationsRouter } = await import("@/routes/donations");
  const { router: paymentsRouter } = await import("@/routes/payments");
  const { router: pledgesRouter } = await import("@/routes/pledges");
  const { router: causesRouter } = await import("@/routes/causes");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/donations", donationsRouter);
  a.use("/api/payments", paymentsRouter);
  a.use("/api/causes", causesRouter);
  a.use("/api/pledges", pledgesRouter);
  return a;
}

function mget(path: string) {
  return request(app).get(`/api/${path}`);
}
function mpost(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).post(`/api/${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function mpatch(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

async function setSetting(key: string, value: string) {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Rough "about n calendar months away" check (day-of-month clamping). */
function aboutMonthsAhead(iso: string | null | undefined, months: number, from: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso).getTime();
  const lo = new Date(from.getTime()).setMonth(from.getMonth() + months) - 3 * 86400000;
  const hi = new Date(from.getTime()).setMonth(from.getMonth() + months) + 3 * 86400000;
  return d > lo && d < hi;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.donation.deleteMany({ where: { donorName: { startsWith: PREFIX } } });
  await db.pledge.deleteMany({ where: { donorName: { startsWith: PREFIX } } });
  await db.cause.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.campaign.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.donor.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await db.setting.deleteMany({ where: { key: { startsWith: "finance.gateway" } } });
  await db.setting.deleteMany({ where: { key: { startsWith: "finance.razorpayKeyId" } } });
  await db.activityLog.deleteMany({ where: { details: { contains: PREFIX } } });
  const users = await db.user.findMany({
    where: { email: { startsWith: PREFIX } },
    select: { id: true },
  });
  if (users.length) await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");

  me = await db.user.create({
    data: { email: `${PREFIX}-me@test.local`, name: `${PREFIX} donor`, password: `${PREFIX}-pw` },
  });
  other = await db.user.create({
    data: { email: `${PREFIX}-other@test.local`, name: `${PREFIX} other`, password: `${PREFIX}-pw` },
  });

  const campaign = await db.campaign.create({
    data: {
      code: `${PREFIX}-CMP-1`,
      title: `${PREFIX} recurring campaign`,
      slug: `${PREFIX}-recurring-campaign`,
      description: "monthly giving target",
      category: "MEDICAL",
      targetAmount: 100000,
      status: "ACTIVE",
    },
  });
  campaignId = campaign.id;

  const cause = await db.cause.create({
    data: {
      code: `${PREFIX}-MED-1`,
      patientName: `${PREFIX} patient`,
      age: 42,
      city: "Bengaluru",
      condition: "DIABETES",
      monthlyCost: 400,
      durationMonths: 12,
      story: "test cause",
    },
  });
  causeId = cause.id;

  await setSetting("finance.gatewayEnabled", "true");
  await setSetting("finance.gatewayProvider", "RAZORPAY");
  await setSetting("finance.razorpayKeyId", KEY_ID);
  await setSetting("finance.gatewayKeySecret", KEY_SECRET);

  for (const [u, t] of [
    [me, "authToken"],
    [other, "otherToken"],
  ] as const) {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: u.email, password: `${PREFIX}-pw` });
    expect(login.status).toBe(200);
    if (t === "authToken") authToken = login.body.token;
    else otherToken = login.body.token;
  }
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ═══════════ RECURRING COMMITMENTS ═══════════
describe("POST /api/donations — recurring commitment with frequency", () => {
  it("creates an ACTIVE RECURRING commitment with the requested frequency and nextChargeAt", async () => {
    const res = await mpost(
      "donations",
      {
        amount: 500,
        type: "RECURRING",
        recurringFrequency: "QUARTERLY",
        campaignId,
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-me@test.local`,
        paymentMethod: "UPI",
      },
      authToken
    );
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("RECURRING");
    expect(res.body.recurringFrequency).toBe("QUARTERLY");
    expect(res.body.recurringStatus).toBe("ACTIVE");
    expect(aboutMonthsAhead(res.body.nextChargeAt, 3, new Date())).toBe(true);
    recurringId = res.body.id;
    oldNextChargeAt = res.body.nextChargeAt;
  });

  it("rejects an unsupported frequency (backend-owned validation)", async () => {
    const res = await mpost(
      "donations",
      {
        amount: 100,
        type: "RECURRING",
        recurringFrequency: "DAILY",
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-me@test.local`,
        paymentMethod: "UPI",
      },
      authToken
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/donations/recurring/mine — owner-scoped commitments", () => {
  it("requires a session", async () => {
    const res = await mget("donations/recurring/mine");
    expect(res.status).toBe(401);
  });

  it("lists my commitment with status, frequency, amount, campaign and nextChargeAt", async () => {
    const res = await mget("donations/recurring/mine").set("Authorization", `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    const mine = (res.body as Array<Record<string, unknown>>).find((c) => c.id === recurringId);
    expect(mine).toBeTruthy();
    expect(mine?.recurringStatus).toBe("ACTIVE");
    expect(mine?.recurringFrequency).toBe("QUARTERLY");
    expect(mine?.amount).toBe(500);
    expect((mine?.campaign as { title?: string } | undefined)?.title).toBe(
      `${PREFIX} recurring campaign`
    );
    expect(mine?.installmentCount).toBe(0);
    expect(Array.isArray(mine?.installments)).toBe(true);
  });

  it("never lists another donor's commitments", async () => {
    const res = await mget("donations/recurring/mine").set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(200);
    expect((res.body as Array<{ id: string }>).some((c) => c.id === recurringId)).toBe(false);
  });
});

describe("PATCH /api/donations/recurring/:id — pause/resume/cancel", () => {
  it("403s for a different donor", async () => {
    const res = await mpatch(
      `donations/recurring/${recurringId}`,
      { recurringStatus: "PAUSED" },
      otherToken
    );
    expect(res.status).toBe(403);
  });

  it("pauses, resumes and cancels for the owner", async () => {
    const pause = await mpatch(
      `donations/recurring/${recurringId}`,
      { recurringStatus: "PAUSED" },
      authToken
    );
    expect(pause.status).toBe(200);
    expect(pause.body.recurringStatus).toBe("PAUSED");

    const resume = await mpatch(
      `donations/recurring/${recurringId}`,
      { recurringStatus: "ACTIVE" },
      authToken
    );
    expect(resume.status).toBe(200);
    expect(resume.body.recurringStatus).toBe("ACTIVE");

    const cancel = await mpatch(
      `donations/recurring/${recurringId}`,
      { recurringStatus: "CANCELLED" },
      authToken
    );
    expect(cancel.status).toBe(200);
    expect(cancel.body.recurringStatus).toBe("CANCELLED");
  });

  it("treats CANCELLED as terminal", async () => {
    const res = await mpatch(
      `donations/recurring/${recurringId}`,
      { recurringStatus: "ACTIVE" },
      authToken
    );
    expect(res.status).toBe(400);
  });

  it("updates amount and frequency", async () => {
    const fresh = await mpost(
      "donations",
      {
        amount: 300,
        type: "RECURRING",
        recurringFrequency: "MONTHLY",
        campaignId,
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-me@test.local`,
        paymentMethod: "UPI",
      },
      authToken
    );
    expect(fresh.status).toBe(201);
    const res = await mpatch(
      `donations/recurring/${fresh.body.id}`,
      { amount: 750, recurringFrequency: "YEARLY" },
      authToken
    );
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(750);
    expect(res.body.recurringFrequency).toBe("YEARLY");
  });
});

describe("recurring installments — link + nextChargeAt advance", () => {
  let orderId: string;
  let installmentReceipt: string;

  it("403s when another donor tries to pay my installment", async () => {
    const parent = await mpost(
      "donations",
      {
        amount: 500,
        type: "RECURRING",
        recurringFrequency: "MONTHLY",
        campaignId,
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-me@test.local`,
        paymentMethod: "UPI",
      },
      authToken
    );
    expect(parent.status).toBe(201);
    const res = await mpost(
      "donations",
      {
        amount: 500,
        recurringParentId: parent.body.id,
        donorName: `${PREFIX} other`,
        donorEmail: `${PREFIX}-other@test.local`,
        paymentMethod: "UPI",
      },
      otherToken
    );
    expect(res.status).toBe(403);
  });

  it("rejects a cancelled parent", async () => {
    // recurringId was cancelled above — a new donor attempt against it fails
    const res = await mpost(
      "donations",
      {
        amount: 500,
        recurringParentId: recurringId,
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-me@test.local`,
        paymentMethod: "UPI",
      },
      authToken
    );
    expect(res.status).toBe(400);
  });

  it("settles a linked installment via /api/payments/verify and advances nextChargeAt", async () => {
    const parent = await mpost(
      "donations",
      {
        amount: 500,
        type: "RECURRING",
        recurringFrequency: "QUARTERLY",
        campaignId,
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-me@test.local`,
        paymentMethod: "UPI",
      },
      authToken
    );
    expect(parent.status).toBe(201);
    recurringId = parent.body.id;
    oldNextChargeAt = parent.body.nextChargeAt;

    const installment = await mpost(
      "donations",
      {
        amount: 500,
        recurringParentId: recurringId,
        paymentMethod: "RAZORPAY",
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-me@test.local`,
      },
      authToken
    );
    expect(installment.status).toBe(201);
    expect(installment.body.type).toBe("RECURRING");
    expect(installment.body.recurringFrequency).toBe("QUARTERLY"); // inherited
    expect(installment.body.recurringStatus).toBeNull(); // installments are not commitments
    expect(installment.body.paymentStatus).toBe("PENDING");
    installmentReceipt = installment.body.receiptNumber;

    // simulate the gateway order step (real one calls Razorpay)
    const { db } = await import("@/infrastructure/database/prisma");
    orderId = `order_${PREFIX}_inst1`;
    await db.donation.update({
      where: { receiptNumber: installmentReceipt },
      data: { gatewayOrderId: orderId },
    });

    const paymentId = `pay_${PREFIX}_inst1`;
    const signature = crypto
      .createHmac("sha256", KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    const verify = await mpost("payments/verify", {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    });
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(true);

    // the installment appears on the commitment AND nextChargeAt advanced
    const mine = await mget("donations/recurring/mine").set("Authorization", `Bearer ${authToken}`);
    const c = (mine.body as Array<Record<string, unknown>>).find((x) => x.id === recurringId);
    expect(c?.installmentCount).toBe(1);
    expect(c?.paidTotal).toBe(500);
    const advanced = new Date(String(c?.nextChargeAt)).getTime();
    const oldBase = new Date(oldNextChargeAt).getTime();
    // max(nextChargeAt, installment.createdAt) + 3 calendar months → the next
    // due moves one period past the CURRENT due (no late-payment drift)
    expect(advanced).toBeGreaterThan(oldBase);
    const expected = new Date(oldBase);
    expected.setMonth(expected.getMonth() + 3);
    expect(Math.abs(advanced - expected.getTime())).toBeLessThan(3 * 86400000);
  });
});

// ═══════════ PLEDGES ═══════════
describe("POST /api/causes/:id/pledges + GET /api/pledges/mine — schedule math", () => {
  let pledgeId: string;

  it("creates a pledge honouring startDate", async () => {
    const start = new Date();
    start.setUTCDate(1);
    const res = await mpost(
      `causes/${causeId}/pledges`,
      {
        amountPerMonth: 100,
        months: 2,
        startDate: start.toISOString().slice(0, 10),
        donorName: `${PREFIX} donor`,
      },
      authToken
    );
    expect(res.status).toBe(201);
    expect(res.body.pledge.donorId).toBe(me.id);
    expect(new Date(res.body.pledge.startDate).getUTCMonth()).toBe(start.getUTCMonth());
    pledgeId = res.body.pledge.id;
  });

  it("lists my pledge with committed/paid/remaining and month-by-month schedule", async () => {
    const res = await mget("pledges/mine").set("Authorization", `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    const p = (res.body as Array<Record<string, unknown>>).find((x) => x.id === pledgeId);
    expect(p).toBeTruthy();
    expect(p?.totalCommitted).toBe(200);
    expect(p?.paymentsMade).toBe(0);
    expect(p?.remaining).toBe(200);
    expect(p?.paymentCount).toBe(0);
    expect((p?.schedule as unknown[]).length).toBe(2);
    expect(p?.nextDueAt).toBeTruthy();
    expect((p?.cause as { code?: string }).code).toBe(`${PREFIX}-MED-1`);
  });

  it("403s another donor from viewing my pledge detail", async () => {
    const res = await mget(`pledges/${pledgeId}`).set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it("shows my pledge detail to me (owner)", async () => {
    const res = await mget(`pledges/${pledgeId}`).set("Authorization", `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(pledgeId);
    expect(Array.isArray(res.body.installments)).toBe(true);
  });

  it("pays installments via POST /api/donations and auto-COMPLETES the pledge when fully paid", async () => {
    const first = await mpost(
      "donations",
      {
        amount: 100,
        pledgeId,
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-me@test.local`,
        paymentMethod: "UPI",
      },
      authToken
    );
    expect(first.status).toBe(201);

    const mid = await mget(`pledges/${pledgeId}`).set("Authorization", `Bearer ${authToken}`);
    expect(mid.body.paymentsMade).toBe(100);
    expect(mid.body.remaining).toBe(100);
    expect(mid.body.status).toBe("ACTIVE");
    expect(mid.body.installments.length).toBe(1);
    expect(mid.body.installments[0].receiptNumber).toBe(first.body.receiptNumber);

    const second = await mpost(
      "donations",
      {
        amount: 100,
        pledgeId,
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-me@test.local`,
        paymentMethod: "UPI",
      },
      authToken
    );
    expect(second.status).toBe(201);

    const done = await mget(`pledges/${pledgeId}`).set("Authorization", `Bearer ${authToken}`);
    expect(done.body.paymentsMade).toBe(200);
    expect(done.body.remaining).toBe(0);
    expect(done.body.status).toBe("COMPLETED");
    expect(done.body.completedAt).toBeTruthy();
    expect(done.body.nextDueAt).toBeNull();

    // the auto-completed pledge no longer counts towards the cause total
    const cause = await mget(`causes/${causeId}`);
    expect(cause.body.raised).toBe(0);
  });

  it("403s when another donor pays my pledge installment", async () => {
    const fresh = await mpost(
      `causes/${causeId}/pledges`,
      { amountPerMonth: 100, months: 2, donorName: `${PREFIX} donor` },
      authToken
    );
    expect(fresh.status).toBe(201);
    expect(fresh.body.pledge.donorId).toBe(me.id);
    const res2 = await mpost(
      "donations",
      {
        amount: 100,
        pledgeId: fresh.body.pledge.id,
        donorName: `${PREFIX} other`,
        donorEmail: `${PREFIX}-other@test.local`,
        paymentMethod: "UPI",
      },
      otherToken
    );
    expect(res2.status).toBe(403);
  });
});
