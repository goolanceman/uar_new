/**
 * Campaigns — Phase 8 urgent funding + filters (vitest + supertest).
 *
 * Covers the mobile/web "Causes experience" contract on the GENERIC endpoints
 * (no mobile-only routes):
 *   PATCH /api/campaigns/:id/urgency  — ADMIN/MODERATOR urgency management
 *   GET   /api/campaigns              — ?urgent=1 ?category= ?q= ?sort= ?page=
 *
 * Requests go straight to the generic routers, mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import type { Prisma } from "@prisma/client";

const PREFIX = `cut-${Date.now()}`;

let app: express.Express;
let adminToken: string;
let donorToken: string;

/** Urgent appeal rows created for ordering/expiry assertions. */
let highPriorityId: string;
let midPriorityId: string;
let lowPriorityId: string;
let expiredId: string;
let plainId: string;

async function buildApp() {
  const { router: campaignsRouter } = await import("@/routes/campaigns");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/campaigns", campaignsRouter);
  return a;
}

function get(path: string) {
  return request(app).get(`/api/${path}`);
}
function patch(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}

async function loginAs(email: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "[redacted]" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function cleanup() {
  const { db } = await import("@/lib/db");
  await db.campaign.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.activityLog.deleteMany({ where: { details: { contains: PREFIX } } });
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

function campaignRow(
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> &
    Pick<Prisma.CampaignUncheckedCreateInput, "targetAmount">
): Prisma.CampaignUncheckedCreateInput {
  const n = Math.random().toString(36).slice(2, 8);
  return Object.assign(
    {
      code: `${PREFIX}-CMP-${n}`,
      slug: `${PREFIX}-cmp-${n}`,
      title: `${PREFIX} campaign ${n}`,
      description: "seed row for the urgent-funding test suite",
      status: "ACTIVE",
      createdBy: "test",
    },
    overrides
  );
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/lib/db");

  await db.user.create({
    data: {
      email: `${PREFIX}-admin@test.local`,
      name: `${PREFIX} admin`,
      password: "[redacted]",
      role: "ADMIN",
    },
  });
  await db.user.create({
    data: {
      email: `${PREFIX}-donor@test.local`,
      name: `${PREFIX} donor`,
      password: "[redacted]",
      role: "DONOR",
    },
  });
  adminToken = await loginAs(`${PREFIX}-admin@test.local`);
  donorToken = await loginAs(`${PREFIX}-donor@test.local`);

  const days = (n: number) => new Date(Date.now() + n * 86_400_000);

  // Ordered by urgencyPriority desc → high, mid, low. Expired (past deadline)
  // must auto-expire out of the urgent view and read as urgent=false.
  const high = await db.campaign.create({
    data: campaignRow({
      title: `${PREFIX} critical flood kits`,
      tagline: "rising waters",
      description: "high priority relief kits",
      category: "EMERGENCY",
      targetAmount: 100_000,
      raisedAmount: 25_000,
      featured: false,
      urgent: true,
      urgencyLevel: "CRITICAL",
      urgencyPriority: 30,
      urgencyReason: "Waters rising tonight",
      urgentUntil: days(10),
      endDate: days(40),
    }),
  });
  highPriorityId = high.id;
  const mid = await db.campaign.create({
    data: campaignRow({
      title: `${PREFIX} mid priority meals`,
      tagline: "hot meals",
      description: "medium priority food drive",
      category: "FOOD_DISTRIBUTION",
      targetAmount: 50_000,
      raisedAmount: 10_000,
      endDate: days(5),
      urgent: true,
      urgencyLevel: "HIGH",
      urgencyPriority: 20,
      urgencyReason: "Kitchen closes Friday",
      urgentUntil: days(5),
    }),
  });
  midPriorityId = mid.id;
  const low = await db.campaign.create({
    data: campaignRow({
      title: `${PREFIX} low priority tablets`,
      tagline: "monthly medicines",
      description: "low priority medicine fund",
      category: "MEDICAL",
      targetAmount: 80_000,
      raisedAmount: 80_000,
      urgent: true,
      urgencyLevel: "MEDIUM",
      urgencyPriority: 10,
      urgencyReason: "Stock runs out",
      urgentUntil: days(2),
    }),
  });
  lowPriorityId = low.id;
  const expired = await db.campaign.create({
    data: campaignRow({
      title: `${PREFIX} expired appeal`,
      description: "deadline already passed",
      category: "GENERAL",
      targetAmount: 20_000,
      urgent: true,
      urgencyLevel: "HIGH",
      urgencyPriority: 99, // would sort first if expiry were broken
      urgencyReason: "Stale appeal",
      urgentUntil: days(-1),
    }),
  });
  expiredId = expired.id;
  const plain = await db.campaign.create({
    data: campaignRow({
      title: `${PREFIX} plain evergreen programme`,
      description: "not urgent at all",
      category: "EDUCATION_SUPPORT",
      targetAmount: 200_000,
      raisedAmount: 50_000,
      featured: true,
    }),
  });
  plainId = plain.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

// ═══════════════ PERMISSIONS ═══════════════
describe("PATCH /api/campaigns/:id/urgency — permissions", () => {
  it("rejects an anonymous caller (401)", async () => {
    const res = await patch(`campaigns/${highPriorityId}/urgency`, { urgent: false });
    expect(res.status).toBe(401);
  });

  it("rejects a donor session (403)", async () => {
    const res = await patch(
      `campaigns/${highPriorityId}/urgency`,
      { urgent: false },
      donorToken
    );
    expect(res.status).toBe(403);
  });

  it("accepts an admin session", async () => {
    const res = await patch(
      `campaigns/${highPriorityId}/urgency`,
      {
        urgent: true,
        urgencyLevel: "CRITICAL",
        urgencyPriority: 30,
        urgencyReason: "Waters rising tonight",
        urgentUntil: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      },
      adminToken
    );
    expect(res.status).toBe(200);
    expect(res.body.urgent).toBe(true);
    expect(res.body.urgentSince).toBeTruthy();
    expect(res.body.urgentSetById).toBeTruthy();
  });
});

// ═══════════════ VALIDATION ═══════════════
describe("PATCH /api/campaigns/:id/urgency — validation", () => {
  const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

  it("requires a reason when activating", async () => {
    const res = await patch(
      `campaigns/${plainId}/urgency`,
      { urgent: true, urgencyLevel: "HIGH", urgentUntil: future() },
      adminToken
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("reason");
  });

  it("requires a future deadline when activating", async () => {
    const res = await patch(
      `campaigns/${plainId}/urgency`,
      { urgent: true, urgencyLevel: "HIGH", urgencyReason: `${PREFIX} test reason`, urgentUntil: new Date(Date.now() - 86_400_000).toISOString() },
      adminToken
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("future");
  });

  it("rejects an unknown urgency level", async () => {
    const res = await patch(
      `campaigns/${plainId}/urgency`,
      { urgent: true, urgencyLevel: "APOCALYPTIC", urgencyReason: `${PREFIX} reason`, urgentUntil: future() },
      adminToken
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("urgencyLevel");
  });

  it("rejects a non-positive targetAmount", async () => {
    const res = await patch(
      `campaigns/${plainId}/urgency`,
      { urgent: true, urgencyLevel: "HIGH", urgencyReason: `${PREFIX} reason`, urgentUntil: future(), targetAmount: -5 },
      adminToken
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Target amount");
  });

  it("rejects a negative urgencyPriority", async () => {
    const res = await patch(
      `campaigns/${plainId}/urgency`,
      { urgent: true, urgencyLevel: "HIGH", urgencyReason: `${PREFIX} reason`, urgentUntil: future(), urgencyPriority: -1 },
      adminToken
    );
    expect(res.status).toBe(400);
  });

  it("the general PATCH cannot bypass the activation rules", async () => {
    const res = await patch(`campaigns/${plainId}`, { urgent: true }, adminToken);
    expect(res.status).toBe(400);
  });

  it("deactivation clears every urgency field", async () => {
    const res = await patch(`campaigns/${lowPriorityId}/urgency`, { urgent: false }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.urgent).toBe(false);
    expect(res.body.urgencyLevel).toBeNull();
    expect(res.body.urgencyReason).toBeNull();
    expect(res.body.urgentUntil).toBeNull();
    expect(res.body.urgentSince).toBeNull();
    expect(res.body.urgencyPriority).toBe(0);
    // restore for the ordering tests below
    await patch(
      `campaigns/${lowPriorityId}/urgency`,
      {
        urgent: true,
        urgencyLevel: "MEDIUM",
        urgencyPriority: 10,
        urgencyReason: "Stock runs out",
        urgentUntil: future(),
      },
      adminToken
    );
  });
});

// ═══════════════ URGENT FILTER + AUTO-EXPIRE ═══════════════
describe("GET /api/campaigns?urgent=1 — ordering + expiry", () => {
  it("lists only live appeals, ordered by priority desc then deadline asc", async () => {
    const res = await get("campaigns?urgent=1");
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    const mine = list.filter((c) => String(c.code).startsWith(PREFIX));
    expect(mine.map((c) => c.id)).toEqual([highPriorityId, midPriorityId, lowPriorityId]);
    expect(mine.every((c) => c.urgent === true)).toBe(true);
  });

  it("auto-expires appeals whose deadline has passed (reads only)", async () => {
    const res = await get("campaigns?all=1");
    expect(res.status).toBe(200);
    const list = res.body as Array<Record<string, unknown>>;
    const expired = list.find((c) => c.id === expiredId);
    expect(expired).toBeTruthy();
    expect(expired?.urgent).toBe(false); // projected, not deleted

    const urgentList = await get("campaigns?urgent=1");
    const ids = (urgentList.body as Array<Record<string, unknown>>).map((c) => c.id);
    expect(ids).not.toContain(expiredId);
  });
});

// ═══════════════ CATEGORY / SEARCH / SORT ═══════════════
describe("GET /api/campaigns — category, search and sort filters", () => {
  it("?category= narrows to one category", async () => {
    const res = await get("campaigns?category=EMERGENCY");
    expect(res.status).toBe(200);
    const mine = (res.body as Array<Record<string, unknown>>).filter((c) =>
      String(c.code).startsWith(PREFIX)
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(highPriorityId);
  });

  it("?q= matches title, tagline and description", async () => {
    const byTitle = await get(`campaigns?q=${encodeURIComponent("critical flood")}`);
    expect((byTitle.body as Array<Record<string, unknown>>).some((c) => c.id === highPriorityId)).toBe(true);

    const byTagline = await get(`campaigns?q=${encodeURIComponent("hot meals")}`);
    expect((byTagline.body as Array<Record<string, unknown>>).some((c) => c.id === midPriorityId)).toBe(true);

    const byDescription = await get(`campaigns?q=${encodeURIComponent("not urgent at all")}`);
    expect((byDescription.body as Array<Record<string, unknown>>).some((c) => c.id === plainId)).toBe(true);
  });

  it("?featured=1 returns only featured campaigns", async () => {
    const res = await get("campaigns?featured=1");
    const mine = (res.body as Array<Record<string, unknown>>).filter((c) =>
      String(c.code).startsWith(PREFIX)
    );
    expect(mine.map((c) => c.id)).toEqual([plainId]);
  });

  it("?sort=ending puts the nearest deadline first (open-ended last)", async () => {
    const res = await get("campaigns?sort=ending");
    const mine = (res.body as Array<Record<string, unknown>>).filter((c) =>
      String(c.code).startsWith(PREFIX)
    );
    // mid ends in 5d, high in 40d, plain has no endDate → last
    const idxMid = mine.findIndex((c) => c.id === midPriorityId);
    const idxHigh = mine.findIndex((c) => c.id === highPriorityId);
    const idxPlain = mine.findIndex((c) => c.id === plainId);
    expect(idxMid).toBeLessThan(idxHigh);
    expect(idxHigh).toBeLessThan(idxPlain);
    expect(idxMid).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════ RESPONSE SHAPE (backward compatible) ═══════════════
describe("GET /api/campaigns — response shape", () => {
  it("default response stays a plain array with computed fields", async () => {
    const res = await get("campaigns");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const mine = (res.body as Array<Record<string, unknown>>).find((c) => c.id === highPriorityId);
    expect(mine).toBeTruthy();
    expect(typeof mine?.supporterCount).toBe("number");
    expect(typeof mine?.donorCount).toBe("number");
    expect(mine?.progressPct).toBe(25); // 25k of 100k
    expect(typeof mine?.daysLeft).toBe("number");
  });

  it("daysLeft is null when there is no valid deadline", async () => {
    const res = await get("campaigns");
    const plain = (res.body as Array<Record<string, unknown>>).find((c) => c.id === plainId);
    expect(plain?.daysLeft).toBeNull();
  });

  it("?page= opts into the {items,total,page,pages} envelope", async () => {
    const res = await get("campaigns?page=1&limit=2");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(false);
    expect(res.body.page).toBe(1);
    expect(res.body.limit === undefined || typeof res.body.total === "number").toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.pages).toBe("number");
    expect(Array.isArray(res.body.items)).toBe(true);
    expect((res.body.items as unknown[]).length).toBeLessThanOrEqual(2);
  });

  it("GET /api/campaigns/:id keeps the slug fallback and the computed fields", async () => {
    const res = await get(`campaigns/${highPriorityId}`);
    expect(res.status).toBe(200);
    expect(res.body.progressPct).toBe(25);
    expect(typeof res.body.donorCount).toBe("number");
  });
});
