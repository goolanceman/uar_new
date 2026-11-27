/**
 * Causes — /api/causes (vitest + supertest, integration style).
 *
 * Covers: the public (cached-fall-through) list with condition/status/q
 * filters, the public pledge creation (guest + session donors) with the
 * cause recompute (SEEKING → PARTIAL/ADOPTED), admin CRUD and the status
 * transition machine (SEEKING ⇄ PAUSED; ADOPTED API-untouchable), plus
 * /pledges?mine=1 and the authz/not-found paths.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `tcs-${Date.now()}`;
const PASSWORD = "Passw0rd!";

let app: express.Express;
let adminToken: string;
let donorToken: string;
let donorUserId: string;

let seekingCauseId: string; // untouched by pledges — transition tests
let pledgeCauseId: string; // receives pledges — recompute tests

async function buildApp() {
  const { router: causesRouter } = await import("@/routes/causes");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/causes", causesRouter);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

function get(path: string, token?: string) {
  const r = request(app).get(`/api/causes${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).post(`/api/causes${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(id: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/causes/${id}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function del(id: string, token?: string) {
  const r = request(app).delete(`/api/causes/${id}`);
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
  const donor = await db.user.create({
    data: { email: `${PREFIX}-donor@test.local`, name: `${PREFIX} donor`, password: PASSWORD, role: "DONOR" },
  });
  donorUserId = donor.id;

  const seeking = await db.cause.create({
    data: {
      code: `${PREFIX}-CAUSE-1`,
      patientName: `${PREFIX} seeking patient`,
      age: 50,
      city: `${PREFIX} town`,
      condition: "BP",
      monthlyCost: 1000,
      durationMonths: 12,
      story: `${PREFIX} causes integration suite`,
      status: "SEEKING",
    },
  });
  seekingCauseId = seeking.id;

  const pledgeTarget = await db.cause.create({
    data: {
      code: `${PREFIX}-CAUSE-2`,
      patientName: `${PREFIX} pledge patient`,
      age: 60,
      city: `${PREFIX} town`,
      condition: "DIABETES",
      monthlyCost: 800,
      durationMonths: 6,
      story: `${PREFIX} pledge recompute suite`,
      status: "SEEKING",
    },
  });
  pledgeCauseId = pledgeTarget.id;

  adminToken = await login(admin.email);
  donorToken = await login(donor.email);
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ─── GET /api/causes — public cached list ────────────────────────────────────
describe("GET /api/causes — public list (cache falls through without Redis)", () => {
  it("lists causes with funding + pledge projections", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const mine = (res.body as Array<Record<string, unknown>>).filter((c) =>
      String(c.city).startsWith(PREFIX)
    );
    expect(mine).toHaveLength(2);
    const seeking = mine.find((c) => c.condition === "BP");
    expect(seeking?.status).toBe("SEEKING");
    expect(seeking).toHaveProperty("raised", 0);
    expect(Array.isArray(seeking?.pledges)).toBe(true);
  });

  it("filters by condition, status and q", async () => {
    const bp = await get("/?condition=BP");
    const bpMine = (bp.body as Array<Record<string, unknown>>).filter((c) =>
      String(c.city).startsWith(PREFIX)
    );
    expect(bpMine).toHaveLength(1);
    expect(bpMine[0].condition).toBe("BP");

    const seeking = await get("/?status=SEEKING");
    expect(
      (seeking.body as Array<Record<string, unknown>>).every((c) => c.status === "SEEKING")
    ).toBe(true);

    const byQ = await get(`/?q=${encodeURIComponent(`${PREFIX} pledge patient`)}`);
    const qMine = (byQ.body as Array<Record<string, unknown>>).filter((c) =>
      String(c.city).startsWith(PREFIX)
    );
    expect(qMine).toHaveLength(1);
    expect(qMine[0].patientName).toBe(`${PREFIX} pledge patient`);
  });
});

// ─── GET /api/causes/pledges — auth-scoped pledge list ───────────────────────
describe("GET /api/causes/pledges", () => {
  it("401 anonymous", async () => {
    expect((await get("/pledges")).status).toBe(401);
  });

  it("mine=1 scopes to the caller's pledges with the schedule fields", async () => {
    const res = await get("/pledges?mine=1", donorToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0); // no pledges yet — schedule asserted after creation
  });
});

// ─── POST /api/causes — admin CRUD ───────────────────────────────────────────
describe("POST /api/causes", () => {
  it("401 anonymous / 403 donor", async () => {
    const body = { patientName: "x", city: "y", story: "z", age: 30, monthlyCost: 100, condition: "BP" };
    expect((await post("/", body)).status).toBe(401);
    expect((await post("/", body, donorToken)).status).toBe(403);
  });

  it("creates a cause with the sequential UAR-MED code", async () => {
    const res = await post(
      "/",
      {
        patientName: `${PREFIX} new patient`,
        city: `${PREFIX} town`,
        condition: "thyroid", // case-insensitive
        story: `${PREFIX} new cause story`,
        age: 42.9, // trunc
        monthlyCost: 750,
        durationMonths: 10,
      },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^UAR-MED-\d{4}$/);
    expect(res.body.condition).toBe("THYROID");
    expect(res.body.age).toBe(42);
    expect(res.body.status).toBe("SEEKING");
  });

  it("validates the legacy field checks", async () => {
    const missing = await post("/", { patientName: "x", city: "" }, adminToken);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("patientName, city and story are required");

    const badAge = await post(
      "/",
      { patientName: "x", city: "y", story: "z", age: 0, monthlyCost: 100, condition: "BP" },
      adminToken
    );
    expect(badAge.status).toBe(400);
    expect(badAge.body.error).toBe("age must be a positive number");

    const badCost = await post(
      "/",
      { patientName: "x", city: "y", story: "z", age: 30, monthlyCost: 0, condition: "BP" },
      adminToken
    );
    expect(badCost.status).toBe(400);
    expect(badCost.body.error).toBe("monthlyCost must be a positive number");

    const badDuration = await post(
      "/",
      {
        patientName: "x",
        city: "y",
        story: "z",
        age: 30,
        monthlyCost: 100,
        durationMonths: 0,
        condition: "BP",
      },
      adminToken
    );
    expect(badDuration.status).toBe(400);
    expect(badDuration.body.error).toBe("durationMonths must be at least 1");

    const badCondition = await post(
      "/",
      {
        patientName: "x",
        city: "y",
        story: "z",
        age: 30,
        monthlyCost: 100,
        condition: "FLU",
      },
      adminToken
    );
    expect(badCondition.status).toBe(400);
    expect(badCondition.body.error).toBe("Invalid condition");
  });
});

// ─── GET /api/causes/:id ─────────────────────────────────────────────────────
describe("GET /api/causes/:id", () => {
  it("404 for an unknown cause", async () => {
    const res = await get("/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Cause not found");
  });

  it("returns the detail with pledges", async () => {
    const res = await get(`/${seekingCauseId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(seekingCauseId);
    expect(res.body.patientName).toBe(`${PREFIX} seeking patient`);
  });
});

// ─── PATCH /api/causes/:id — transition machine ──────────────────────────────
describe("PATCH /api/causes/:id", () => {
  it("404 before validation (legacy ordering); 403 donors", async () => {
    const missing = await patch("/does-not-exist", { status: "BOGUS" }, adminToken);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Cause not found");

    expect((await patch(`/${seekingCauseId}`, { city: "x" }, donorToken)).status).toBe(403);
  });

  it("validates the status vocabulary and transitions", async () => {
    const badStatus = await patch(`/${seekingCauseId}`, { status: "CLOSED" }, adminToken);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("status must be SEEKING, PARTIAL, ADOPTED or PAUSED");

    const badTransition = await patch(`/${seekingCauseId}`, { status: "PARTIAL" }, adminToken);
    expect(badTransition.status).toBe(400);
    expect(badTransition.body.error).toBe("Cannot move cause from SEEKING to PARTIAL. Allowed: PAUSED");

    // ADOPTED is recompute-only — never API-settable
    const adopted = await patch(`/${seekingCauseId}`, { status: "ADOPTED" }, adminToken);
    expect(adopted.status).toBe(400);
  });

  it("pauses and resumes (PAUSED → SEEKING)", async () => {
    const pause = await patch(`/${seekingCauseId}`, { status: "PAUSED" }, adminToken);
    expect(pause.status).toBe(200);
    expect(pause.body.status).toBe("PAUSED");

    const resume = await patch(`/${seekingCauseId}`, { status: "SEEKING" }, adminToken);
    expect(resume.status).toBe(200);
    expect(resume.body.status).toBe("SEEKING");
  });

  it("edits profile fields (recompute keeps the derived status)", async () => {
    const res = await patch(
      `/${seekingCauseId}`,
      { monthlyCost: 1200, story: `${PREFIX} updated story` },
      adminToken
    );
    expect(res.status).toBe(200);
    expect(res.body.monthlyCost).toBe(1200);
    expect(res.body.story).toBe(`${PREFIX} updated story`);
  });
});

// ─── POST /api/causes/:id/pledges — public pledge creation ───────────────────
describe("POST /api/causes/:id/pledges — public (guest or session)", () => {
  it("404 for an unknown cause", async () => {
    const res = await post("/does-not-exist/pledges", { amountPerMonth: 100 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Cause not found");
  });

  it("validates amountPerMonth, months and startDate before the lookup", async () => {
    const badAmount = await post(`/${pledgeCauseId}/pledges`, { amountPerMonth: 0 });
    expect(badAmount.status).toBe(400);
    expect(badAmount.body.error).toBe("amountPerMonth must be greater than 0");

    const badMonths = await post(`/${pledgeCauseId}/pledges`, { amountPerMonth: 100, months: 0 });
    expect(badMonths.status).toBe(400);
    expect(badMonths.body.error).toBe("months must be at least 1");

    const badDate = await post(
      `/${pledgeCauseId}/pledges`,
      { amountPerMonth: 100, startDate: "not-a-date" },
      donorToken
    );
    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toBe("startDate is not a valid date");
  });

  it("a guest pledge recomputes the cause (raised + PARTIAL status)", async () => {
    const res = await post(`/${pledgeCauseId}/pledges`, {
      amountPerMonth: 300,
      months: 4,
      donorName: `${PREFIX} guest pledger`,
    });
    expect(res.status).toBe(201);
    expect(res.body.pledge.donorId).toBeNull(); // guest
    expect(res.body.pledge.status).toBe("ACTIVE");
    expect(res.body.cause.raised).toBe(300);
    expect(res.body.cause.status).toBe("PARTIAL"); // 300 < 800 monthlyCost
  });

  it("a session pledge links the donor; full coverage flips ADOPTED", async () => {
    const res = await post(`/${pledgeCauseId}/pledges`, { amountPerMonth: 500, months: 6 }, donorToken);
    expect(res.status).toBe(201);
    expect(res.body.pledge.donorId).toBe(donorUserId);
    expect(res.body.cause.raised).toBe(800); // 300 + 500
    expect(res.body.cause.status).toBe("ADOPTED"); // >= monthlyCost
    expect(res.body.cause.adoptedById).toBe(donorUserId);
  });

  it("the donor's mine=1 list shows the pledge with the schedule", async () => {
    const res = await get("/pledges?mine=1", donorToken);
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0].causeId).toBe(pledgeCauseId);
    expect(list[0].totalCommitted).toBe(500 * 6);
    expect((list[0].schedule as unknown[]).length).toBe(6);
  });
});

// ─── DELETE /api/causes/:id ──────────────────────────────────────────────────
describe("DELETE /api/causes/:id", () => {
  it("403 donors / 404 unknown", async () => {
    expect((await del("does-not-exist", adminToken)).status).toBe(404);
    expect((await del(`/${pledgeCauseId}`, donorToken)).status).toBe(403);
  });

  it("removes the cause and its pledges", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const res = await del(`/${pledgeCauseId}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await db.cause.findUnique({ where: { id: pledgeCauseId } })).toBeNull();
    expect(await db.pledge.count({ where: { causeId: pledgeCauseId } })).toBe(0);
  });
});
