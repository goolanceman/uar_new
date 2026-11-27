/**
 * Recurring needs — /api/recurring-needs (vitest + supertest, integration
 * style).
 *
 * Covers every route: the staff list (with status/item/beneficiary/dueBy
 * filters and the legacy silent-ignore of invalid values), ADMIN|VOLUNTEER
 * create (beneficiary/item 404s, cycle/qty/startDate handling), PATCH
 * (status/dueBy/qty handling) and the ADMIN-only delete.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `trn-${Date.now()}`;
const PASSWORD = "Passw0rd!";

let app: express.Express;
let adminToken: string;
let volunteerToken: string;
let donorToken: string;

let beneficiaryId: string;
let itemId: string;
let needId: string;

async function buildApp() {
  const { router: recurringNeedsRouter } = await import("@/routes/recurring-needs");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/recurring-needs", recurringNeedsRouter);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

function get(path: string, token?: string) {
  const r = request(app).get(`/api/recurring-needs${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/recurring-needs");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/recurring-needs/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function del(id: string, token?: string) {
  const r = request(app).delete(`/api/recurring-needs/${id}`);
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
  await db.recurringNeed.deleteMany({ where: { beneficiaryId } });
  await db.beneficiary.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.inventoryItem.deleteMany({ where: { code: { startsWith: PREFIX } } });
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

  const beneficiary = await db.beneficiary.create({
    data: { code: `${PREFIX}-BEN`, name: `${PREFIX} beneficiary`, city: `${PREFIX} city` },
  });
  beneficiaryId = beneficiary.id;

  const item = await db.inventoryItem.create({
    data: {
      code: `${PREFIX}-ITM`,
      name: `${PREFIX} BP tablets`,
      category: "MEDICINE",
      unit: "strip",
      pricePerUnit: 100,
      quantity: 50,
    },
  });
  itemId = item.id;

  adminToken = await login(admin.email);
  volunteerToken = await login(volunteer.email);
  donorToken = await login(donor.email);
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ─── Authz ───────────────────────────────────────────────────────────────────
describe("authz — recurring-needs are staff-only (DELETE admin-only)", () => {
  it("401 anonymous / 403 donor on GET and POST", async () => {
    expect((await get("/")).status).toBe(401);
    expect((await post({ beneficiaryId: "x", itemId: "y" })).status).toBe(401);
    expect((await get("/", donorToken)).status).toBe(403);
    expect((await post({ beneficiaryId: "x", itemId: "y" }, donorToken)).status).toBe(403);
  });

  it("403 donor on PATCH and DELETE", async () => {
    expect((await patch("/some-id", { status: "PAUSED" }, donorToken)).status).toBe(403);
    expect((await del("/some-id", donorToken)).status).toBe(403);
  });
});

// ─── POST /api/recurring-needs ───────────────────────────────────────────────
describe("POST /api/recurring-needs", () => {
  it("creates a standing need seeded with the start date (defaults qty 1, MONTHLY)", async () => {
    const startDate = new Date("2026-06-01T00:00:00.000Z");
    const res = await post(
      {
        beneficiaryId,
        itemId,
        cycle: "monthly", // case-insensitive
        reason: `${PREFIX} BP medication`,
        startDate: startDate.toISOString(),
      },
      volunteerToken
    );
    expect(res.status).toBe(201);
    expect(res.body.beneficiaryId).toBe(beneficiaryId);
    expect(res.body.itemId).toBe(itemId);
    expect(res.body.cycle).toBe("MONTHLY");
    expect(res.body.qtyPerCycle).toBe(1);
    expect(res.body.status).toBe("ACTIVE");
    expect(new Date(res.body.nextDueAt).toISOString()).toBe(startDate.toISOString());
    needId = res.body.id;
  });

  it("404 for an unknown beneficiary and unknown item", async () => {
    const noBeneficiary = await post({ beneficiaryId: "nope", itemId }, volunteerToken);
    expect(noBeneficiary.status).toBe(404);
    expect(noBeneficiary.body.error).toBe("Beneficiary not found");

    const noItem = await post({ beneficiaryId, itemId: "nope" }, volunteerToken);
    expect(noItem.status).toBe(404);
    expect(noItem.body.error).toBe("Inventory item not found");
  });

  it("requires beneficiaryId and itemId, validates cycle and startDate", async () => {
    const noBeneficiaryId = await post({ itemId }, volunteerToken);
    expect(noBeneficiaryId.status).toBe(400);
    expect(noBeneficiaryId.body.error).toBe("beneficiaryId is required");

    const noItemId = await post({ beneficiaryId }, volunteerToken);
    expect(noItemId.status).toBe(400);
    expect(noItemId.body.error).toBe("itemId is required");

    const badCycle = await post({ beneficiaryId, itemId, cycle: "DAILY" }, volunteerToken);
    expect(badCycle.status).toBe(400);
    expect(badCycle.body.error).toBe("Invalid cycle");

    const badDate = await post({ beneficiaryId, itemId, startDate: "not-a-date" }, volunteerToken);
    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toBe("Invalid startDate");
  });

  it("coerces qtyPerCycle to a positive integer", async () => {
    const res = await post({ beneficiaryId, itemId, qtyPerCycle: 2.7 }, volunteerToken);
    expect(res.status).toBe(201);
    expect(res.body.qtyPerCycle).toBe(2); // trunc
  });
});

// ─── GET /api/recurring-needs ────────────────────────────────────────────────
describe("GET /api/recurring-needs — staff list + filters", () => {
  it("lists my rows for staff with relations included", async () => {
    const res = await get("/", volunteerToken);
    expect(res.status).toBe(200);
    const mine = (res.body as Array<Record<string, unknown>>).filter(
      (n) => (n.reason as string)?.startsWith(PREFIX)
    );
    expect(mine).toHaveLength(2);
    expect(mine[0].beneficiary).toBeTruthy();
    expect(mine[0].item).toBeTruthy();
  });

  it("filters by beneficiaryId, itemId and status", async () => {
    const byBeneficiary = await get(`/?beneficiaryId=${beneficiaryId}`, adminToken);
    expect(byBeneficiary.body.every((n: { beneficiaryId: string }) => n.beneficiaryId === beneficiaryId)).toBe(true);

    const byItem = await get(`/?itemId=${itemId}`, adminToken);
    expect(byItem.body.every((n: { itemId: string }) => n.itemId === itemId)).toBe(true);

    const active = await get("/?status=ACTIVE", adminToken);
    expect(active.body.every((n: { status: string }) => n.status === "ACTIVE")).toBe(true);
  });

  it("silently ignores invalid status values (legacy behavior)", async () => {
    const res = await get("/?status=BOGUS", adminToken);
    expect(res.status).toBe(200);
    const mine = (res.body as Array<Record<string, unknown>>).filter(
      (n) => (n.reason as string)?.startsWith(PREFIX)
    );
    expect(mine).toHaveLength(2); // no filter applied
  });

  it("dueBy filters to needs due on or before the date", async () => {
    const future = await get(`/?dueBy=${new Date(Date.now() + 86_400_000).toISOString()}`, adminToken);
    expect(future.body.some((n: { id: string }) => n.id === needId)).toBe(true);

    const past = await get("/?dueBy=2020-01-01T00:00:00.000Z", adminToken);
    expect(past.body.some((n: { id: string }) => n.id === needId)).toBe(false);
  });
});

// ─── PATCH /api/recurring-needs/:id ──────────────────────────────────────────
describe("PATCH /api/recurring-needs/:id", () => {
  it("404 for an unknown id", async () => {
    const res = await patch("/does-not-exist", { status: "PAUSED" }, adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Recurring need not found");
  });

  it("validates status, cycle and nextDueAt", async () => {
    const badStatus = await patch(`/${needId}`, { status: "ARCHIVED" }, adminToken);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("Invalid status");

    const badCycle = await patch(`/${needId}`, { cycle: "DAILY" }, adminToken);
    expect(badCycle.status).toBe(400);
    expect(badCycle.body.error).toBe("Invalid cycle");

    const badDue = await patch(`/${needId}`, { nextDueAt: "not-a-date" }, adminToken);
    expect(badDue.status).toBe(400);
    expect(badDue.body.error).toBe("Invalid nextDueAt");
  });

  it("edits qty/cycle and the status/dueBy lifecycle (pause → resume → complete)", async () => {
    const pause = await patch(`/${needId}`, { status: "PAUSED", qtyPerCycle: 3 }, volunteerToken);
    expect(pause.status).toBe(200);
    expect(pause.body.status).toBe("PAUSED");
    expect(pause.body.qtyPerCycle).toBe(3);

    const due = await patch(`/${needId}`, { nextDueAt: "2026-12-25T00:00:00.000Z" }, adminToken);
    expect(due.status).toBe(200);
    expect(new Date(due.body.nextDueAt).toISOString()).toBe("2026-12-25T00:00:00.000Z");

    const resume = await patch(`/${needId}`, { status: "ACTIVE" }, adminToken);
    expect(resume.body.status).toBe("ACTIVE");

    const complete = await patch(`/${needId}`, { status: "COMPLETED" }, adminToken);
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe("COMPLETED");

    // status vocabulary is intentionally transition-free — a completed need can resume
    const reopen = await patch(`/${needId}`, { status: "ACTIVE" }, adminToken);
    expect(reopen.status).toBe(200);
  });
});

// ─── DELETE /api/recurring-needs/:id ─────────────────────────────────────────
describe("DELETE /api/recurring-needs/:id", () => {
  it("403 for volunteers (ADMIN only)", async () => {
    const res = await del(`/${needId}`, volunteerToken);
    expect(res.status).toBe(403);
  });

  it("404 for an unknown id", async () => {
    expect((await del("/does-not-exist", adminToken)).status).toBe(404);
  });

  it("cancels the standing need", async () => {
    const res = await del(`/${needId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const { db } = await import("@/infrastructure/database/prisma");
    expect(await db.recurringNeed.findUnique({ where: { id: needId } })).toBeNull();
  });
});
