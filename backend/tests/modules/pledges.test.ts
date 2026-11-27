/**
 * Pledges — /api/pledges (vitest + supertest, integration style).
 *
 * Covers every route: the ADMIN list (status/q filters), the donor's own
 * /mine with the payment schedule, owner-or-admin detail, owner-or-admin
 * PATCH (status vocabulary checked after the lookup/ownership gates) and
 * the ADMIN delete.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `tpl-${Date.now()}`;
const PASSWORD = "Passw0rd!";

let app: express.Express;
let adminToken: string;
let ownerToken: string; // the pledge's own donor (Pledge.donorId = userId)
let otherToken: string;
let ownerUserId: string;

let causeId: string;
let pledgeId: string;

async function buildApp() {
  const { router: pledgesRouter } = await import("@/routes/pledges");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/pledges", pledgesRouter);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

function get(path: string, token?: string) {
  const r = request(app).get(`/api/pledges${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/pledges/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function del(id: string, token?: string) {
  const r = request(app).delete(`/api/pledges/${id}`);
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
  await db.pledge.deleteMany({ where: { donorName: { startsWith: PREFIX } } });
  await db.cause.deleteMany({ where: { city: { startsWith: PREFIX } } });
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
  const owner = await db.user.create({
    data: { email: `${PREFIX}-owner@test.local`, name: `${PREFIX} owner`, password: PASSWORD, role: "DONOR" },
  });
  const other = await db.user.create({
    data: { email: `${PREFIX}-other@test.local`, name: `${PREFIX} other`, password: PASSWORD, role: "DONOR" },
  });
  ownerUserId = owner.id;

  const cause = await db.cause.create({
    data: {
      code: `${PREFIX}-CAUSE`,
      patientName: `${PREFIX} patient`,
      age: 45,
      city: `${PREFIX} city`,
      condition: "BP",
      monthlyCost: 1000,
      durationMonths: 12,
      story: "pledges integration suite",
    },
  });
  causeId = cause.id;

  const pledge = await db.pledge.create({
    data: {
      causeId,
      donorId: owner.id,
      donorName: `${PREFIX} owner`,
      amountPerMonth: 250,
      months: 6,
      status: "ACTIVE",
    },
  });
  pledgeId = pledge.id;

  adminToken = await login(admin.email);
  ownerToken = await login(owner.email);
  otherToken = await login(other.email);
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ─── GET /api/pledges — admin list ───────────────────────────────────────────
describe("GET /api/pledges — ADMIN list", () => {
  it("401 anonymous / 403 donor", async () => {
    expect((await get("/")).status).toBe(401);
    expect((await get("/", ownerToken)).status).toBe(403);
  });

  it("lists all pledges with the cause include", async () => {
    const res = await get("/", adminToken);
    expect(res.status).toBe(200);
    const mine = (res.body as Array<Record<string, unknown>>).filter(
      (p) => (p.donorName as string).startsWith(PREFIX)
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(pledgeId);
    expect(mine[0].cause).toBeTruthy();
    expect((mine[0].cause as { patientName: string }).patientName).toBe(`${PREFIX} patient`);
  });

  it("filters by status and q", async () => {
    const active = await get("/?status=ACTIVE", adminToken);
    expect(active.body.some((p: { id: string }) => p.id === pledgeId)).toBe(true);

    const cancelled = await get("/?status=CANCELLED", adminToken);
    expect(cancelled.body.some((p: { id: string }) => p.id === pledgeId)).toBe(false);

    const byQ = await get(`/?q=${encodeURIComponent(`${PREFIX} owner`)}`, adminToken);
    expect(byQ.body.some((p: { id: string }) => p.id === pledgeId)).toBe(true);

    const noMatch = await get("/?q=no-such-donor-anywhere", adminToken);
    expect(noMatch.body.some((p: { id: string }) => p.id === pledgeId)).toBe(false);
  });
});

// ─── GET /api/pledges/mine — the donor's own schedule ────────────────────────
describe("GET /api/pledges/mine", () => {
  it("401 anonymous", async () => {
    expect((await get("/mine")).status).toBe(401);
  });

  it("returns the owner's pledges with the full payment schedule", async () => {
    const res = await get("/mine", ownerToken);
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    const p = list[0];
    expect(p.id).toBe(pledgeId);
    expect(p.totalCommitted).toBe(250 * 6);
    expect(p.paymentsMade).toBe(0);
    expect(p.remaining).toBe(250 * 6);
    expect((p.schedule as unknown[]).length).toBe(6); // one row per month
    expect(Array.isArray(p.installments)).toBe(true);
  });

  it("is owner-scoped (other donors get an empty list)", async () => {
    const res = await get("/mine", otherToken);
    expect(res.body).toHaveLength(0);
  });
});

// ─── GET /api/pledges/:id — owner or ADMIN ───────────────────────────────────
describe("GET /api/pledges/:id", () => {
  it("404 for an unknown pledge", async () => {
    const res = await get("/does-not-exist", adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Pledge not found");
  });

  it("403 for a donor who does not own the pledge", async () => {
    const res = await get(`/${pledgeId}`, otherToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can only view your own pledges");
  });

  it("200 for the owner and for admins", async () => {
    const ownerRes = await get(`/${pledgeId}`, ownerToken);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.id).toBe(pledgeId);
    expect(ownerRes.body.totalCommitted).toBe(1500);

    const adminRes = await get(`/${pledgeId}`, adminToken);
    expect(adminRes.status).toBe(200);
  });
});

// ─── PATCH /api/pledges/:id — ADMIN or own donor ─────────────────────────────
describe("PATCH /api/pledges/:id", () => {
  it("404 before field validation (legacy ordering)", async () => {
    const res = await patch("/does-not-exist", { status: "BOGUS" }, adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Pledge not found");
  });

  it("403 for a donor who does not own the pledge", async () => {
    const res = await patch(`/${pledgeId}`, { status: "PAUSED" }, otherToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can only manage your own pledges");
  });

  it("validates the status vocabulary after the gates", async () => {
    const res = await patch(`/${pledgeId}`, { status: "PAUSED" }, adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("status must be ACTIVE, COMPLETED or CANCELLED");
  });

  it("the owner can cancel their own pledge (cause recomputed)", async () => {
    const res = await patch(`/${pledgeId}`, { status: "CANCELLED" }, ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");

    const { db } = await import("@/infrastructure/database/prisma");
    const cause = await db.cause.findUnique({ where: { id: causeId } });
    expect(cause?.raised).toBe(0); // no ACTIVE pledges left

    // reactivate for the delete test
    const back = await patch(`/${pledgeId}`, { status: "ACTIVE" }, adminToken);
    expect(back.status).toBe(200);
    expect(back.body.status).toBe("ACTIVE");
  });
});

// ─── DELETE /api/pledges/:id — ADMIN ─────────────────────────────────────────
describe("DELETE /api/pledges/:id", () => {
  it("403 non-admins and 404 unknown", async () => {
    expect((await del("/does-not-exist", adminToken)).status).toBe(404);
    expect((await del(`/${pledgeId}`, ownerToken)).status).toBe(403);
  });

  it("removes the pledge (cause recomputed)", async () => {
    const res = await del(`/${pledgeId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const { db } = await import("@/infrastructure/database/prisma");
    expect(await db.pledge.findUnique({ where: { id: pledgeId } })).toBeNull();
  });
});
