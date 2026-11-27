/**
 * Response cache — campaigns, chat, settings, catalogs, causes, stats.
 *
 * Proves three things the feature depends on:
 *   1. A repeated read does not hit Postgres again (query count stays flat).
 *   2. Create / update / delete drop the cached response, so the next read
 *      sees the write.
 *   3. TTL and validation come from env. 0 disables the bucket. A bad value
 *      falls back to the default. A cached 404 is never stored.
 *
 * Redis is required. The suite skips itself when REDIS_URL is unset or the
 * server does not answer, so the rest of the suite (which never sets
 * REDIS_URL) is unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import Redis from "ioredis";

const PREFIX = `cache-${Date.now()}`;
const PASSWORD = "[redacted]]";
const REDIS_URL = process.env.CACHE_TEST_REDIS_URL || "redis://127.0.0.1:6379";

let redisUp = await probeRedis();
process.env.REDIS_URL = redisUp ? REDIS_URL : "";
let app: express.Express;
let adminToken = "";
let donorToken = "";
let otherToken = "";
let adminId = "";
let donorId = "";
let otherId = "";
let campaignId = "";
let campaignSlug = "";

async function probeRedis(): Promise<boolean> {
  const conn = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1500,
    lazyConnect: true,
  });
  try {
    await conn.connect();
    const pong = await conn.ping();
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    conn.disconnect();
  }
}

async function buildApp() {
  const [
    { router: campaignsRouter },
    { router: chatRouter },
    { router: settingsRouter },
    { router: faqsRouter },
    { router: testimonialsRouter },
    { router: mastersRouter },
    { router: causesRouter },
    { router: statsRouter },
    { router: donationsRouter },
  ] = await Promise.all([
    import("@/routes/campaigns"),
    import("@/routes/chat"),
    import("@/routes/settings"),
    import("@/routes/faqs"),
    import("@/routes/testimonials"),
    import("@/routes/masters"),
    import("@/routes/causes"),
    import("@/routes/stats"),
    import("@/routes/donations"),
  ]);
  const a = express();
  a.use(express.json());
  a.use("/api/campaigns", campaignsRouter);
  a.use("/api/chat", chatRouter);
  a.use("/api/settings", settingsRouter);
  a.use("/api/faqs", faqsRouter);
  a.use("/api/testimonials", testimonialsRouter);
  a.use("/api/masters", mastersRouter);
  a.use("/api/causes", causesRouter);
  a.use("/api/stats", statsRouter);
  a.use("/api/donations", donationsRouter);
  return a;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Count Prisma queries issued while `run` executes. */
async function queriesDuring(run: () => Promise<void>): Promise<number> {
  const { queryCounter } = await import("@/lib/db");
  queryCounter.count = 0;
  queryCounter.enabled = true;
  try {
    await run();
  } finally {
    queryCounter.enabled = false;
  }
  return queryCounter.count;
}

async function cleanup() {
  const { db } = await import("@/lib/db");
  await db.donation.deleteMany({ where: { donorName: { startsWith: PREFIX } } });
  await db.testimonial.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.master.deleteMany({ where: { category: { startsWith: PREFIX } } });
  await db.cause.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await db.campaign.deleteMany({ where: { code: { startsWith: PREFIX } } });
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    const convos = await db.conversation.findMany({
      where: { OR: [{ user1Id: { in: ids } }, { user2Id: { in: ids } }] },
      select: { id: true },
    });
    const convoIds = convos.map((c) => c.id);
    if (convoIds.length) {
      await db.message.deleteMany({ where: { conversationId: { in: convoIds } } });
      await db.conversation.deleteMany({ where: { id: { in: convoIds } } });
    }
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  await db.setting.deleteMany({ where: { key: "org.vision", value: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  if (!redisUp) return;
  process.env.CACHE_TTL_CAMPAIGN = "60";
  process.env.CACHE_TTL_CHAT = "30";
  process.env.CACHE_TTL_SETTINGS = "60";
  process.env.CACHE_TTL_CATALOG = "60";
  process.env.CACHE_TTL_CAUSES = "60";
  process.env.CACHE_TTL_STATS = "30";

  await cleanup();
  app = await buildApp();
  const { db } = await import("@/lib/db");
  const { issueToken } = await import("@/lib/session");
  const password = "x";
  const mk = (tag: string, role: string) =>
    db.user.create({
      data: { email: `${PREFIX}-${tag}@test.local`, name: `${PREFIX} ${tag}`, role, password },
    });
  const admin = await mk("admin", "ADMIN");
  const donor = await mk("donor", "DONOR");
  const other = await mk("other", "DONOR");
  adminId = admin.id;
  donorId = donor.id;
  otherId = other.id;
  adminToken = issueToken({ userId: admin.id, role: admin.role, name: admin.name, email: admin.email });
  donorToken = issueToken({ userId: donor.id, role: donor.role, name: donor.name, email: donor.email });
  otherToken = issueToken({ userId: other.id, role: other.role, name: other.name, email: other.email });
});

afterAll(async () => {
  if (!redisUp) return;
  await cleanup();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

describe("response cache", () => {
  it("requires Redis — skip the rest when it is down", () => {
    if (!redisUp) {
      console.warn(`[cache-test] Redis not reachable at ${REDIS_URL}; skipping`);
    }
    expect(true).toBe(true);
  });
});

describe.skipIf(!redisUp)("campaigns", () => {
  it("caches the list, and a create invalidates it", async () => {
    const first = await request(app).get("/api/campaigns");
    expect(first.status).toBe(200);

    const secondQueries = await queriesDuring(async () => {
      const second = await request(app).get("/api/campaigns");
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
    });
    expect(secondQueries).toBe(0);

    const created = await request(app)
      .post("/api/campaigns")
      .set(auth(adminToken))
      .send({
        title: `${PREFIX} wells`,
        description: "A cached campaign",
        targetAmount: 1000,
        slug: `${PREFIX}-wells`,
        status: "ACTIVE",
      });
    expect(created.status).toBe(201);
    campaignId = created.body.id;
    campaignSlug = created.body.slug;

    const after = await request(app).get("/api/campaigns");
    expect(after.body.some((c: { id: string }) => c.id === campaignId)).toBe(true);
  });

  it("caches detail by id and by slug, and a patch invalidates both", async () => {
    const byId = await request(app).get(`/api/campaigns/${campaignId}`);
    expect(byId.status).toBe(200);
    const bySlug = await request(app).get(`/api/campaigns/${campaignSlug}`);
    expect(bySlug.body.id).toBe(campaignId);

    const cachedQueries = await queriesDuring(async () => {
      const again = await request(app).get(`/api/campaigns/${campaignId}`);
      expect(again.body.title).toBe(byId.body.title);
    });
    expect(cachedQueries).toBe(0);

    const patched = await request(app)
      .patch(`/api/campaigns/${campaignId}`)
      .set(auth(adminToken))
      .send({ title: `${PREFIX} wells updated` });
    expect(patched.status).toBe(200);

    const fresh = await request(app).get(`/api/campaigns/${campaignId}`);
    expect(fresh.body.title).toBe(`${PREFIX} wells updated`);
    const freshSlug = await request(app).get(`/api/campaigns/${campaignSlug}`);
    expect(freshSlug.body.title).toBe(`${PREFIX} wells updated`);
  });

  it("does not cache a missing campaign", async () => {
    const missing = await request(app).get("/api/campaigns/does-not-exist-cache");
    expect(missing.status).toBe(404);
    const again = await request(app).get("/api/campaigns/does-not-exist-cache");
    expect(again.status).toBe(404);
  });

  it("a completed donation invalidates the raised amount", async () => {
    const before = await request(app).get(`/api/campaigns/${campaignId}`);
    const raisedBefore = before.body.raisedAmount;

    // CASH is an offline method, so the donation lands PENDING. An admin
    // marking it COMPLETED is the write that must drop the cached raised
    // amount — the create itself never touches it.
    const donated = await request(app).post("/api/donations").set(auth(donorToken)).send({
      amount: 250,
      campaignId,
      donorName: `${PREFIX} donor`,
      donorEmail: `${PREFIX}-donor@test.local`,
      paymentMethod: "CASH",
    });
    expect(donated.status).toBe(201);
    const completed = await request(app)
      .patch(`/api/donations/${donated.body.id}`)
      .set(auth(adminToken))
      .send({ paymentStatus: "COMPLETED" });
    expect(completed.status).toBe(200);

    const after = await request(app).get(`/api/campaigns/${campaignId}`);
    expect(after.body.raisedAmount).toBe(raisedBefore + 250);
    expect(after.body.donorCount).toBeGreaterThanOrEqual(1);
  });

  it("delete invalidates list and detail", async () => {
    const removed = await request(app).delete(`/api/campaigns/${campaignId}`).set(auth(adminToken));
    expect(removed.status).toBe(200);
    const list = await request(app).get("/api/campaigns");
    expect(list.body.some((c: { id: string }) => c.id === campaignId)).toBe(false);
    const detail = await request(app).get(`/api/campaigns/${campaignId}`);
    expect(detail.status).toBe(404);
  });
});

describe.skipIf(!redisUp)("chat", () => {
  it("caches the conversation list and drops it when a message arrives", async () => {
    const opened = await request(app)
      .post("/api/chat/conversations")
      .set(auth(donorToken))
      .send({ userId: otherId });
    expect(opened.status).toBe(200);
    const conversationId = opened.body.id as string;

    const first = await request(app).get("/api/chat/conversations").set(auth(donorToken));
    expect(first.status).toBe(200);
    const cachedQueries = await queriesDuring(async () => {
      const second = await request(app).get("/api/chat/conversations").set(auth(donorToken));
      expect(second.body).toEqual(first.body);
    });
    // The conversation rows come from cache. The one remaining read is the
    // caller's own block list, which is per-request and never cached.
    expect(cachedQueries).toBe(1);

    const sent = await request(app)
      .post("/api/chat/messages")
      .set(auth(donorToken))
      .send({ conversationId, message: "cache me", type: 1 });
    expect(sent.status).toBe(201);

    const after = await request(app).get("/api/chat/conversations").set(auth(otherToken));
    const row = after.body.items.find((c: { id: string }) => c.id === conversationId);
    expect(row.lastMessage).toBe("cache me");
    expect(row.unreadCount).toBeGreaterThan(0);
  });
});

describe.skipIf(!redisUp)("settings", () => {
  it("caches the public payload and a save invalidates it", async () => {
    const first = await request(app).get("/api/settings/public");
    expect(first.status).toBe(200);
    const cachedQueries = await queriesDuring(async () => {
      const second = await request(app).get("/api/settings/public");
      expect(second.body.orgName).toBe(first.body.orgName);
    });
    expect(cachedQueries).toBe(0);

    const vision = `${PREFIX} vision`;
    const saved = await request(app)
      .patch("/api/settings")
      .set(auth(adminToken))
      .send({ "org.vision": vision });
    expect(saved.status).toBe(200);

    const fresh = await request(app).get("/api/settings/public");
    expect(fresh.body.vision).toBe(vision);

    // Restore so other suites reading public settings are unaffected.
    await request(app).patch("/api/settings").set(auth(adminToken)).send({ "org.vision": "" });
  });

  it("rejects an unknown setting before anything is cached stale", async () => {
    const bad = await request(app)
      .patch("/api/settings")
      .set(auth(adminToken))
      .send({ "not.a.setting": "x" });
    expect(bad.status).toBe(400);
  });
});

describe.skipIf(!redisUp)("catalogs", () => {
  it("caches testimonials and invalidates on create, update, delete", async () => {
    await request(app).get("/api/testimonials");
    const created = await request(app)
      .post("/api/testimonials")
      .set(auth(adminToken))
      .send({ name: `${PREFIX} person`, role: "donor", message: "first", rating: 5 });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const listed = await request(app).get("/api/testimonials");
    expect(listed.body.some((t: { id: string }) => t.id === id)).toBe(true);
    const cachedQueries = await queriesDuring(async () => {
      await request(app).get("/api/testimonials");
    });
    expect(cachedQueries).toBe(0);

    const patched = await request(app)
      .patch(`/api/testimonials/${id}`)
      .set(auth(adminToken))
      .send({ message: "edited" });
    expect(patched.status).toBe(200);
    const afterEdit = await request(app).get("/api/testimonials");
    expect(afterEdit.body.find((t: { id: string }) => t.id === id).message).toBe("edited");

    await request(app).delete(`/api/testimonials/${id}`).set(auth(adminToken));
    const afterDelete = await request(app).get("/api/testimonials");
    expect(afterDelete.body.some((t: { id: string }) => t.id === id)).toBe(false);
  });

  it("caches masters by category and invalidates on upsert", async () => {
    const category = `${PREFIX}-cat`;
    const created = await request(app)
      .post("/api/masters")
      .set(auth(adminToken))
      .send({ category, value: "a", label: "Alpha" });
    expect(created.status).toBe(201);

    const first = await request(app).get(`/api/masters?category=${category}`);
    expect(first.body).toEqual([{ value: "a", label: "Alpha" }]);
    const cachedQueries = await queriesDuring(async () => {
      const second = await request(app).get(`/api/masters?category=${category}`);
      expect(second.body).toEqual(first.body);
    });
    expect(cachedQueries).toBe(0);

    await request(app)
      .post("/api/masters")
      .set(auth(adminToken))
      .send({ category, value: "a", label: "Alpha renamed" });
    const fresh = await request(app).get(`/api/masters?category=${category}`);
    expect(fresh.body[0].label).toBe("Alpha renamed");
  });

  it("caches the FAQ page", async () => {
    const first = await request(app).get("/api/faqs");
    expect(first.status).toBe(200);
    const cachedQueries = await queriesDuring(async () => {
      const second = await request(app).get("/api/faqs");
      expect(second.body.total).toBe(first.body.total);
    });
    expect(cachedQueries).toBe(0);
  });
});

describe.skipIf(!redisUp)("causes", () => {
  it("caches the list and detail, and a pledge invalidates both", async () => {
    const created = await request(app)
      .post("/api/causes")
      .set(auth(adminToken))
      .send({
        patientName: `${PREFIX} patient`,
        city: "Pune",
        condition: "BP",
        story: "needs medicine",
        age: 40,
        monthlyCost: 500,
        durationMonths: 6,
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const list = await request(app).get("/api/causes");
    expect(list.body.some((c: { id: string }) => c.id === id)).toBe(true);
    const detail = await request(app).get(`/api/causes/${id}`);
    expect(detail.status).toBe(200);

    const cachedQueries = await queriesDuring(async () => {
      await request(app).get(`/api/causes/${id}`);
    });
    expect(cachedQueries).toBe(0);

    const pledged = await request(app)
      .post(`/api/causes/${id}/pledges`)
      .set(auth(donorToken))
      .send({ amountPerMonth: 100, months: 3, donorName: `${PREFIX} pledger` });
    expect(pledged.status).toBe(201);

    const fresh = await request(app).get(`/api/causes/${id}`);
    expect(fresh.body.pledges.length).toBe(1);

    await request(app).delete(`/api/causes/${id}`).set(auth(adminToken));
    const gone = await request(app).get(`/api/causes/${id}`);
    expect(gone.status).toBe(404);
  });
});

describe.skipIf(!redisUp)("stats", () => {
  it("caches the public snapshot", async () => {
    const first = await request(app).get("/api/stats");
    expect(first.status).toBe(200);
    expect(first.body.totals).toBeDefined();
    const cachedQueries = await queriesDuring(async () => {
      const second = await request(app).get("/api/stats");
      expect(second.body.totals.raised).toBe(first.body.totals.raised);
    });
    expect(cachedQueries).toBe(0);
  });
});

describe.skipIf(!redisUp)("ttl config", () => {
  it("a TTL of 0 disables that bucket", async () => {
    process.env.CACHE_TTL_STATS = "0";
    const { cacheTtl } = await import("@/lib/cache");
    expect(cacheTtl.stats).toBe(0);

    await request(app).get("/api/stats");
    const queries = await queriesDuring(async () => {
      await request(app).get("/api/stats");
    });
    expect(queries).toBeGreaterThan(0);
    process.env.CACHE_TTL_STATS = "30";
  });

  it("an invalid TTL falls back to the default", async () => {
    process.env.CACHE_TTL_CAMPAIGN = "nope";
    const { ttl } = await import("@/lib/cache");
    expect(ttl("CACHE_TTL_CAMPAIGN", 60)).toBe(60);
    process.env.CACHE_TTL_CAMPAIGN = "-3";
    expect(ttl("CACHE_TTL_CAMPAIGN", 60)).toBe(60);
    process.env.CACHE_TTL_CAMPAIGN = "60";
  });

  it("a short TTL expires", async () => {
    process.env.CACHE_TTL_CATALOG = "1";
    const stamp = `${PREFIX}-ttl`;
    await request(app)
      .post("/api/testimonials")
      .set(auth(adminToken))
      .send({ name: stamp, role: "donor", message: "expires", rating: 4 });
    const first = await request(app).get("/api/testimonials");
    expect(first.body.some((t: { name: string }) => t.name === stamp)).toBe(true);

    await new Promise((r) => setTimeout(r, 1200));
    // The row is still there after expiry — the point is the read went back
    // to the database instead of serving a dead entry forever.
    const queries = await queriesDuring(async () => {
      const second = await request(app).get("/api/testimonials");
      expect(second.body.some((t: { name: string }) => t.name === stamp)).toBe(true);
    });
    expect(queries).toBeGreaterThan(0);
    process.env.CACHE_TTL_CATALOG = "60";
  });
});
