/**
 * Campaign analytics — /api/campaign-analytics (vitest + supertest,
 * integration style).
 *
 * ADMIN-only consolidated payload: totals by status/category/featured/
 * urgent, funding summary, 12-month donation buckets, top campaigns and
 * reach. Seeded rows must show up in the right buckets; authz and not-found
 * paths are covered.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `tca-${Date.now()}`;
const PASSWORD = "Passw0rd!";

let app: express.Express;
let adminToken: string;
let donorToken: string;

let campaignId: string;
const CATEGORY = `${PREFIX}-MEDICAL`;
const DONATION_AMOUNT = 123.45;

async function buildApp() {
  const { router: campaignAnalyticsRouter } = await import("@/routes/campaign-analytics");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/campaign-analytics", campaignAnalyticsRouter);
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
    data: { email: `${PREFIX}-donor@test.local`, name: `${PREFIX} donor`, password: PASSWORD, role: "DONOR" },
  });

  const campaign = await db.campaign.create({
    data: {
      code: `${PREFIX}-CMP`,
      title: `${PREFIX} analytics campaign`,
      slug: `${PREFIX}-analytics-campaign`,
      description: "campaign-analytics integration suite",
      category: CATEGORY,
      targetAmount: 1000,
      raisedAmount: DONATION_AMOUNT,
      status: "ACTIVE",
      featured: true,
      beneficiaries: 7,
      volunteersEngaged: 3,
      createdBy: admin.id,
    },
  });
  campaignId = campaign.id;

  // a COMPLETED donation this month feeds the monthly buckets
  await db.donation.create({
    data: {
      donorName: `${PREFIX} donor`,
      donorEmail: `${PREFIX}-donor@test.local`,
      amount: DONATION_AMOUNT,
      currency: "INR",
      type: "ONE_TIME",
      paymentMethod: "UPI",
      paymentStatus: "COMPLETED",
      receiptNumber: `UAR-RCPT-${PREFIX}-1`,
      campaignId,
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

describe("GET /api/campaign-analytics", () => {
  it("401 anonymous / 403 non-admin", async () => {
    const anon = await request(app).get("/api/campaign-analytics");
    expect(anon.status).toBe(401);
    const donor = await request(app)
      .get("/api/campaign-analytics")
      .set("Authorization", `Bearer ${donorToken}`);
    expect(donor.status).toBe(403);
    expect(donor.body.error).toContain("permission");
  });

  it("returns the consolidated payload with the seeded rows in every bucket", async () => {
    const res = await request(app)
      .get("/api/campaign-analytics")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    // totals block
    expect(res.body.campaigns).toHaveProperty("total");
    expect(res.body.campaigns.total).toBeGreaterThanOrEqual(1);
    expect(res.body.campaigns.active).toBeGreaterThanOrEqual(1);
    expect(res.body.campaigns.featured).toBeGreaterThanOrEqual(1);
    expect(res.body.campaigns.totalRaised).toBeGreaterThanOrEqual(DONATION_AMOUNT);
    expect(res.body.campaigns.totalTarget).toBeGreaterThanOrEqual(1000);

    // category donut includes my unique category
    const cat = res.body.category.find((g: { category: string }) => g.category === CATEGORY);
    expect(cat).toBeTruthy();
    expect(cat.count).toBeGreaterThanOrEqual(1);
    expect(cat.raised).toBeGreaterThanOrEqual(DONATION_AMOUNT);

    // status bar includes ACTIVE
    expect(res.body.status.some((g: { status: string }) => g.status === "ACTIVE")).toBe(true);

    // monthly: 12 buckets, oldest → newest; the last bucket covers this month
    expect(res.body.monthly).toHaveLength(12);
    const thisMonth = res.body.monthly[res.body.monthly.length - 1];
    expect(thisMonth.amount).toBeGreaterThanOrEqual(DONATION_AMOUNT);
    expect(thisMonth.count).toBeGreaterThanOrEqual(1);

    // top campaigns include mine (raised = target → pct 100)
    const top = res.body.topCampaigns.find((c: { id: string }) => c.id === campaignId);
    expect(top).toBeTruthy();
    expect(top.title).toBe(`${PREFIX} analytics campaign`);
    expect(top.pct).toBe(100);

    // reach sums the seeded beneficiaries/volunteersEngaged
    expect(res.body.reach.beneficiaries).toBeGreaterThanOrEqual(7);
    expect(res.body.reach.volunteersEngaged).toBeGreaterThanOrEqual(3);
  });
});
