/**
 * Receipts — /api/receipts (vitest + supertest, integration style).
 *
 * Covers every route: the 80G list (admin sees all, other roles see their
 * own, from/to date filters), the public capability detail and the
 * print-ready HTML document — plus auth and not-found paths.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `trc-${Date.now()}`;
const PASSWORD = "Passw0rd!";

let app: express.Express;
let adminToken: string;
let donorToken: string;
let donorId: string;
let campaignId: string;

let donorReceipt: string; // donor's COMPLETED donation
let oldReceipt: string; // donor's COMPLETED donation, createdAt pushed back
let pendingReceipt: string; // donor's PENDING donation — not receiptable

async function buildApp() {
  const { router: receiptsRouter } = await import("@/routes/receipts");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/receipts", receiptsRouter);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

function get(path: string, token?: string) {
  const r = request(app).get(`/api/receipts${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}

async function login(email: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.donation.deleteMany({ where: { donorEmail: { startsWith: PREFIX } } });
  await db.campaign.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.activityLog.deleteMany({ where: { details: { contains: PREFIX } } });
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");

  const admin = await db.user.create({
    data: { email: `${PREFIX}-admin@test.local`, name: `${PREFIX} admin`, password: PASSWORD, role: "ADMIN" },
  });
  const donor = await db.user.create({
    data: {
      email: `${PREFIX}-donor@test.local`,
      name: `${PREFIX} donor`,
      password: PASSWORD,
      role: "DONOR",
      pan: "AAAAA1111A",
    },
  });
  donorId = donor.id;

  const campaign = await db.campaign.create({
    data: {
      code: `${PREFIX}-CMP`,
      title: `${PREFIX} campaign`,
      slug: `${PREFIX}-campaign`,
      description: "receipts integration suite",
      category: "GENERAL",
      targetAmount: 10000,
      status: "ACTIVE",
      createdBy: admin.id,
    },
  });
  campaignId = campaign.id;

  adminToken = await login(admin.email);
  donorToken = await login(donor.email);

  const mkDonation = async (overrides: Record<string, unknown>) =>
    db.donation.create({
      data: {
        donorId,
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-donor@test.local`,
        amount: 500,
        currency: "INR",
        type: "ONE_TIME",
        paymentMethod: "UPI",
        paymentStatus: "COMPLETED",
        pan: "AAAAA1111A",
        campaignId,
        ...overrides,
      } as never,
    });

  donorReceipt = (await mkDonation({ receiptNumber: `UAR-RCPT-${PREFIX}-A` })).receiptNumber;
  pendingReceipt = (
    await mkDonation({
      receiptNumber: `UAR-RCPT-${PREFIX}-P`,
      paymentStatus: "PENDING",
      receiptStatus: "PENDING",
      receiptIssuedAt: null,
      paymentMethod: "RAZORPAY",
    })
  ).receiptNumber;
  const old = await mkDonation({
    receiptNumber: `UAR-RCPT-${PREFIX}-O`,
    amount: 250,
    transactionId: `txn_${PREFIX}_old`,
  });
  oldReceipt = old.receiptNumber;
  // push one gift three days into the past for the from/to filter assertions
  await db.donation.update({
    where: { id: old.id },
    data: { createdAt: new Date(Date.now() - 3 * 86_400_000) },
  });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ─── GET /api/receipts — the 80G list ────────────────────────────────────────
describe("GET /api/receipts", () => {
  it("401 without a session", async () => {
    expect((await get("/")).status).toBe(401);
  });

  it("ADMIN sees every completed donation (never PENDING), newest first", async () => {
    const res = await get("/?limit=200", adminToken);
    expect(res.status).toBe(200);
    const mine = (res.body as Array<Record<string, unknown>>).filter(
      (d) => String(d.receiptNumber).includes(PREFIX)
    );
    expect(mine).toHaveLength(2); // the PENDING row is not receiptable
    expect(mine.some((d) => d.receiptNumber === donorReceipt)).toBe(true);
    expect(mine.some((d) => d.receiptNumber === oldReceipt)).toBe(true);
    expect(mine.every((d) => d.paymentStatus === "COMPLETED")).toBe(true);
    expect(mine[0].campaignTitle).toBe(`${PREFIX} campaign`); // newest first
  });

  it("non-admin roles see only their own receipts", async () => {
    const res = await get("/?limit=200", donorToken);
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    expect(list.every((d) => d.donorId === donorId || d.donorEmail === `${PREFIX}-donor@test.local`)).toBe(true);
    expect(list.some((d) => d.receiptNumber === donorReceipt)).toBe(true);
  });

  it("?from filters out older donations (to keeps the whole end day)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await get(`/?from=${today}&limit=200`, adminToken);
    expect(res.status).toBe(200);
    const mine = (res.body as Array<Record<string, unknown>>).filter(
      (d) => String(d.receiptNumber).includes(PREFIX)
    );
    expect(mine.map((d) => d.receiptNumber)).toEqual([donorReceipt]); // old row excluded

    const wide = await get(`/?from=${new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)}`, adminToken);
    const wideMine = (wide.body as Array<Record<string, unknown>>).filter(
      (d) => String(d.receiptNumber).includes(PREFIX)
    );
    expect(wideMine).toHaveLength(2);
  });
});

// ─── GET /api/receipts/:receiptNumber — public capability detail ─────────────
describe("GET /api/receipts/:receiptNumber", () => {
  it("404 for an unknown receipt number", async () => {
    const res = await get(`/${encodeURIComponent(`UAR-RCPT-${PREFIX}-none`)}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Receipt not found");
  });

  it("returns the receipt + issuing org profile (public by capability)", async () => {
    const res = await get(`/${donorReceipt}`);
    expect(res.status).toBe(200);
    expect(res.body.donation.receiptNumber).toBe(donorReceipt);
    expect(res.body.donation.amount).toBe(500);
    expect(res.body.donation.campaignTitle).toBe(`${PREFIX} campaign`);
    expect(res.body.donation.pan).toBe("AAAAA1111A"); // donor PAN for 80G
    expect(res.body.org).toHaveProperty("name");
    expect(res.body.org).toHaveProperty("reg80g");
    expect(res.body.org).toHaveProperty("pan");
  });
});

// ─── GET /api/receipts/:receiptNumber/html — print-ready A4 document ─────────
describe("GET /api/receipts/:receiptNumber/html", () => {
  it("404 for an unknown receipt number", async () => {
    const res = await get(`/${encodeURIComponent(`UAR-RCPT-${PREFIX}-none`)}/html`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Receipt not found");
  });

  it("serves the self-contained 80G receipt document", async () => {
    const res = await get(`/${donorReceipt}/html`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    const html = res.text as string;
    expect(html).toContain(donorReceipt);
    expect(html).toContain("80G");
    expect(html).toContain("DONATION RECEIPT");
  });
});
