/**
 * Cause analytics — /api/cause-analytics (vitest + supertest, integration
 * style).
 *
 * ADMIN-only consolidated payload for the Adopt-a-Medicine tab: causes by
 * status/condition/city, funding summary, 12-month pledge buckets, pledge
 * totals and top causes. Seeded rows must show up in the right buckets;
 * authz paths are covered.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `tcz-${Date.now()}`;
const PASSWORD = "Passw0rd!";

let app: express.Express;
let adminToken: string;
let donorToken: string;

let causeId: string;
const CITY = `${PREFIX} city`;
const MONTHLY_COST = 900;
const PLEDGE_PER_MONTH = 400;

async function buildApp() {
  const { router: causeAnalyticsRouter } = await import("@/routes/cause-analytics");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/cause-analytics", causeAnalyticsRouter);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function login(email: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.pledge.deleteMany({ where: { donorName: { startsWith: PREFIX } } });
  await db.cause.deleteMany({ where: { city: CITY } });
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
    data: { email: `${PREFIX}-donor@test.local`, name: `${PREFIX} donor`, password: PASSWORD, role: "DONOR" },
  });

  const cause = await db.cause.create({
    data: {
      code: `${PREFIX}-CAUSE`,
      patientName: `${PREFIX} patient`,
      age: 55,
      city: CITY,
      condition: "CARDIAC",
      monthlyCost: MONTHLY_COST,
      durationMonths: 12,
      story: "cause-analytics integration suite",
      status: "SEEKING",
      raised: PLEDGE_PER_MONTH, // what recomputeCause would derive below
    },
  });
  causeId = cause.id;

  // an ACTIVE pledge this month feeds the monthly buckets + pledge totals
  await db.pledge.create({
    data: {
      causeId,
      donorId: donor.id,
      donorName: `${PREFIX} pledger`,
      amountPerMonth: PLEDGE_PER_MONTH,
      months: 12,
      status: "ACTIVE",
    },
  });

  adminToken = await login(admin.email);
  donorToken = await login(donor.email);
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/cause-analytics", () => {
  it("401 anonymous / 403 non-admin", async () => {
    const anon = await request(app).get("/api/cause-analytics");
    expect(anon.status).toBe(401);
    const donor = await request(app)
      .get("/api/cause-analytics")
      .set("Authorization", `Bearer ${donorToken}`);
    expect(donor.status).toBe(403);
    expect(donor.body.error).toContain("permission");
  });

  it("returns the consolidated payload with the seeded rows in every bucket", async () => {
    const res = await request(app)
      .get("/api/cause-analytics")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    // causes totals block
    expect(res.body.causes.total).toBeGreaterThanOrEqual(1);
    expect(res.body.causes.totalRaised).toBeGreaterThanOrEqual(PLEDGE_PER_MONTH);
    expect(res.body.causes.totalNeeded).toBeGreaterThanOrEqual(MONTHLY_COST * 12);

    // condition donut includes my condition
    const cond = res.body.condition.find((g: { condition: string }) => g.condition === "CARDIAC");
    expect(cond).toBeTruthy();
    expect(cond.count).toBeGreaterThanOrEqual(1);
    expect(cond.monthlyCost).toBeGreaterThanOrEqual(MONTHLY_COST);

    // status bar includes SEEKING
    expect(res.body.status.some((g: { status: string }) => g.status === "SEEKING")).toBe(true);

    // monthly: 12 buckets; this month's pledge value included
    expect(res.body.monthly).toHaveLength(12);
    const thisMonth = res.body.monthly[res.body.monthly.length - 1];
    expect(thisMonth.amount).toBeGreaterThanOrEqual(PLEDGE_PER_MONTH);
    expect(thisMonth.count).toBeGreaterThanOrEqual(1);

    // pledge totals
    expect(res.body.pledges.total).toBeGreaterThanOrEqual(1);
    expect(res.body.pledges.active).toBeGreaterThanOrEqual(1);
    expect(res.body.pledges.monthlyValue).toBeGreaterThanOrEqual(PLEDGE_PER_MONTH);

    // top cities include mine
    expect(res.body.topCities.some((g: { city: string }) => g.city === CITY)).toBe(true);

    // top causes include mine with pct math
    const top = res.body.topCauses.find((c: { id: string }) => c.id === causeId);
    expect(top).toBeTruthy();
    expect(top.total).toBe(MONTHLY_COST * 12);
    expect(top.pct).toBe(Math.min(100, Math.round((PLEDGE_PER_MONTH / (MONTHLY_COST * 12)) * 100)));
  });
});
