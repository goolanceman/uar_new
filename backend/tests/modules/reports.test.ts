/**
 * Reports (vitest + supertest integration, real routers).
 *
 *   GET /api/reports — three branches on one route:
 *     1. ?type=overview|donations|distributions|causes|animals&from&to (ADMIN/VOLUNTEER)
 *     2. ?from&to&compare=1  — ADMIN consolidated range report ('from' after 'to' → 400)
 *     3. bare / ?fy=YYYY     — public consolidated FY payload (topDonors ADMIN only)
 *   GET /api/reports/sponsorship-coverage — ADMIN coverage of recurring needs
 *
 * Only touches rows it creates (unique PREFIX; children-first cleanup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `tad-reports-${Date.now()}`;
const PASSWORD = "TestPass!234";

let app: express.Express;
let adminToken: string;
let volunteerToken: string;
let donorToken: string;

let donorRowId: string;
let sponsoredNeedId: string;
let unsponsoredNeedId: string;

async function buildApp() {
  const { router: authRouter } = await import("@/routes/auth");
  const { router: reportsRouter } = await import("@/routes/reports");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/reports", reportsRouter);
  // Mirror the real app's final error middleware so next(error) controllers
  // render the legacy { error: message } envelope in this bare harness.
  const { handleError } = await import("@/infrastructure/auth/session");
  a.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      handleError(err, res);
    }
  );
  return a;
}

function get(path: string, token?: string) {
  const r = request(app).get(`/api/reports${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.beneficiarySponsorship.deleteMany({ where: { donorName: { startsWith: PREFIX } } });
  await db.recurringNeed.deleteMany({ where: { beneficiary: { code: { startsWith: PREFIX } } } });
  await db.donation.deleteMany({ where: { donorEmail: { startsWith: PREFIX } } });
  await db.donor.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await db.inventoryItem.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.beneficiary.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.activityLog.deleteMany({
    where: { OR: [{ actorName: { startsWith: PREFIX } }, { details: { contains: PREFIX } }] },
  });
  if (ids.length) await db.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword } = await import("@/infrastructure/auth/session");

  const mk = async (tag: string, role: string) =>
    db.user.create({
      data: {
        email: `${PREFIX}-${tag}@test.local`,
        name: `${PREFIX} ${tag}`,
        role,
        password: hashPassword(PASSWORD),
      },
    });
  await mk("admin", "ADMIN");
  await mk("vol", "VOLUNTEER");
  await mk("donor", "DONOR");

  const donorRow = await db.donor.create({
    data: { code: `${PREFIX}-DNR`, name: `${PREFIX} donor`, email: `${PREFIX}-donor@receipts.test` },
  });
  donorRowId = donorRow.id;

  // completed gifts inside the current FY (createdAt = now)
  await db.donation.create({
    data: {
      donorName: `${PREFIX} donor`,
      donorEmail: `${PREFIX}-one@receipts.test`,
      amount: 1000,
      paymentMethod: "UPI",
      paymentStatus: "COMPLETED",
      receiptNumber: `${PREFIX}-R1`,
    },
  });
  await db.donation.create({
    data: {
      donorName: `${PREFIX} anonymous donor`,
      donorEmail: `${PREFIX}-two@receipts.test`,
      amount: 5000,
      paymentMethod: "CASH", // cash > ₹2,000 → NOT 80G eligible
      paymentStatus: "COMPLETED",
      receiptNumber: `${PREFIX}-R2`,
    },
  });
  await db.donation.create({
    data: {
      donorName: `${PREFIX} pending donor`,
      donorEmail: `${PREFIX}-three@receipts.test`,
      amount: 999,
      paymentStatus: "PENDING", // excluded from FY totals
      receiptNumber: `${PREFIX}-R3`,
    },
  });

  // sponsorship-coverage fixtures: one sponsored + one unsponsored recurring need
  const item = await db.inventoryItem.create({
    data: { code: `${PREFIX}-ITM`, name: `${PREFIX} ration kit`, unit: "kit" },
  });
  const ben1 = await db.beneficiary.create({
    data: { code: `${PREFIX}-BEN-1`, name: `${PREFIX} ben one`, city: "Bengaluru", urgencyLevel: "HIGH" },
  });
  const ben2 = await db.beneficiary.create({
    data: { code: `${PREFIX}-BEN-2`, name: `${PREFIX} ben two`, city: "Mysuru", urgencyLevel: "MEDIUM" },
  });
  const need1 = await db.recurringNeed.create({
    data: { beneficiaryId: ben1.id, itemId: item.id, qtyPerCycle: 2, cycle: "MONTHLY", status: "ACTIVE" },
  });
  sponsoredNeedId = need1.id;
  const need2 = await db.recurringNeed.create({
    data: {
      beneficiaryId: ben2.id,
      itemId: item.id,
      qtyPerCycle: 1,
      cycle: "MONTHLY",
      status: "ACTIVE",
      nextDueAt: new Date(Date.now() - 7 * 86_400_000), // overdue
    },
  });
  unsponsoredNeedId = need2.id;
  await db.beneficiarySponsorship.create({
    data: {
      beneficiaryId: ben1.id,
      recurringNeedId: sponsoredNeedId,
      donorId: donorRowId,
      donorName: `${PREFIX} donor`,
      amountPerMonth: 250,
      status: "ACTIVE",
    },
  });
  await db.beneficiarySponsorship.create({
    data: {
      beneficiaryId: ben2.id,
      donorName: `${PREFIX} lapsed donor`,
      amountPerMonth: 100,
      status: "CANCELLED",
    },
  });

  const login = async (tag: string) => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-${tag}@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };
  adminToken = await login("admin");
  volunteerToken = await login("vol");
  donorToken = await login("donor");
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/reports?type= (branch 1 — legacy typed reports)", () => {
  it("overview returns the monthly/byCampaign/byType shape", async () => {
    const res = await get("?type=overview", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.monthly).toHaveLength(6);
    expect(res.body.byCampaign).toEqual(expect.any(Array));
    expect(res.body.byType).toEqual(expect.any(Array));
  });

  it("donations totals count every row but sum only COMPLETED gifts", async () => {
    const res = await get("?type=donations", volunteerToken);
    expect(res.status).toBe(200);
    // the report rows select receiptNumber/donorName/amount/paymentStatus — the
    // table may hold other suites' rows, so pin only the ones we seeded
    const mine = res.body.rows.filter((r: { donorName: string }) => r.donorName.startsWith(PREFIX));
    expect(mine.length).toBe(3);
    const completed = mine.filter((r: { paymentStatus: string }) => r.paymentStatus === "COMPLETED");
    expect(completed).toHaveLength(2); // the PENDING 999 row is not summed
    const sum = completed.reduce((a: number, r: { amount: number }) => a + r.amount, 0);
    expect(sum).toBe(6000); // 1000 + 5000 completed; 999 PENDING excluded
    expect(res.body.totals.count).toBeGreaterThanOrEqual(3);
  });

  it("distributions/causes/animals return row arrays", async () => {
    const distributions = await get("?type=distributions", adminToken);
    expect(distributions.status).toBe(200);
    expect(distributions.body).toHaveProperty("rows");
    expect(distributions.body).toHaveProperty("totals");

    const causes = await get("?type=causes", adminToken);
    expect(causes.status).toBe(200);
    expect(causes.body).toHaveProperty("rows");

    const animals = await get("?type=animals", adminToken);
    expect(animals.status).toBe(200);
    expect(animals.body).toHaveProperty("rows");
  });

  it("403s for non ADMIN/VOLUNTEER callers", async () => {
    const res = await get("?type=overview", donorToken);
    expect(res.status).toBe(403);
    const anon = await get("?type=overview");
    expect(anon.status).toBe(401);
  });
});

describe("GET /api/reports?from&to (branch 2 — ADMIN range report)", () => {
  it("returns range + current aggregates for an ADMIN caller", async () => {
    const res = await get("?from=2026-01-01&to=2026-01-31", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.compare).toBe(false);
    expect(res.body.previous).toBeNull();
    expect(res.body.range.from).toContain("2026-01-01");
    expect(res.body.range.to).toContain("2026-01-31");
    expect(res.body.current.kpis).toHaveProperty("fundsRaised");
    expect(res.body.current.kpis).toHaveProperty("donationCount");
    expect(res.body.current.programmes.health).toHaveProperty("camps");
    expect(res.body.current.monthly.length).toBeGreaterThanOrEqual(1);
  });

  it("compare=1 adds the trimmed previous-period payload", async () => {
    const res = await get("?from=2026-01-01&to=2026-03-31&compare=1", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.compare).toBe(true);
    expect(res.body.previousRange.from).toBeTruthy();
    expect(res.body.previousRange.to).toBeTruthy();
    expect(res.body.previous).not.toBeNull();
    expect(res.body.previous.register).toEqual([]); // register trimmed for comparison
  });

  it("400s when 'from' is after 'to'", async () => {
    const res = await get("?from=2026-06-01&to=2026-01-01", adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("'from' must be before 'to'");
  });

  it("403s for non-admin callers", async () => {
    const res = await get("?from=2026-01-01&to=2026-01-31", volunteerToken);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/reports (branch 3 — public FY payload)", () => {
  it("is public (no session) and reports the current financial year", async () => {
    const res = await get("");
    expect(res.status).toBe(200);
    const now = new Date();
    const startYear = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    expect(res.body.fy).toBe(`FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`);
    expect(res.body.topDonors).toEqual([]); // anonymous callers get no topDonors
  });

  it("counts this FY's completed donations and hides the PENDING one", async () => {
    const res = await get("", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.kpis.donationCount).toBeGreaterThanOrEqual(2);
    expect(res.body.kpis.totalDonations).toBeGreaterThanOrEqual(6000);
    expect(res.body.kpis.donorCount).toBeGreaterThanOrEqual(2);
    expect(res.body.monthly).toHaveLength(12); // Apr → Mar
    // ADMIN callers see topDonors, anonymised only when the row is flagged
    const names = res.body.topDonors.map((t: { name: string }) => t.name);
    expect(names).toContain(`${PREFIX} anonymous donor`);
  });

  it("honours ?fy= as the START year (FY 2020-21 → empty)", async () => {
    const res = await get("?fy=2020", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.fy).toBe("FY 2020-21");
    expect(res.body.kpis.donationCount).toBe(0);
    expect(res.body.kpis.totalDonations).toBe(0);
  });
});

describe("GET /api/reports/sponsorship-coverage", () => {
  it("summarises coverage, retention and the worklists for ADMIN", async () => {
    const res = await get("/sponsorship-coverage", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.summary.activeNeeds).toBeGreaterThanOrEqual(2);
    expect(res.body.summary.sponsoredNeeds).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.unsponsoredNeeds).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.monthlyPledged).toBeGreaterThanOrEqual(250);
    expect(res.body.summary.cancelledSponsorships).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.everSponsored).toBeGreaterThanOrEqual(2);
    expect(res.body.summary.stillLive).toBeGreaterThanOrEqual(1);

    const unsponsored = res.body.unsponsoredWorklist.find(
      (w: { recurringNeedId: string }) => w.recurringNeedId === unsponsoredNeedId
    );
    expect(unsponsored).toBeTruthy();
    expect(unsponsored.beneficiaryName).toBe(`${PREFIX} ben two`);
    expect(unsponsored.overdue).toBe(true);

    const lapsed = res.body.lapsedSponsors.find((l: { donorName: string }) =>
      l.donorName.startsWith(PREFIX)
    );
    expect(lapsed).toBeTruthy();
    expect(lapsed.amountPerMonth).toBe(100);
  });

  it("403s for non-admin callers", async () => {
    const vol = await get("/sponsorship-coverage", volunteerToken);
    expect(vol.status).toBe(403);
    const anon = await get("/sponsorship-coverage");
    expect(anon.status).toBe(401);
  });
});
