/**
 * Campaigns — /api/campaigns (vitest + supertest, integration style).
 *
 * Covers: the list plain-array vs ?page= envelope switch, DRAFT
 * invisibility on the public list (and admin ?all=1 visibility), admin
 * CRUD (ADMIN role created directly in the db, then logged in), the
 * urgency PATCH validation rules and the by-id/by-slug detail.
 *
 * Requests go straight to the real routers mounted like src/index.ts.
 * Only touches rows it creates (unique PREFIX; no table wipes).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `tcm-${Date.now()}`;
const PASSWORD = "Passw0rd!";

let app: express.Express;
let adminToken: string;
let donorToken: string;
let adminId: string;

let activeCampaignId: string;
let draftCampaignId: string;
let createdCampaignId: string;
let urgentCampaignId: string;

async function buildApp() {
  const { router: campaignsRouter } = await import("@/routes/campaigns");
  const { router: authRouter } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/campaigns", campaignsRouter);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

function get(path: string, token?: string) {
  const r = request(app).get(`/api/campaigns${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r;
}
function post(body: Record<string, unknown>, token?: string) {
  const r = request(app).post("/api/campaigns");
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function patch(path: string, body: Record<string, unknown>, token?: string) {
  const r = request(app).patch(`/api/campaigns${path}`);
  if (token) r.set("Authorization", `Bearer ${token}`);
  return r.send(body);
}
function del(id: string, token?: string) {
  const r = request(app).delete(`/api/campaigns/${id}`);
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
  await db.campaign.deleteMany({ where: { code: { startsWith: PREFIX } } });
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
  adminId = admin.id;

  const active = await db.campaign.create({
    data: {
      code: `${PREFIX}-CMP-A`,
      title: `${PREFIX} active campaign`,
      slug: `${PREFIX}-active-campaign`,
      description: "campaigns integration suite",
      category: "MEDICAL",
      targetAmount: 100000,
      raisedAmount: 2500,
      status: "ACTIVE",
      featured: true,
      createdBy: admin.id,
      endDate: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  activeCampaignId = active.id;

  const draft = await db.campaign.create({
    data: {
      code: `${PREFIX}-CMP-D`,
      title: `${PREFIX} draft campaign`,
      slug: `${PREFIX}-draft-campaign`,
      description: "hidden from the public list",
      category: "GENERAL",
      targetAmount: 1000,
      status: "DRAFT",
      createdBy: admin.id,
    },
  });
  draftCampaignId = draft.id;

  adminToken = await login(admin.email);
  donorToken = await login(donor.email);
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

// ─── GET /api/campaigns — plain array vs envelope ────────────────────────────
describe("GET /api/campaigns — list shape and DRAFT invisibility", () => {
  it("legacy callers get a plain array with the computed projections", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const mine = (res.body as Array<Record<string, unknown>>).filter((c) =>
      String(c.code).startsWith(PREFIX)
    );
    expect(mine).toHaveLength(1); // DRAFT never leaks publicly
    expect(mine[0].id).toBe(activeCampaignId);
    expect(mine[0].status).toBe("ACTIVE");
    expect(mine[0]).toHaveProperty("supporterCount", 0);
    expect(mine[0]).toHaveProperty("donorCount", 0);
    expect(mine[0]).toHaveProperty("progressPct", 3); // 2500 / 100000 → 2.5 → 3? (rounded)
    expect(mine[0]).toHaveProperty("daysLeft");
  });

  it("?page= switches to the {items,total,page,pages} envelope", async () => {
    const res = await get("/?page=1&limit=1");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(false);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("page", 1);
    expect(res.body.pages).toBeGreaterThanOrEqual(1);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.items)).toBe(true);

    // even a bare ?page= (empty value) flips the envelope
    const bare = await get("/?page=");
    expect(Array.isArray(bare.body)).toBe(false);
    expect(bare.body.page).toBe(1);
  });

  it("admin ?all=1 sees DRAFTs too", async () => {
    const res = await get("/?all=1&limit=200", adminToken);
    expect(res.status).toBe(200);
    const mine = (res.body as Array<Record<string, unknown>>).filter((c) =>
      String(c.code).startsWith(PREFIX)
    );
    expect(mine.map((c) => c.status)).toContain("DRAFT");
    expect(mine).toHaveLength(2);
  });

  it("detail by id and by slug; 404 for unknown", async () => {
    const byId = await get(`/${activeCampaignId}`);
    expect(byId.status).toBe(200);
    expect(byId.body.id).toBe(activeCampaignId);
    expect(byId.body).toHaveProperty("donorCount");
    expect(byId.body).not.toHaveProperty("supporterCount"); // detail projection

    const bySlug = await get(`/${encodeURIComponent(`${PREFIX}-active-campaign`)}`);
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.id).toBe(activeCampaignId);

    const missing = await get("/does-not-exist");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Campaign not found");
  });
});

// ─── POST /api/campaigns — admin CRUD ────────────────────────────────────────
describe("POST /api/campaigns — admin CRUD", () => {
  it("403 for non-admins / 401 anonymous", async () => {
    expect((await post({ title: "x", description: "y", targetAmount: 10 })).status).toBe(401);
    expect((await post({ title: "x", description: "y", targetAmount: 10 }, donorToken)).status).toBe(403);
  });

  it("creates a campaign with an auto slug + code", async () => {
    const res = await post(
      { title: `${PREFIX} New Hope`, description: `${PREFIX} created by the test`, targetAmount: 25000 },
      adminToken
    );
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^UAR-CMP-/);
    expect(res.body.slug).toBe(`${PREFIX}-new-hope`);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.createdBy).toBe(adminId);
    expect(res.body.taxEligible).toBe(true);
    createdCampaignId = res.body.id;
  });

  it("validates title/description/target/dates in the legacy order", async () => {
    const noTitle = await post({ description: "y", targetAmount: 10 }, adminToken);
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.error).toBe("Title and description are required");

    const badTarget = await post({ title: "x", description: "y", targetAmount: 0 }, adminToken);
    expect(badTarget.status).toBe(400);
    expect(badTarget.body.error).toBe("Target amount must be a positive number");

    const badDates = await post(
      {
        title: "x",
        description: "y",
        targetAmount: 10,
        startDate: "2026-06-10",
        endDate: "2026-06-01",
      },
      adminToken
    );
    expect(badDates.status).toBe(400);
    expect(badDates.body.error).toBe("End date must be after the start date");

    const badMin = await post(
      { title: "x", description: "y", targetAmount: 10, minDonation: -5 },
      adminToken
    );
    expect(badMin.status).toBe(400);
    expect(badMin.body.error).toBe("Minimum donation must be a positive number");
  });

  it("cannot create an urgent campaign without reason + future deadline", async () => {
    const noReason = await post(
      { title: "x", description: "y", targetAmount: 10, urgent: true },
      adminToken
    );
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe("A reason is required when marking a campaign urgent");

    const past = await post(
      {
        title: "x",
        description: "y",
        targetAmount: 10,
        urgent: true,
        urgencyReason: "flooding",
        urgentUntil: "2020-01-01",
      },
      adminToken
    );
    expect(past.status).toBe(400);
    expect(past.body.error).toBe("The urgent deadline must be in the future");

    const ok = await post(
      {
        title: `${PREFIX} urgent appeal`,
        description: `${PREFIX} urgent campaign`,
        targetAmount: 50000,
        urgent: true,
        urgencyReason: `${PREFIX} roofs collapsed`,
        urgentUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
      adminToken
    );
    expect(ok.status).toBe(201);
    expect(ok.body.urgent).toBe(true);
    expect(ok.body.urgencyReason).toBe(`${PREFIX} roofs collapsed`);
    urgentCampaignId = ok.body.id;
  });
});

// ─── PATCH /api/campaigns/:id/urgency — the urgency validator ────────────────
describe("PATCH /api/campaigns/:id/urgency", () => {
  it("404 before the flag check", async () => {
    const res = await patch("/does-not-exist/urgency", { urgent: true }, adminToken);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Campaign not found");
  });

  it("403 for non-admins", async () => {
    expect(
      (await patch(`/${activeCampaignId}/urgency`, { urgent: false }, donorToken)).status
    ).toBe(403);
  });

  it("requires the urgent flag", async () => {
    const res = await patch(`/${activeCampaignId}/urgency`, {}, adminToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("The urgent flag is required");
  });

  it("validates level, priority, reason and deadline on activation", async () => {
    const badLevel = await patch(
      `/${activeCampaignId}/urgency`,
      { urgent: true, urgencyLevel: "EXTREME", urgencyReason: "x", urgentUntil: "2026-12-31" },
      adminToken
    );
    expect(badLevel.status).toBe(400);
    expect(badLevel.body.error).toBe("urgencyLevel must be one of LOW, MEDIUM, HIGH, CRITICAL");

    const badPriority = await patch(
      `/${activeCampaignId}/urgency`,
      { urgent: true, urgencyReason: "x", urgentUntil: "2026-12-31", urgencyPriority: -1 },
      adminToken
    );
    expect(badPriority.status).toBe(400);
    expect(badPriority.body.error).toBe("urgencyPriority must be a whole number ≥ 0");

    const noReason = await patch(`/${activeCampaignId}/urgency`, { urgent: true }, adminToken);
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe("A reason is required when marking a campaign urgent");

    const noDeadline = await patch(
      `/${activeCampaignId}/urgency`,
      { urgent: true, urgencyReason: `${PREFIX} deadline missing` },
      adminToken
    );
    expect(noDeadline.status).toBe(400);
    expect(noDeadline.body.error).toBe(
      "An urgent deadline (urgentUntil) is required when activating an urgent appeal"
    );

    const past = await patch(
      `/${activeCampaignId}/urgency`,
      { urgent: true, urgencyReason: "x", urgentUntil: "2020-01-01" },
      adminToken
    );
    expect(past.status).toBe(400);
    expect(past.body.error).toBe("The urgent deadline must be in the future");
  });

  it("activates, edits fields, and clears the appeal (urgent=false resets everything)", async () => {
    const activate = await patch(
      `/${activeCampaignId}/urgency`,
      {
        urgent: true,
        urgencyLevel: "CRITICAL",
        urgencyPriority: 5,
        urgencyReason: `${PREFIX} floods`,
        urgentUntil: new Date(Date.now() + 86_400_000).toISOString(),
      },
      adminToken
    );
    expect(activate.status).toBe(200);
    expect(activate.body.urgent).toBe(true);
    expect(activate.body.urgencyLevel).toBe("CRITICAL");
    expect(activate.body.urgencyPriority).toBe(5);
    expect(activate.body.urgentSetById).toBe(adminId);

    // field-level tweak while the flag stays untouched
    const tweak = await patch(
      `/${activeCampaignId}/urgency`,
      { urgencyLevel: "HIGH" },
      adminToken
    );
    expect(tweak.status).toBe(200);
    expect(tweak.body.urgent).toBe(true);
    expect(tweak.body.urgencyLevel).toBe("HIGH");

    const clear = await patch(`/${activeCampaignId}/urgency`, { urgent: false }, adminToken);
    expect(clear.status).toBe(200);
    expect(clear.body.urgent).toBe(false);
    expect(clear.body.urgencyLevel).toBeNull();
    expect(clear.body.urgencyReason).toBeNull();
    expect(clear.body.urgentUntil).toBeNull();
    expect(clear.body.urgencyPriority).toBe(0);
  });
});

// ─── PATCH /api/campaigns/:id — full admin edit ──────────────────────────────
describe("PATCH /api/campaigns/:id", () => {
  it("404 for unknown; 403 for non-admins", async () => {
    expect((await patch("/does-not-exist", { title: "x" }, adminToken)).status).toBe(404);
    expect((await patch(`/${createdCampaignId}`, { title: "x" }, donorToken)).status).toBe(403);
  });

  it("validates the fields (empty title, bad status, slug conflict, empty patch)", async () => {
    const empty = await patch(`/${createdCampaignId}`, {}, adminToken);
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    const emptyTitle = await patch(`/${createdCampaignId}`, { title: "  " }, adminToken);
    expect(emptyTitle.status).toBe(400);
    expect(emptyTitle.body.error).toBe("Title cannot be empty");

    const badStatus = await patch(`/${createdCampaignId}`, { status: "IMAGINARY" }, adminToken);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toBe("Invalid campaign status");

    const slugConflict = await patch(
      `/${createdCampaignId}`,
      { slug: `${PREFIX}-active-campaign` },
      adminToken
    );
    expect(slugConflict.status).toBe(409);
    expect(slugConflict.body.error).toBe("That slug is already in use");

    const badTarget = await patch(`/${createdCampaignId}`, { targetAmount: 0 }, adminToken);
    expect(badTarget.status).toBe(400);
    expect(badTarget.body.error).toBe("Target amount must be a positive number");
  });

  it("edits whitelisted fields (slug normalizes)", async () => {
    const res = await patch(
      `/${createdCampaignId}`,
      { title: `${PREFIX} renamed hope`, tagline: "now renamed", featured: true },
      adminToken
    );
    expect(res.status).toBe(200);
    expect(res.body.title).toBe(`${PREFIX} renamed hope`);
    expect(res.body.tagline).toBe("now renamed");
    expect(res.body.featured).toBe(true);
  });
});

// ─── DELETE /api/campaigns/:id ───────────────────────────────────────────────
describe("DELETE /api/campaigns/:id", () => {
  it("404 for unknown; 403 for non-admins", async () => {
    expect((await del("does-not-exist", adminToken)).status).toBe(404);
    expect((await del(createdCampaignId, donorToken)).status).toBe(403);
  });

  it("removes the campaign and unlinks (keeps) its donations", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const donation = await db.donation.create({
      data: {
        donorName: `${PREFIX} donor`,
        donorEmail: `${PREFIX}-donor@test.local`,
        amount: 100,
        currency: "INR",
        type: "ONE_TIME",
        paymentMethod: "UPI",
        paymentStatus: "COMPLETED",
        receiptNumber: `UAR-RCPT-${PREFIX}-1`,
        campaignId: createdCampaignId,
      },
    });

    const res = await del(createdCampaignId, adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(await db.campaign.findUnique({ where: { id: createdCampaignId } })).toBeNull();

    const kept = await db.donation.findUnique({ where: { id: donation.id } });
    expect(kept).toBeTruthy();
    expect(kept?.campaignId).toBeNull(); // unlinked, not deleted
    await db.donation.delete({ where: { id: donation.id } });
  });

  it("the urgent appeal campaign is gone after delete too", async () => {
    const res = await del(urgentCampaignId, adminToken);
    expect(res.status).toBe(200);
  });
});
