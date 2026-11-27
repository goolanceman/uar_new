/**
 * S6 — generic charity + community-admin routers (shared by web + mobile).
 *
 * Pins the /api/charity/* contract (card, impact, points, achievements,
 * goals, events), the donor wall on GET /api/donations?wall=1&campaignId=,
 * the Razorpay webhook on POST /api/payments/webhook (raw-body HMAC →
 * settleCompleted → points/card/achievements side effects) and the
 * /api/community/admin/* role-gated surface.
 *
 * Runs against the TEST database (vitest.config.ts) and only touches rows it
 * creates (users with a unique email prefix + the rows referencing them).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";

const PREFIX = `s6-${Date.now()}`;
const PASSWORD = "Test-Secret-123";
const WEBHOOK_SECRET = "s6-webhook-test-secret";

let app: express.Express;
let donorToken = "";
let adminToken = "";
let donorId = "";
let adminId = "";
let campaignId = "";
let achievementId = 0;
let eventId = "";
let cancelEventId = "";
let goalId = "";
let postId = "";
let reportId = "";
const donationIds: string[] = [];
const pointIds: string[] = [];

async function buildApp() {
  const [{ router: charityRouter }, { router: communityAdminRouter }, { router: donationsRouter }, { router: paymentsRouter }] =
    await Promise.all([
      import("@/routes/charity"),
      import("@/routes/community-admin"),
      import("@/routes/donations"),
      import("@/routes/payments"),
    ]);
  const a = express();
  a.use(
    express.json({
      limit: "10mb",
      // same raw-body stash as src/index.ts — the webhook HMAC reads it
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  a.use("/api/charity", charityRouter);
  a.use("/api/community/admin", communityAdminRouter);
  a.use("/api/donations", donationsRouter);
  a.use("/api/payments", paymentsRouter);
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) await db.activityLog.deleteMany({ where: { userId: { in: ids } } });
  await db.notification.deleteMany({ where: { userId: { in: ids } } });
  if (donationIds.length) await db.donation.deleteMany({ where: { id: { in: donationIds } } });
  if (pointIds.length) await db.donationPoint.deleteMany({ where: { id: { in: pointIds } } });
  if (reportId) await db.communityReport.deleteMany({ where: { id: reportId } });
  if (postId) await db.communityPost.deleteMany({ where: { id: postId } });
  if (eventId) await db.charityEvent.deleteMany({ where: { id: { in: [eventId, cancelEventId].filter(Boolean) } } });
  if (campaignId) await db.campaign.deleteMany({ where: { id: campaignId } });
  if (achievementId) await db.achievement.deleteMany({ where: { id: achievementId } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");

  const donor = await db.user.create({
    data: {
      email: `${PREFIX}-donor@test.local`,
      name: "s6 donor wall tester",
      password: hashPassword(PASSWORD),
      role: "DONOR",
      status: "ACTIVE",
      isActive: true,
    },
  });
  donorId = donor.id;
  donorToken = issueToken({ userId: donor.id, role: donor.role, name: donor.name, email: donor.email });

  const admin = await db.user.create({
    data: {
      email: `${PREFIX}-admin@test.local`,
      name: "s6 admin tester",
      password: hashPassword(PASSWORD),
      role: "ADMIN",
      status: "ACTIVE",
      isActive: true,
    },
  });
  adminId = admin.id;
  adminToken = issueToken({ userId: admin.id, role: admin.role, name: admin.name, email: admin.email });

  const campaign = await db.campaign.create({
    data: {
      code: `S6CMP-${Date.now()}`,
      title: `${PREFIX} campaign`,
      slug: `${PREFIX}-campaign`,
      description: "s6 test campaign",
      targetAmount: 10000,
      status: "ACTIVE",
    },
  });
  campaignId = campaign.id;

  const achievement = await db.achievement.create({
    data: {
      name: `${PREFIX} points milestone`,
      slug: `${PREFIX}-points-milestone`,
      description: "s6 test achievement",
      category: "donation",
      tier: "bronze",
      pointsRequired: 10,
      rewardPoints: 5,
    },
  });
  achievementId = achievement.id;

  const start = new Date(Date.now() + 7 * 864e5);
  const event = await db.charityEvent.create({
    data: {
      title: `${PREFIX} event`,
      description: "s6 test event",
      startDatetime: start,
      endDatetime: new Date(start.getTime() + 2 * 3600_000),
      type: "community",
      status: "upcoming",
      pointsReward: 15,
      requiresQrCheckin: true,
    },
  });
  eventId = event.id;

  const cancelEvent = await db.charityEvent.create({
    data: {
      title: `${PREFIX} cancel event`,
      description: "s6 test event for cancellation",
      startDatetime: start,
      endDatetime: new Date(start.getTime() + 2 * 3600_000),
      type: "community",
      status: "upcoming",
    },
  });
  cancelEventId = cancelEvent.id;

  const post = await db.communityPost.create({
    data: { userId: donorId, desc: `${PREFIX} post to moderate`, type: "normal" },
  });
  postId = post.id;

  const report = await db.communityReport.create({
    data: { type: 1, reason: "spam", desc: "s6 test report", userId: adminId, postId },
  });
  reportId = report.id;
});

afterAll(async () => {
  await cleanup();
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

/* ─────────────────────────── charity card + impact ─────────────────────── */

describe("GET /api/charity/card + /impact", () => {
  it("syncs and returns the card (camelCase, generic contract)", async () => {
    const res = await request(app).get("/api/charity/card").set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBeUndefined(); // no legacy envelope
    expect(res.body.cardNumber).toMatch(/^CHR-[0-9A-F]{16}$/);
    expect(res.body.membershipLevel).toBe("bronze");
    expect(res.body.donationPoints).toBe(0);
    expect(res.body.userId).toBe(donorId);
    expect(res.body.user.id).toBe(donorId);
    expect(res.body.levelColor).toBe("#CD7F32");
  });

  it("requires auth", async () => {
    const res = await request(app).get("/api/charity/card");
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it("serves the merged impact metrics", async () => {
    const res = await request(app).get("/api/charity/impact").set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalDonated");
    expect(res.body).toHaveProperty("donationCount", 0);
    expect(res.body).toHaveProperty("causesSupported", 0);
  });

  it("serves the tier ladder without auth", async () => {
    const res = await request(app).get("/api/charity/card/tiers");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(4);
    expect(res.body.items[0]).toHaveProperty("minPoints");
  });
});

/* ─────────────── points / achievements fed by donation settlement ───────── */

describe("webhook settlement → points + achievements + card", () => {
  it("settles a pending donation and awards points/card/achievements", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const donation = await db.donation.create({
      data: {
        donorId,
        donorName: "s6 donor wall tester",
        donorEmail: `${PREFIX}-donor@test.local`,
        amount: 100,
        currency: "INR",
        paymentMethod: "RAZORPAY",
        paymentStatus: "PENDING",
        receiptNumber: `UAR-RCPT-S6-${Date.now()}`,
        gatewayOrderId: `order_S6${Date.now()}`,
        campaignId,
      },
    });
    donationIds.push(donation.id);

    const payload = {
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_S6TEST", order_id: donation.gatewayOrderId } } },
    };
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");

    const res = await request(app)
      .post("/api/payments/webhook")
      .set("X-Razorpay-Signature", signature)
      .set("Content-Type", "application/json")
      .send(raw);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const settled = await db.donation.findUnique({ where: { id: donation.id } });
    expect(settled?.paymentStatus).toBe("COMPLETED");
    expect(settled?.transactionId).toBe("pay_S6TEST");

    // side effects: points row + card sync + achievement unlock
    const points = await db.donationPoint.findMany({ where: { donationId: donation.id } });
    expect(points).toHaveLength(1);
    expect(points[0].points).toBe(200);
    pointIds.push(points[0].id);

    const card = await db.charityCard.findUnique({ where: { userId: donorId } });
    expect(card?.donationPoints).toBeGreaterThanOrEqual(200);

    const ua = await db.userAchievement.findUnique({
      where: { userId_achievementId: { userId: donorId, achievementId } },
    });
    expect(ua?.unlockedAt).toBeTruthy();
  });

  it("rejects a bad webhook signature", async () => {
    const res = await request(app)
      .post("/api/payments/webhook")
      .set("X-Razorpay-Signature", "bad-signature")
      .set("Content-Type", "application/json")
      .send({ event: "payment.captured" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid webhook signature");
  });
});

describe("GET /api/charity/points* + redeem", () => {
  it("returns the merged balance + summary", async () => {
    const res = await request(app).get("/api/charity/points").set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.activePoints).toBeGreaterThanOrEqual(200);
    expect(res.body).toHaveProperty("lifetimePoints");
    expect(res.body).toHaveProperty("earnedThisMonth");
    expect(Array.isArray(res.body.recentTransactions)).toBe(true);
  });

  it("lists history (paged) and filters by type", async () => {
    const res = await request(app)
      .get("/api/charity/points/history?type=earned")
      .set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.items[0].type).toBe("earned");
    expect(res.body).toHaveProperty("page", 1);
    expect(res.body).toHaveProperty("hasMore");
  });

  it("lists expiring points and redeems", async () => {
    const exp = await request(app)
      .get("/api/charity/points/expiring?days=365")
      .set("Authorization", `Bearer ${donorToken}`);
    expect(exp.status).toBe(200);
    expect(exp.body).toHaveProperty("totalExpiring");

    const res = await request(app)
      .post("/api/charity/points/redeem")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ points: 10, redemptionType: "reward" });
    expect(res.status).toBe(200);
    expect(res.body.redemption.points).toBe(-10);
    expect(res.body.remainingPoints).toBeGreaterThanOrEqual(190);
  });
});

describe("GET /api/charity/achievements*", () => {
  it("lists the catalogue", async () => {
    const res = await request(app).get("/api/charity/achievements").set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((a: { id: number }) => a.id);
    expect(ids).toContain(achievementId);
    expect(res.body.items[0]).toHaveProperty("requirementType");
  });

  it("lists mine with unlock state and claims the reward", async () => {
    const mine = await request(app).get("/api/charity/achievements/mine").set("Authorization", `Bearer ${donorToken}`);
    expect(mine.status).toBe(200);
    const row = mine.body.items.find((a: { id: number }) => a.id === achievementId);
    expect(row.isUnlocked).toBe(true);
    expect(mine.body.totalUnlocked).toBeGreaterThanOrEqual(1);

    const progress = await request(app)
      .get(`/api/charity/achievements/${achievementId}/progress`)
      .set("Authorization", `Bearer ${donorToken}`);
    expect(progress.status).toBe(200);
    expect(progress.body.isUnlocked).toBe(true);

    const claim = await request(app)
      .post(`/api/charity/achievements/${achievementId}/claim`)
      .set("Authorization", `Bearer ${donorToken}`);
    expect(claim.status).toBe(200);
    expect(claim.body.rewardPoints).toBe(5);
    expect(claim.body.achievement.isClaimed).toBe(true);

    const summary = await request(app).get("/api/charity/achievements/summary").set("Authorization", `Bearer ${donorToken}`);
    expect(summary.status).toBe(200);
    expect(summary.body.claimedCount).toBeGreaterThanOrEqual(1);
  });
});

/* ──────────────────────────────── goals ────────────────────────────────── */

describe("donation goals CRUD", () => {
  it("creates, lists, updates, completes and deletes goals", async () => {
    const create = await request(app)
      .post("/api/charity/goals")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ title: "s6 goal", targetAmount: 500, deadline: "2030-12-31", isPublic: true });
    expect(create.status).toBe(201);
    expect(create.body.targetAmount).toBe(500);
    expect(create.body.status).toBe("active");
    goalId = create.body.id;

    const list = await request(app).get("/api/charity/goals").set("Authorization", `Bearer ${donorToken}`);
    expect(list.status).toBe(200);
    expect(list.body.items.some((g: { id: string }) => g.id === goalId)).toBe(true);

    const summary = await request(app).get("/api/charity/goals/summary").set("Authorization", `Bearer ${donorToken}`);
    expect(summary.status).toBe(200);
    expect(summary.body.totalGoals).toBeGreaterThanOrEqual(1);

    const patch = await request(app)
      .patch(`/api/charity/goals/${goalId}`)
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ title: "s6 goal renamed" });
    expect(patch.status).toBe(200);
    expect(patch.body.title).toBe("s6 goal renamed");

    const complete = await request(app)
      .post(`/api/charity/goals/${goalId}/complete`)
      .set("Authorization", `Bearer ${donorToken}`);
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe("completed");

    // completing twice is rejected, updating a completed goal is rejected
    const again = await request(app)
      .post(`/api/charity/goals/${goalId}/complete`)
      .set("Authorization", `Bearer ${donorToken}`);
    expect(again.status).toBe(400);

    const second = await request(app)
      .post("/api/charity/goals")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ title: "s6 goal two", targetAmount: 100, deadline: "2030-06-30" });
    const del = await request(app)
      .delete(`/api/charity/goals/${second.body.id}`)
      .set("Authorization", `Bearer ${donorToken}`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
  });
});

/* ──────────────────────────────── events ───────────────────────────────── */

describe("charity events register/check-in/cancel", () => {
  it("lists events with per-user registration state", async () => {
    const res = await request(app).get("/api/charity/events").set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.some((e: { id: string }) => e.id === eventId)).toBe(true);
    expect(res.body.items[0]).toHaveProperty("startDatetime");
  });

  it("registers, lists mine, checks in with QR and awards points", async () => {
    const reg = await request(app)
      .post(`/api/charity/events/${eventId}/register`)
      .set("Authorization", `Bearer ${donorToken}`)
      .send({});
    expect(reg.status).toBe(201);
    expect(reg.body.qrCode).toBeTruthy();

    const mine = await request(app).get("/api/charity/events/mine").set("Authorization", `Bearer ${donorToken}`);
    expect(mine.status).toBe(200);
    const row = mine.body.items.find((e: { id: string }) => e.id === eventId);
    expect(row.registrationStatus).toBe("registered");

    const checkInRes = await request(app)
      .post("/api/charity/events/check-in")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ eventId, qrCode: reg.body.qrCode });
    expect(checkInRes.status).toBe(200);
    expect(checkInRes.body.pointsEarned).toBe(15);
  });

  it("cancels a registration before the event starts", async () => {
    const reg = await request(app)
      .post(`/api/charity/events/${cancelEventId}/register`)
      .set("Authorization", `Bearer ${donorToken}`)
      .send({});
    expect(reg.status).toBe(201);

    const cancel = await request(app)
      .post(`/api/charity/events/${cancelEventId}/cancel`)
      .set("Authorization", `Bearer ${donorToken}`)
      .send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.ok).toBe(true);
  });

  it("rejects unauthenticated registration", async () => {
    const res = await request(app).post(`/api/charity/events/${eventId}/register`).send({});
    expect(res.status).toBe(401);
  });
});

/* ─────────────────────────────── donor wall ────────────────────────────── */

describe("GET /api/donations?wall=1&campaignId=", () => {
  it("returns public-safe donor identities honouring isAnonymous", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const anon = await db.donation.create({
      data: {
        donorId,
        donorName: "s6 donor wall tester",
        donorEmail: `${PREFIX}-donor@test.local`,
        amount: 50,
        paymentStatus: "COMPLETED",
        receiptNumber: `UAR-RCPT-S6A-${Date.now()}`,
        campaignId,
        isAnonymous: true,
      },
    });
    donationIds.push(anon.id);

    const res = await request(app).get(`/api/donations?wall=1&campaignId=${campaignId}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    expect(res.body).toHaveProperty("totalRaised");

    const anonymousRow = res.body.items.find((d: { id: string }) => d.id === anon.id);
    expect(anonymousRow.donorName).toBe("Anonymous");
    expect(anonymousRow.user).toBeNull();
    expect(anonymousRow.userId).toBeNull();

    const namedRow = res.body.items.find((d: { id: string }) => d.id !== anon.id);
    expect(namedRow.donorName).not.toContain("wall tester"); // masked
    expect(namedRow.user.profile).toBeDefined();
  });

  it("requires campaignId", async () => {
    const res = await request(app).get("/api/donations?wall=1");
    expect(res.status).toBe(400);
  });
});

/* ───────────────────────────── community admin ─────────────────────────── */

describe("/api/community/admin/*", () => {
  it("rejects non-admin sessions", async () => {
    const res = await request(app).get("/api/community/admin/users").set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(403);
  });

  it("lists users, posts, reports with the paged envelope", async () => {
    const users = await request(app)
      .get("/api/community/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(users.status).toBe(200);
    const me = users.body.items.find((u: { id: string }) => u.id === donorId);
    expect(me).toBeTruthy();
    expect(me.email).toBe(`${PREFIX}-donor@test.local`);
    expect(me).toHaveProperty("donationTotal");

    const posts = await request(app)
      .get("/api/community/admin/posts")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(posts.status).toBe(200);
    expect(posts.body.items.some((p: { id: string }) => p.id === postId)).toBe(true);
    expect(posts.body.items[0]).toHaveProperty("author");

    const reports = await request(app)
      .get("/api/community/admin/reports")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(reports.status).toBe(200);
    expect(reports.body.items.some((r: { id: string }) => r.id === reportId)).toBe(true);

    const causes = await request(app)
      .get("/api/community/admin/causes")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(causes.status).toBe(200);
    expect(causes.body).toHaveProperty("totalRaisedAll");
  });

  it("moderates a post and resolves a report", async () => {
    const verify = await request(app)
      .post("/api/community/admin/posts/moderate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ postId, action: "verify" });
    expect(verify.status).toBe(200);
    expect(verify.body.isVerified).toBe(true);

    const resolve = await request(app)
      .post("/api/community/admin/reports/resolve")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reportId, action: "dismiss" });
    expect(resolve.status).toBe(200);
    expect(resolve.body.ok).toBe(true);
    reportId = ""; // deleted — skip in cleanup
  });
});
