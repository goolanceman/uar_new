/**
 * Donations — /api/donations (vitest + supertest, integration style).
 *
 * Covers every route: the multi-mode list (public wall / donor wall /
 * signed-in admin view / mine), guest + session creation with validation,
 * recurring commitments (mine + PATCH lifecycle) and the admin detail /
 * edit (transition machine) / delete.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `tdo-${Date.now()}`;
const PASSWORD = "Passw0rd!";

let app: express.Express;
let adminToken: string;
let donorToken: string; // the recurring donor
let otherToken: string; // a second donor (forbidden paths)
let adminId: string;
let donorId: string;
let campaignId: string;

let upiReceiptNumber: string; // guest UPI gift — instant COMPLETED
let pendingReceiptNumber: string; // gateway gift — PENDING
let recurringId: string;

async function buildApp() {
  const { router: donationsRouter } = await import("@/routes/donations");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/donations", donationsRouter);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

function get(path: string, token?: string) {
  const r = request(app).get(`/api/donations${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/donations");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/donations${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function del(id: string, token?: string) {
  const r = request(app).delete(`/api/donations/${id}`);
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
  await db.donor.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await db.campaign.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.donationPoint.deleteMany({ where: { userId: { in: [adminId, donorId].filter(Boolean) } } });
  await db.notification.deleteMany({ where: { userId: { in: [adminId, donorId].filter(Boolean) } } });
  await db.activityLog.deleteMany({
    where: { OR: [{ actorName: { startsWith: PREFIX } }, { details: { contains: PREFIX } }] },
  });
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
    data: { email: `${PREFIX}-donor@test.local`, name: `${PREFIX} donor`, password: PASSWORD, role: "DONOR" },
  });
  const other = await db.user.create({
    data: { email: `${PREFIX}-other@test.local`, name: `${PREFIX} other`, password: PASSWORD, role: "DONOR" },
  });
  adminId = admin.id;
  donorId = donor.id;

  const campaign = await db.campaign.create({
    data: {
      code: `${PREFIX}-CMP`,
      title: `${PREFIX} campaign`,
      slug: `${PREFIX}-campaign`,
      description: "donations integration suite",
      category: "MEDICAL",
      targetAmount: 50000,
      status: "ACTIVE",
      createdBy: admin.id,
    },
  });
  campaignId = campaign.id;

  adminToken = await login(admin.email);
  donorToken = await login(donor.email);
  otherToken = await login(other.email);
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ─── POST /api/donations ─────────────────────────────────────────────────────
describe("POST /api/donations", () => {
  it("creates a guest UPI donation that settles instantly (no gateway)", async () => {
    const res = await post({
      amount: 101,
      donorName: `${PREFIX} guest`,
      donorEmail: `${PREFIX}-guest@test.local`,
      paymentMethod: "UPI",
      campaignId,
      message: "guest gift",
    });
    expect(res.status).toBe(201);
    expect(res.body.paymentStatus).toBe("COMPLETED"); // UPI records promise-to-pay → instant
    expect(res.body.donorId).toBeNull(); // guest
    expect(res.body.receiptNumber).toMatch(/^UAR-RCPT-\d{4}-\d{5}$/);
    expect(res.body.receiptStatus).toBe("ISSUED");
    expect(res.body.campaignId).toBe(campaignId);
    upiReceiptNumber = res.body.receiptNumber;

    // the Donor CRM record is upserted in the same transaction
    const { db } = await import("@/infrastructure/database/prisma");
    const crm = await db.donor.findUnique({ where: { email: `${PREFIX}-guest@test.local` } });
    expect(crm).toBeTruthy();
    expect(crm?.source).toBe("WEB");
    expect(crm?.category).toBe("ONE_TIME");

    // instant completion bumps the campaign total
    const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.raisedAmount).toBe(101);
  });

  it("creates a session RAZORPAY donation that stays PENDING for checkout", async () => {
    const res = await post(
      {
        amount: 250,
        campaignId,
        paymentMethod: "RAZORPAY",
        message: "from the session donor",
      },
      donorToken
    );
    expect(res.status).toBe(201);
    expect(res.body.paymentStatus).toBe("PENDING");
    expect(res.body.checkoutPending).toBe(true);
    expect(res.body.donorId).toBe(donorId); // session-enriched identity
    expect(res.body.donorEmail).toBe(`${PREFIX}-donor@test.local`);
    pendingReceiptNumber = res.body.receiptNumber;
  });

  it("rejects the main validation errors in the legacy order", async () => {
    const zero = await post({ amount: 0, donorName: "x", donorEmail: "x@y.z" });
    expect(zero.status).toBe(400);
    expect(zero.body.error).toBe("Amount must be greater than zero");

    const badCampaign = await post({
      amount: 10,
      campaignId: "nope",
      donorName: "x",
      donorEmail: `${PREFIX}-v@test.local`,
    });
    expect(badCampaign.status).toBe(400);
    expect(badCampaign.body.error).toBe("Selected campaign was not found");

    const noIdentity = await post({ amount: 10 });
    expect(noIdentity.status).toBe(400);
    expect(noIdentity.body.error).toBe("Donor name and email are required");

    const badEmail = await post({ amount: 10, donorName: "x", donorEmail: "nope" });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toBe("Please enter a valid email address");

    const badPhone = await post({
      amount: 10,
      donorName: "x",
      donorEmail: `${PREFIX}-v@test.local`,
      donorPhone: "123",
    });
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.error).toBe("Please enter a valid Indian mobile number");

    const badPan = await post({
      amount: 10,
      donorName: "x",
      donorEmail: `${PREFIX}-v@test.local`,
      pan: "12AB",
    });
    expect(badPan.status).toBe(400);
    expect(badPan.body.error).toBe("PAN must look like ABCDE1234F");

    const badCurrency = await post({
      amount: 10,
      donorName: "x",
      donorEmail: `${PREFIX}-v@test.local`,
      currency: "BTC",
    });
    expect(badCurrency.status).toBe(400);
    expect(badCurrency.body.error).toBe("Unsupported currency");

    const bothLinks = await post(
      { amount: 10, donorName: "x", donorEmail: `${PREFIX}-v@test.local`, recurringParentId: "a", pledgeId: "b" },
      donorToken
    );
    expect(bothLinks.status).toBe(400);
    expect(bothLinks.body.error).toBe(
      "A donation cannot pay a recurring commitment and a pledge at the same time"
    );
  });
});

// ─── GET /api/donations — list modes ─────────────────────────────────────────
describe("GET /api/donations — public wall / donor wall / admin list", () => {
  it("anonymous (or ?public=1) gets the public wall: completed gifts only, masked", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const mine = (res.body as Array<Record<string, unknown>>).filter(
      (d) => String(d.id).includes(PREFIX) || (d.campaign as { title: string } | null)?.title === `${PREFIX} campaign`
    );
    // only the instant UPI gift is public — the PENDING gateway gift is not
    expect(mine.every((d) => d.amount !== 250)).toBe(true);
    const guest = mine.find((d) => d.amount === 101);
    expect(guest).toBeTruthy();
    expect(guest?.donorName).toBe(`${PREFIX} g.`); // masked like the website wall
    // public-safe projection: no PII fields
    expect(guest).not.toHaveProperty("donorEmail");
    expect(guest).not.toHaveProperty("donorPhone");
  });

  it("wall=1 needs campaignId and returns the paginated donor wall with totalRaised", async () => {
    const missing = await get("/?wall=1");
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("campaignId is required for the donor wall");

    const res = await get(`/?wall=1&campaignId=${campaignId}&limit=10`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("totalRaised", 101);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].amount).toBe(101);
    expect(res.body.items[0].campaign.title).toBe(`${PREFIX} campaign`);
  });

  it("signed-in admins get the filterable envelope with completedSum", async () => {
    const res = await get(`/?campaignId=${campaignId}&limit=50`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page", 1);
    expect(res.body).toHaveProperty("pages");
    expect(res.body).toHaveProperty("completedSum", 101);
    expect(res.body.items).toHaveLength(2); // COMPLETED + PENDING for this campaign

    const onlyPending = await get(`/?campaignId=${campaignId}&status=PENDING`, adminToken);
    expect(onlyPending.body.items).toHaveLength(1);
    expect(onlyPending.body.items[0].receiptNumber).toBe(pendingReceiptNumber);
  });

  it("mine=1 is session-gated and owner-scoped", async () => {
    expect((await get("/?mine=1")).status).toBe(401);

    const res = await get("/?mine=1", donorToken);
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1); // only the session RAZORPAY gift
    expect(list[0].donorId).toBe(donorId);
    expect(list[0].receiptNumber).toBe(pendingReceiptNumber);
  });
});

// ─── recurring commitments ───────────────────────────────────────────────────
describe("recurring commitments — POST + GET /recurring/mine + PATCH /recurring/:id", () => {
  it("POST type=RECURRING creates the parent commitment (UPI settles instantly)", async () => {
    const res = await post(
      { amount: 200, type: "RECURRING", recurringFrequency: "MONTHLY", paymentMethod: "UPI" },
      donorToken
    );
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("RECURRING");
    expect(res.body.recurringStatus).toBe("ACTIVE");
    expect(res.body.nextChargeAt).toBeTruthy();
    recurringId = res.body.id;
  });

  it("GET /recurring/mine is session-gated and lists only my parents", async () => {
    expect((await get("/recurring/mine")).status).toBe(401);

    const res = await get("/recurring/mine", donorToken);
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(recurringId);
    expect(list[0].recurringFrequency).toBe("MONTHLY");
    expect(list[0]).toHaveProperty("installmentCount");
    expect(list[0]).toHaveProperty("paidTotal", 200);
    expect(list[0]).toHaveProperty("installments");

    const others = await get("/recurring/mine", otherToken);
    expect(others.body).toHaveLength(0); // owner-scoped
  });

  it("PATCH /recurring/:id is owner/admin-gated", async () => {
    const forbidden = await patch(`/recurring/${recurringId}`, { recurringStatus: "PAUSED" }, otherToken);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("You can only manage your own recurring commitments");

    expect((await patch(`/recurring/${recurringId}`, { recurringStatus: "PAUSED" })).status).toBe(401);
  });

  it("PATCH validates the fields and the status machine", async () => {
    const badStatus = await patch(`/recurring/${recurringId}`, { recurringStatus: "HIBERNATING" }, donorToken);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("recurringStatus must be ACTIVE, PAUSED or CANCELLED");

    const badAmount = await patch(`/recurring/${recurringId}`, { amount: -5 }, donorToken);
    expect(badAmount.status).toBe(400);
    expect(badAmount.body.error).toBe("Amount must be greater than zero");

    const badFreq = await patch(`/recurring/${recurringId}`, { recurringFrequency: "DAILY" }, donorToken);
    expect(badFreq.status).toBe(400);
    expect(badFreq.body.error).toBe("recurringFrequency must be WEEKLY, MONTHLY, QUARTERLY or YEARLY");

    const empty = await patch(`/recurring/${recurringId}`, {}, donorToken);
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    const notFound = await patch("/recurring/does-not-exist", { amount: 5 }, donorToken);
    expect(notFound.status).toBe(404);
    expect(notFound.body.error).toBe("Recurring commitment not found");
  });

  it("pause → resume → cancel lifecycle; cancelled is terminal", async () => {
    const pause = await patch(`/recurring/${recurringId}`, { recurringStatus: "PAUSED" }, donorToken);
    expect(pause.status).toBe(200);
    expect(pause.body.recurringStatus).toBe("PAUSED");

    const resume = await patch(`/recurring/${recurringId}`, { recurringStatus: "ACTIVE" }, donorToken);
    expect(resume.status).toBe(200);
    expect(resume.body.recurringStatus).toBe("ACTIVE");

    const cancel = await patch(`/recurring/${recurringId}`, { recurringStatus: "CANCELLED" }, donorToken);
    expect(cancel.status).toBe(200);
    expect(cancel.body.recurringStatus).toBe("CANCELLED");

    const afterCancel = await patch(`/recurring/${recurringId}`, { recurringStatus: "PAUSED" }, donorToken);
    expect(afterCancel.status).toBe(400);
    expect(afterCancel.body.error).toContain("Cannot move recurring commitment from CANCELLED to PAUSED");
  });
});

// ─── GET /api/donations/:id — admin/volunteer detail ─────────────────────────
describe("GET /api/donations/:id", () => {
  it("is ADMIN/VOLUNTEER-gated", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const donation = await db.donation.findFirst({ where: { receiptNumber: upiReceiptNumber } });

    expect((await get(`/${donation!.id}`)).status).toBe(401);
    expect((await get(`/${donation!.id}`, donorToken)).status).toBe(403);

    const res = await get(`/${donation!.id}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.receiptNumber).toBe(upiReceiptNumber);
    expect(res.body.campaign.title).toBe(`${PREFIX} campaign`);
    expect(res.body.donorRef).toBeTruthy(); // Donor CRM include
  });

  it("404 for an unknown id", async () => {
    const res = await get("/does-not-exist", adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Donation not found");
  });
});

// ─── PATCH /api/donations/:id — admin edit with the transition machine ───────
describe("PATCH /api/donations/:id", () => {
  let targetId: string;

  beforeAll(async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.donation.findFirst({ where: { receiptNumber: pendingReceiptNumber } });
    targetId = row!.id;
  });

  it("404 for an unknown id", async () => {
    const res = await patch("/does-not-exist", { amount: 5 }, adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Donation not found");
  });

  it("403 for non-admins", async () => {
    expect((await patch(`/${targetId}`, { amount: 5 }, donorToken)).status).toBe(403);
  });

  it("validates each field with the legacy messages", async () => {
    const empty = await patch(`/${targetId}`, {}, adminToken);
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    const badType = await patch(`/${targetId}`, { type: "SUBSCRIPTION" }, adminToken);
    expect(badType.status).toBe(400);
    expect(badType.body.error).toBe("Invalid donation type");

    const badMethod = await patch(`/${targetId}`, { paymentMethod: "BITCOIN" }, adminToken);
    expect(badMethod.status).toBe(400);
    expect(badMethod.body.error).toBe("Invalid payment method");

    const badCategory = await patch(`/${targetId}`, { category: "SPACE" }, adminToken);
    expect(badCategory.status).toBe(400);
    expect(badCategory.body.error).toBe("Invalid category");

    const badAmount = await patch(`/${targetId}`, { amount: 0 }, adminToken);
    expect(badAmount.status).toBe(400);
    expect(badAmount.body.error).toBe("Amount must be greater than zero");

    const badPan = await patch(`/${targetId}`, { pan: "XYZ" }, adminToken);
    expect(badPan.status).toBe(400);
    expect(badPan.body.error).toBe("PAN must look like ABCDE1234F");

    const badStatus = await patch(`/${targetId}`, { paymentStatus: "MAYBE" }, adminToken);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("Invalid payment status");
  });

  it("blocks corrupting status transitions (PENDING → PENDING-family moves)", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    // CANCELLED is terminal — moving a COMPLETED row anywhere but REFUNDED is illegal.
    const completed = await db.donation.findFirst({ where: { receiptNumber: upiReceiptNumber } });
    const res = await patch(`/${completed!.id}`, { paymentStatus: "PENDING" }, adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Cannot move donation paymentStatus from COMPLETED to PENDING");
  });

  it("settles PENDING → COMPLETED with the receipt invariant and campaign recompute", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const res = await patch(`/${targetId}`, { paymentStatus: "COMPLETED" }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.paymentStatus).toBe("COMPLETED");
    expect(res.body.receiptStatus).toBe("PENDING"); // not auto-flipped by the admin PATCH

    // campaign raised recomputed from COMPLETED totals (101 + 250)
    const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.raisedAmount).toBe(351);
  });

  it("runs the refund workflow (COMPLETED → REFUNDED + refund fields)", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const res = await patch(`/${targetId}`, { refundAmount: 250, refundReason: "duplicate" }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.paymentStatus).toBe("REFUNDED"); // auto-transition on refund
    expect(res.body.refundAmount).toBe(250);
    expect(res.body.refundedAt).toBeTruthy();

    const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.raisedAmount).toBe(101); // recompute drops the refund
  });
});

// ─── DELETE /api/donations/:id ───────────────────────────────────────────────
describe("DELETE /api/donations/:id", () => {
  it("is admin-only and 404s for unknown ids", async () => {
    expect((await del("does-not-exist", adminToken)).status).toBe(404);
    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.donation.findFirst({ where: { receiptNumber: pendingReceiptNumber } });
    expect((await del(row!.id, donorToken)).status).toBe(403);
  });

  it("deletes the donation and recomputes the campaign total", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.donation.findFirst({ where: { receiptNumber: pendingReceiptNumber } });
    const res = await del(row!.id, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(await db.donation.findUnique({ where: { id: row!.id } })).toBeNull();

    const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.raisedAmount).toBe(101);
  });
});
