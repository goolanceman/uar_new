/**
 * Donor CRM — /api/donors (vitest + supertest, integration style).
 *
 * Covers every route of the module: admin list (with aggregates + filters),
 * create, donor-360 detail, patch and delete — plus the main validation
 * errors, the authz errors and not-found paths.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `tdn-${Date.now()}`;
const PASSWORD = "Passw0rd!";

let app: express.Express;
let adminToken: string;
let donorToken: string;
let donorUserId: string; // User row behind the linked donor

let createdDonorId: string;
let linkedDonorId: string;

async function buildApp() {
  const { router: donorsRouter } = await import("@/routes/donors");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/donors", donorsRouter);
  // Same fallback the real app has — some modules forward via next(error).
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

function get(path: string, token?: string) {
  const r = request(app).get(`/api/donors${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/donors");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/donors/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function del(id: string, token?: string) {
  const r = request(app).delete(`/api/donors/${id}`);
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
  const donorUser = await db.user.create({
    data: { email: `${PREFIX}-donor@test.local`, name: `${PREFIX} donor`, password: PASSWORD, role: "DONOR" },
  });
  await db.user.create({
    data: { email: `${PREFIX}-plain@test.local`, name: `${PREFIX} plain`, password: PASSWORD, role: "DONOR" },
  });
  donorUserId = donorUser.id;

  adminToken = await login(admin.email);
  donorToken = await login(donorUser.email);
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ─── Authz ───────────────────────────────────────────────────────────────────
describe("authz — every /api/donors route is ADMIN-only", () => {
  it("401 without a session", async () => {
    expect((await get("/")).status).toBe(401);
    expect((await post({ name: "x", email: "x@y.z" })).status).toBe(401);
  });

  it("403 for a signed-in non-admin", async () => {
    const list = await get("/", donorToken);
    expect(list.status).toBe(403);
    expect(list.body.error).toContain("permission");

    const created = await post({ name: "x", email: "x@y.z" }, donorToken);
    expect(created.status).toBe(403);
  });
});

// ─── POST /api/donors ────────────────────────────────────────────────────────
describe("POST /api/donors", () => {
  it("creates a donor with legacy defaults and links the user account by email", async () => {
    const res = await post(
      { name: `${PREFIX} linked donor`, email: `${PREFIX}-donor@test.local`, city: "Bengaluru" },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^UAR-DNR-/);
    expect(res.body.type).toBe("INDIVIDUAL");
    expect(res.body.source).toBe("OFFLINE");
    expect(res.body.wants80g).toBe(true);
    expect(res.body.emailOptIn).toBe(true);
    expect(res.body.userId).toBe(donorUserId); // linked via the matching User email
    linkedDonorId = res.body.id;
  });

  it("keeps name/email required and the email format checked", async () => {
    const missing = await post({ name: "", email: "" }, adminToken);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("Name and email are required");

    const badEmail = await post({ name: "x", email: "not-an-email" }, adminToken);
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toBe("Please enter a valid email address");
  });

  it("409 on a duplicate email", async () => {
    const res = await post(
      { name: `${PREFIX} dup`, email: `${PREFIX}-donor@test.local` },
      adminToken
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("A donor with this email already exists");
  });

  it("validates phone, PAN, pincode and the enum fields in the legacy order", async () => {
    const phone = await post(
      { name: "x", email: `${PREFIX}-v1@test.local`, phone: "12345" },
      adminToken
    );
    expect(phone.status).toBe(400);
    expect(phone.body.error).toBe("Please enter a valid Indian mobile number");

    const pan = await post(
      { name: "x", email: `${PREFIX}-v2@test.local`, pan: "bad" },
      adminToken
    );
    expect(pan.status).toBe(400);
    expect(pan.body.error).toBe("PAN must look like ABCDE1234F");

    const pin = await post(
      { name: "x", email: `${PREFIX}-v3@test.local`, pincode: "12" },
      adminToken
    );
    expect(pin.status).toBe(400);
    expect(pin.body.error).toBe("PIN code must be 6 digits");

    const type = await post(
      { name: "x", email: `${PREFIX}-v4@test.local`, type: "ALIEN" },
      adminToken
    );
    expect(type.status).toBe(400);
    expect(type.body.error).toBe("Invalid donor type");

    const source = await post(
      { name: "x", email: `${PREFIX}-v5@test.local`, source: "SPONTANEOUS" },
      adminToken
    );
    expect(source.status).toBe(400);
    expect(source.body.error).toBe("Invalid donor source");

    const category = await post(
      { name: "x", email: `${PREFIX}-v6@test.local`, category: "VIP" },
      adminToken
    );
    expect(category.status).toBe(400);
    expect(category.body.error).toBe("Invalid donor category");
  });

  it("creates a plain donor used by the list/detail assertions", async () => {
    const res = await post(
      {
        name: `${PREFIX} crm donor`,
        email: `${PREFIX}-crm@test.local`,
        phone: "9876543210",
        pan: "ABCDE1234F",
        pincode: "560001",
        type: "ORGANISATION",
        category: "MAJOR",
      },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.pan).toBe("ABCDE1234F"); // upper-cased
    expect(res.body.phone).toBe("9876543210");
    createdDonorId = res.body.id;
  });
});

// ─── GET /api/donors (list) ──────────────────────────────────────────────────
describe("GET /api/donors — CRM list with aggregates", () => {
  it("returns the {items,total,page,pages} envelope and lifetime aggregates", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    // a COMPLETED donation for the CRM donor feeds lifetimeValue/donationsCount
    await db.donation.create({
      data: {
        donorName: `${PREFIX} crm donor`,
        donorEmail: `${PREFIX}-crm@test.local`,
        amount: 750,
        currency: "INR",
        type: "ONE_TIME",
        paymentMethod: "UPI",
        paymentStatus: "COMPLETED",
        receiptNumber: `UAR-RCPT-${PREFIX}-L1`,
      },
    });

    const res = await get("/?limit=50", adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");

    const mine = res.body.items.filter((d: { email: string }) => d.email.startsWith(PREFIX));
    expect(mine).toHaveLength(2);
    const crm = mine.find((d: { email: string }) => d.email === `${PREFIX}-crm@test.local`);
    expect(crm.lifetimeValue).toBe(750);
    expect(crm.donationsCount).toBe(1);
    expect(crm.firstDonationAt).toBeTruthy();
    expect(crm.lastDonationAt).toBeTruthy();
  });

  it("filters by q (name/email/phone/code contains) and by type", async () => {
    const byQ = await get(`/?q=${encodeURIComponent(`${PREFIX}-crm@`)}`, adminToken);
    expect(byQ.status).toBe(200);
    const qItems = byQ.body.items as Array<{ email: string }>;
    expect(qItems).toHaveLength(1);
    expect(qItems[0].email).toBe(`${PREFIX}-crm@test.local`);

    const byType = await get("/?type=ORGANISATION&limit=200", adminToken);
    expect(byType.status).toBe(200);
    const typeItems = byType.body.items as Array<{ email: string }>;
    const myOrgRows = typeItems.filter((d) => d.email.startsWith(PREFIX));
    expect(myOrgRows).toHaveLength(1);
    expect(myOrgRows[0].email).toBe(`${PREFIX}-crm@test.local`);
  });
});

// ─── GET /api/donors/:id — donor 360 ─────────────────────────────────────────
describe("GET /api/donors/:id — donor 360", () => {
  it("404 for an unknown id", async () => {
    const res = await get("/does-not-exist", adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Donor not found");
  });

  it("returns the profile with donations, pledges, certificates and stats", async () => {
    const res = await get(`/${createdDonorId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(`${PREFIX}-crm@test.local`);
    expect(Array.isArray(res.body.donations)).toBe(true);
    expect(res.body.donations).toHaveLength(1);
    expect(res.body.donations[0].amount).toBe(750);
    expect(Array.isArray(res.body.pledges)).toBe(true);
    expect(Array.isArray(res.body.animalPledges)).toBe(true);
    expect(Array.isArray(res.body.certificates)).toBe(true);
    expect(res.body.stats).toMatchObject({ lifetimeValue: 750, donationsCount: 1, activePledges: 0 });
  });
});

// ─── PATCH /api/donors/:id ───────────────────────────────────────────────────
describe("PATCH /api/donors/:id", () => {
  it("404 for an unknown id", async () => {
    const res = await patch("does-not-exist", { name: "x" }, adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Donor not found");
  });

  it("validates field formats and the empty patch", async () => {
    const empty = await patch(`/${createdDonorId}`, {}, adminToken);
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    const emptyName = await patch(`/${createdDonorId}`, { name: "   " }, adminToken);
    expect(emptyName.status).toBe(400);
    expect(emptyName.body.error).toBe("Name cannot be empty");

    const badPin = await patch(`/${createdDonorId}`, { pincode: "abc" }, adminToken);
    expect(badPin.status).toBe(400);
    expect(badPin.body.error).toBe("PIN code must be 6 digits");

    const badType = await patch(`/${createdDonorId}`, { type: "ROBOT" }, adminToken);
    expect(badType.status).toBe(400);
    expect(badType.body.error).toBe("Invalid donor type");
  });

  it("updates the whitelisted fields", async () => {
    const res = await patch(
      `/${createdDonorId}`,
      { city: "Mumbai", notes: "major donor since 2026", wants80g: false },
      adminToken
    );
    expect(res.status).toBe(200);
    expect(res.body.city).toBe("Mumbai");
    expect(res.body.notes).toBe("major donor since 2026");
    expect(res.body.wants80g).toBe(false);
  });
});

// ─── DELETE /api/donors/:id ──────────────────────────────────────────────────
describe("DELETE /api/donors/:id", () => {
  it("404 for an unknown id", async () => {
    const res = await del("does-not-exist", adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Donor not found");
  });

  it("removes the CRM record but leaves the donations untouched", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const res = await del(`/${createdDonorId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await db.donor.findUnique({ where: { id: createdDonorId } })).toBeNull();
    const donation = await db.donation.findFirst({
      where: { donorEmail: `${PREFIX}-crm@test.local` },
    });
    expect(donation).toBeTruthy(); // donations are kept
    expect(donation?.donorRefId).toBeNull(); // link cleared
  });

  it("403 for a non-admin", async () => {
    const res = await del(`/${linkedDonorId}`, donorToken);
    expect(res.status).toBe(403);
  });
});
