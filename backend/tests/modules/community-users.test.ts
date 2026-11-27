/**
 * Community users module — /api/community/users (real router via
 * @/routes/community-users). Route surface: profile, follow / unfollow,
 * followers / following lists, block / unblock + blocked list, report,
 * search / search-chat / random and the moderator-block gate (DB user
 * isModerator=1). Only touches rows it creates (unique email PREFIX).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `cusers-${Date.now()}`;

let app: express.Express;
let aToken = ""; // actor
let bToken = ""; // target
let cToken = ""; // second actor
let modToken = ""; // DONOR role + isModerator = 1 (DB flag)
let aId = "";
let bId = "";
let cId = "";

async function buildApp() {
  const { router } = await import("@/routes/community-users");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json());
  a.use("/api/community/users", router);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.communityReport.deleteMany({ where: { userId: { in: ids } } });
    await db.savedNotification.deleteMany({ where: { OR: [{ myUserId: { in: ids } }, { userId: { in: ids } }] } });
    await db.notification.deleteMany({ where: { userId: { in: ids } } });
    await db.userFollow.deleteMany({ where: { OR: [{ myUserId: { in: ids } }, { userId: { in: ids } }] } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");

  const mk = (email: string, name: string, extra: Record<string, unknown> = {}) =>
    db.user.create({
      data: {
        email,
        name,
        role: "DONOR",
        password: hashPassword("[redacted]]]"),
        status: "ACTIVE",
        isActive: true,
        ...extra,
      },
    });

  const a = await mk(`${PREFIX}-a@test.local`, `${PREFIX} alice`);
  const b = await mk(`${PREFIX}-b@test.local`, `${PREFIX} bob`);
  const c = await mk(`${PREFIX}-c@test.local`, `${PREFIX} carol`);
  const mod = await mk(`${PREFIX}-mod@test.local`, `${PREFIX} mod`, { isModerator: 1 });
  aId = a.id;
  bId = b.id;
  cId = c.id;

  const tok = (u: { id: string; role: string; name: string | null; email: string }) =>
    issueToken({ userId: u.id, role: u.role, name: u.name ?? "", email: u.email });
  aToken = tok(a);
  bToken = tok(b);
  cToken = tok(c);
  modToken = tok(mod);
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("profiles + follow graph", () => {
  it("follows, surfaces the edge on the profile and in the lists, then unfollows", async () => {
    const follow = await request(app).post(`/api/community/users/${bId}/follow`).set("Authorization", `Bearer ${aToken}`);
    expect(follow.status).toBe(200);
    expect(follow.body.userId).toBe(bId);
    expect(follow.body.myUserId).toBe(aId);

    const dup = await request(app).post(`/api/community/users/${bId}/follow`).set("Authorization", `Bearer ${aToken}`);
    expect(dup.status).toBe(409);

    const self = await request(app).post(`/api/community/users/${aId}/follow`).set("Authorization", `Bearer ${aToken}`);
    expect(self.status).toBe(400);

    const profile = await request(app).get(`/api/community/users/${bId}`).set("Authorization", `Bearer ${aToken}`);
    expect(profile.status).toBe(200);
    expect(profile.body.id).toBe(bId);
    expect(profile.body.followingStatus).toBe(2); // I follow him

    const followers = await request(app)
      .get(`/api/community/users/${bId}/followers`)
      .query({ page: 1, limit: 10 })
      .set("Authorization", `Bearer ${bToken}`);
    expect(followers.status).toBe(200);
    expect(followers.body.items.map((u: { id: string }) => u.id)).toContain(aId);

    const following = await request(app)
      .get(`/api/community/users/${aId}/following`)
      .query({ page: 1, limit: 10 })
      .set("Authorization", `Bearer ${bToken}`);
    expect(following.status).toBe(200);
    expect(following.body.items.map((u: { id: string }) => u.id)).toContain(bId);

    const missing = await request(app)
      .get("/api/community/users/no-such-user/followers")
      .set("Authorization", `Bearer ${bToken}`);
    expect(missing.status).toBe(404);

    const unfollow = await request(app).delete(`/api/community/users/${bId}/follow`).set("Authorization", `Bearer ${aToken}`);
    expect(unfollow.status).toBe(200);

    const notFollowing = await request(app)
      .delete(`/api/community/users/${bId}/follow`)
      .set("Authorization", `Bearer ${aToken}`);
    expect(notFollowing.status).toBe(404);
  });
});

describe("block / unblock", () => {
  it("blocks, lists blocked, refuses re-block and unblocks", async () => {
    const block = await request(app).post(`/api/community/users/${cId}/block`).set("Authorization", `Bearer ${aToken}`);
    expect(block.status).toBe(200);

    const dup = await request(app).post(`/api/community/users/${cId}/block`).set("Authorization", `Bearer ${aToken}`);
    expect(dup.status).toBe(409);

    const self = await request(app).post(`/api/community/users/${aId}/block`).set("Authorization", `Bearer ${aToken}`);
    expect(self.status).toBe(400);

    const blockedList = await request(app)
      .get("/api/community/users/me/blocked")
      .query({ page: 1, limit: 10 })
      .set("Authorization", `Bearer ${aToken}`);
    expect(blockedList.status).toBe(200);
    expect(blockedList.body.items.map((u: { id: string }) => u.id)).toContain(cId);

    const unblock = await request(app).delete(`/api/community/users/${cId}/block`).set("Authorization", `Bearer ${aToken}`);
    expect(unblock.status).toBe(200);

    const blockedList2 = await request(app)
      .get("/api/community/users/me/blocked")
      .set("Authorization", `Bearer ${aToken}`);
    expect(blockedList2.body.items.map((u: { id: string }) => u.id)).not.toContain(cId);
  });
});

describe("report + search + random", () => {
  it("reports a user (type 2) and rejects a blank reason", async () => {
    const res = await request(app)
      .post(`/api/community/users/${bId}/report`)
      .set("Authorization", `Bearer ${aToken}`)
      .send({ reason: "Spam", desc: `${PREFIX} report` });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe(2);
    expect(res.body.userId).toBe(bId);

    const noReason = await request(app)
      .post(`/api/community/users/${bId}/report`)
      .set("Authorization", `Bearer ${aToken}`)
      .send({ reason: "", desc: "x" });
    expect(noReason.status).toBe(400);
  });

  it("searches visible profiles and chat contacts by q", async () => {
    const search = await request(app)
      .get("/api/community/users/search")
      .query({ q: "bob", page: 1, limit: 10 })
      .set("Authorization", `Bearer ${aToken}`);
    expect(search.status).toBe(200);
    expect(search.body.items.map((u: { id: string }) => u.id)).toContain(bId);

    const searchChat = await request(app)
      .get("/api/community/users/search-chat")
      .query({ q: "carol", page: 1, limit: 10 })
      .set("Authorization", `Bearer ${aToken}`);
    expect(searchChat.status).toBe(200);
    expect(Array.isArray(searchChat.body.items)).toBe(true);
  });

  it("returns a random profile (object or null)", async () => {
    const res = await request(app).get("/api/community/users/random").set("Authorization", `Bearer ${cToken}`);
    expect(res.status).toBe(200);
  });
});

describe("moderator-block", () => {
  it("gates on the DB isModerator flag, 404s unknown targets and blocks for real moderators", async () => {
    const notMod = await request(app)
      .post(`/api/community/users/${cId}/moderator-block`)
      .set("Authorization", `Bearer ${bToken}`);
    expect(notMod.status).toBe(403);

    const missing = await request(app)
      .post("/api/community/users/nope/moderator-block")
      .set("Authorization", `Bearer ${modToken}`);
    expect(missing.status).toBe(404);

    const res = await request(app)
      .post(`/api/community/users/${cId}/moderator-block`)
      .set("Authorization", `Bearer ${modToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.isBlocked).toBe(true);

    // restore carol so her rows keep behaving during cleanup
    const { db } = await import("@/infrastructure/database/prisma");
    await db.user.update({ where: { id: cId }, data: { isBlock: 0 } });
  });
});

describe("auth gate", () => {
  it("401 without a token", async () => {
    const res = await request(app).get(`/api/community/users/${bId}`);
    expect(res.status).toBe(401);
  });
});
