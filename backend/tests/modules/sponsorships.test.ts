/**
 * Sponsorships — /api/sponsorships (vitest + supertest, integration style).
 *
 * Covers every route: the branch-gated list (staff filters vs donor
 * mine=1), the ADMIN|VOLUNTEER matcher, staff create (with beneficiary /
 * donor / recurring-need resolution + amount validation), the role-split
 * PATCH (staff edit anything; donors may only pause/resume/cancel their
 * own) and the ADMIN delete.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `tsp-${Date.now()}`;
const PASSWORD = "Passw0rd!";

let app: express.Express;
let adminToken: string;
let volunteerToken: string;
let donorToken: string; // donor with a Donor CRM record
let otherDonorToken: string; // donor WITHOUT a Donor record
let donorUserId: string;

let beneficiaryId: string;
let itemId: string;
let needId: string;
let otherBeneficiaryId: string;
let otherNeedId: string; // belongs to the OTHER beneficiary (mismatch test)
let donorRecordId: string; // Donor row linked to donorToken's user
let sponsorshipId: string;

async function buildApp() {
  const { router: sponsorshipsRouter } = await import("@/routes/sponsorships");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/sponsorships", sponsorshipsRouter);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

function get(path: string, token?: string) {
  const r = request(app).get(`/api/sponsorships${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).post(`/api/sponsorships${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/sponsorships/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function del(id: string, token?: string) {
  const r = request(app).delete(`/api/sponsorships/${id}`);
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
  await db.beneficiarySponsorship.deleteMany({ where: { donorName: { startsWith: PREFIX } } });
  await db.recurringNeed.deleteMany({ where: { beneficiary: { name: { startsWith: PREFIX } } } });
  await db.donor.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await db.beneficiary.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.inventoryItem.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.setting.deleteMany({ where: { key: { startsWith: "matching." } } });
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
  const volunteer = await db.user.create({
    data: { email: `${PREFIX}-vol@test.local`, name: `${PREFIX} vol`, password: PASSWORD, role: "VOLUNTEER" },
  });
  const donor = await db.user.create({
    data: { email: `${PREFIX}-donor@test.local`, name: `${PREFIX} donor`, password: PASSWORD, role: "DONOR" },
  });
  const other = await db.user.create({
    data: { email: `${PREFIX}-other@test.local`, name: `${PREFIX} other`, password: PASSWORD, role: "DONOR" },
  });
  donorUserId = donor.id;

  const beneficiary = await db.beneficiary.create({
    data: {
      code: `${PREFIX}-BEN`,
      name: `${PREFIX} beneficiary`,
      city: `${PREFIX} city`,
      urgencyLevel: "HIGH",
    },
  });
  beneficiaryId = beneficiary.id;

  const item = await db.inventoryItem.create({
    data: {
      code: `${PREFIX}-ITM`,
      name: `${PREFIX} medicines`,
      category: "MEDICINE",
      unit: "strip",
      pricePerUnit: 100,
      quantity: 50,
    },
  });
  itemId = item.id;

  const need = await db.recurringNeed.create({
    data: {
      beneficiaryId,
      itemId,
      qtyPerCycle: 2,
      cycle: "MONTHLY",
      reason: `${PREFIX} monthly medicines`,
    },
  });
  needId = need.id;

  // a second beneficiary + need — used for the need/beneficiary mismatch 400
  const otherBeneficiary = await db.beneficiary.create({
    data: { code: `${PREFIX}-BEN2`, name: `${PREFIX} other beneficiary`, city: `${PREFIX} city` },
  });
  otherBeneficiaryId = otherBeneficiary.id;
  const otherNeed = await db.recurringNeed.create({
    data: {
      beneficiaryId: otherBeneficiaryId,
      itemId,
      qtyPerCycle: 1,
      cycle: "MONTHLY",
      reason: `${PREFIX} other medicines`,
    },
  });
  otherNeedId = otherNeed.id;

  const donorRecord = await db.donor.create({
    data: {
      code: `${PREFIX}-DNR`,
      name: `${PREFIX} donor`,
      email: `${PREFIX}-donor@test.local`,
      category: "MONTHLY", // matcher pool category
      userId: donor.id,
    },
  });
  donorRecordId = donorRecord.id;

  adminToken = await login(admin.email);
  volunteerToken = await login(volunteer.email);
  donorToken = await login(donor.email);
  otherDonorToken = await login(other.email);
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ─── GET /api/sponsorships — branch-dependent gates ──────────────────────────
describe("GET /api/sponsorships", () => {
  it("401 anonymous", async () => {
    expect((await get("/")).status).toBe(401);
  });

  it("a DONOR may only use mine=1 (else 403)", async () => {
    expect((await get("/", donorToken)).status).toBe(403);
    const mine = await get("/?mine=1", donorToken);
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(0); // nothing yet
  });

  it("mine=1 scopes to the caller's Donor record (via Donor.userId)", async () => {
    const created = await post(
      "/",
      { beneficiaryId, donorId: donorRecordId, amountPerMonth: 400, months: 12 },
      adminToken
    );
    expect(created.status).toBe(201);
    sponsorshipId = created.body.id;

    const mine = await get("/?mine=1", donorToken);
    expect(mine.status).toBe(200);
    const list = mine.body as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(sponsorshipId);
    expect(list[0].donorId).toBe(donorRecordId);
  });

  it("staff list with beneficiary/status filters", async () => {
    const byBeneficiary = await get(`/?beneficiaryId=${beneficiaryId}`, volunteerToken);
    expect(byBeneficiary.status).toBe(200);
    expect(byBeneficiary.body.some((s: { id: string }) => s.id === sponsorshipId)).toBe(true);

    const paused = await get("/?status=PAUSED", volunteerToken);
    expect(paused.body.some((s: { id: string }) => s.id === sponsorshipId)).toBe(false);
  });
});

// ─── GET /api/sponsorships/match — the preview-only matcher ──────────────────
describe("GET /api/sponsorships/match", () => {
  it("401 anonymous / 403 donor", async () => {
    expect((await get("/match")).status).toBe(401);
    expect((await get("/match", donorToken)).status).toBe(403);
  });

  it("suggests pairings for un-sponsored active needs against category donors", async () => {
    const res = await get("/match", volunteerToken);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    expect(typeof res.body.unmatchedNeeds).toBe("number");
    expect(typeof res.body.availableDonors).toBe("number");

    const mine = res.body.suggestions.find(
      (s: { recurringNeedId: string }) => s.recurringNeedId === needId
    );
    // the need is un-sponsored and my MONTHLY-category donor is under the cap
    expect(mine).toBeTruthy();
    expect(mine.beneficiaryId).toBe(beneficiaryId);
    expect(mine.itemName).toBe(`${PREFIX} medicines`);
    expect(mine.suggestedAmountPerMonth).toBe(500); // max(500 floor, 2 × 100)
    expect(mine.donorId).toBeTruthy();
  });

  it("respects matching.enabled=false", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    await db.setting.upsert({
      where: { key: "matching.enabled" },
      create: { key: "matching.enabled", value: "false" },
      update: { value: "false" },
    });
    const res = await get("/match", adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, suggestions: [], unmatchedNeeds: 0, availableDonors: 0 });
    await db.setting.delete({ where: { key: "matching.enabled" } });
  });
});

// ─── POST /api/sponsorships — staff assignment ───────────────────────────────
describe("POST /api/sponsorships", () => {
  it("401 anonymous / 403 donor", async () => {
    expect((await post("/", { beneficiaryId: "x" })).status).toBe(401);
    expect((await post("/", { beneficiaryId: "x" }, donorToken)).status).toBe(403);
  });

  it("validates the field checks in the legacy order", async () => {
    const noBeneficiary = await post("/", { amountPerMonth: 100 }, volunteerToken);
    expect(noBeneficiary.status).toBe(400);
    expect(noBeneficiary.body.error).toBe("beneficiaryId is required");

    const noSuchBeneficiary = await post("/", { beneficiaryId: "nope", amountPerMonth: 100 }, volunteerToken);
    expect(noSuchBeneficiary.status).toBe(404);
    expect(noSuchBeneficiary.body.error).toBe("Beneficiary not found");

    const noSuchDonor = await post(
      "/",
      { beneficiaryId, donorId: "nope", amountPerMonth: 100 },
      volunteerToken
    );
    expect(noSuchDonor.status).toBe(404);
    expect(noSuchDonor.body.error).toBe("Donor not found");

    const noIdentity = await post("/", { beneficiaryId, amountPerMonth: 100 }, volunteerToken);
    expect(noIdentity.status).toBe(400);
    expect(noIdentity.body.error).toBe("donorId or donorName is required");

    const badAmount = await post("/", { beneficiaryId, donorName: "x", amountPerMonth: 0 }, volunteerToken);
    expect(badAmount.status).toBe(400);
    expect(badAmount.body.error).toBe("amountPerMonth must be a positive number");

    const noSuchNeed = await post(
      "/",
      { beneficiaryId, donorName: "x", amountPerMonth: 100, recurringNeedId: "nope" },
      volunteerToken
    );
    expect(noSuchNeed.status).toBe(404);
    expect(noSuchNeed.body.error).toBe("Recurring need not found");

    const mismatchedNeed = await post(
      "/",
      { beneficiaryId, donorName: "x", amountPerMonth: 100, recurringNeedId: otherNeedId },
      volunteerToken
    );
    expect(mismatchedNeed.status).toBe(400);
    expect(mismatchedNeed.body.error).toBe("Recurring need does not belong to this beneficiary");
  });

  it("assigns a donor to a beneficiary (optionally tied to the recurring need)", async () => {
    const res = await post(
      "/",
      {
        beneficiaryId,
        donorId: donorRecordId,
        amountPerMonth: 300,
        months: 3,
        recurringNeedId: needId,
        notes: `${PREFIX} cover BP tablets every month`,
      },
      volunteerToken
    );
    expect(res.status).toBe(201);
    expect(res.body.beneficiaryId).toBe(beneficiaryId);
    expect(res.body.donorId).toBe(donorRecordId);
    expect(res.body.recurringNeedId).toBe(needId);
    expect(res.body.amountPerMonth).toBe(300);
    expect(res.body.months).toBe(3);
    expect(res.body.source).toBe("MANUAL");
    expect(res.body.assignedByName).toBe(`${PREFIX} vol`);

    // donorName-only creation also works (guest sponsorship)
    const byName = await post(
      "/",
      { beneficiaryId, donorName: `${PREFIX} guest sponsor`, amountPerMonth: 200 },
      adminToken
    );
    expect(byName.status).toBe(201);
    expect(byName.body.donorId).toBeNull();
  });
});

// ─── PATCH /api/sponsorships/:id — staff vs own-donor permissions ────────────
describe("PATCH /api/sponsorships/:id", () => {
  it("404 for an unknown sponsorship", async () => {
    const res = await patch("/does-not-exist", { status: "PAUSED" }, adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Sponsorship not found");
  });

  it("403 for a donor with no Donor record (never the owner)", async () => {
    const res = await patch(`/${sponsorshipId}`, { status: "PAUSED" }, otherDonorToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You do not have permission for this action");
  });

  it("staff may edit anything (status, amount, months, notes)", async () => {
    const res = await patch(
      `/${sponsorshipId}`,
      { amountPerMonth: 450, months: 9, notes: `${PREFIX} bumped` },
      volunteerToken
    );
    expect(res.status).toBe(200);
    expect(res.body.amountPerMonth).toBe(450);
    expect(res.body.months).toBe(9);

    const badAmount = await patch(`/${sponsorshipId}`, { amountPerMonth: -1 }, adminToken);
    expect(badAmount.status).toBe(400);
    expect(badAmount.body.error).toBe("amountPerMonth must be positive");

    const badStatus = await patch(`/${sponsorshipId}`, { status: "HIBERNATING" }, adminToken);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("Invalid status");
  });

  it("a DONOR may only pause/resume/cancel their own sponsorship", async () => {
    const pause = await patch(`/${sponsorshipId}`, { status: "PAUSED" }, donorToken);
    expect(pause.status).toBe(200);
    expect(pause.body.status).toBe("PAUSED");

    // amount edits are staff-only
    const amountEdit = await patch(`/${sponsorshipId}`, { amountPerMonth: 999 }, donorToken);
    expect(amountEdit.status).toBe(403);

    // COMPLETED is a staff-only status
    const completed = await patch(`/${sponsorshipId}`, { status: "COMPLETED" }, donorToken);
    expect(completed.status).toBe(403);

    const resume = await patch(`/${sponsorshipId}`, { status: "ACTIVE" }, donorToken);
    expect(resume.status).toBe(200);
  });
});

// ─── DELETE /api/sponsorships/:id — ADMIN only ───────────────────────────────
describe("DELETE /api/sponsorships/:id", () => {
  it("403 volunteers / 404 unknown", async () => {
    expect((await del("/does-not-exist", adminToken)).status).toBe(404);
    expect((await del(`/${sponsorshipId}`, volunteerToken)).status).toBe(403);
  });

  it("removes the assignment", async () => {
    const res = await del(`/${sponsorshipId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const { db } = await import("@/infrastructure/database/prisma");
    expect(await db.beneficiarySponsorship.findUnique({ where: { id: sponsorshipId } })).toBeNull();
  });
});
