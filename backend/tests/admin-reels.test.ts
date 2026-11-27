/**
 * Admin reels list — GET /api/community/admin/reels.
 *
 * Every reel with its transcode state, paged, searchable and filterable by
 * status. Moderator-only. Status is read from the Redis cache when present.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `adminreels-${Date.now()}`;
const PASSWORD = "[redacted]]";

let app: express.Express;
let adminToken = "";
let userToken = "";
let userId = "";
const mediaIds: string[] = [];

async function buildApp() {
  const { router } = await import("@/routes/community-admin");
  const a = express();
  a.use(express.json());
  a.use("/api/community/admin", router);
  return a;
}

async function cleanup() {
  const { db } = await import("@/lib/db");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.communityReel.deleteMany({ where: { userId: { in: ids } } });
    await db.mediaAsset.deleteMany({ where: { ownerId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/lib/db");
  const session = await import("@/lib/session");
  const password = "60d46e9c6c368b28d10ac8c87c7a9ef2:bca4c8e948b49f09ddc43256c67c9b3dfe25a9869d1370c6e66a287c2fcbb8e8";

  const mk = (email: string, name: string, username: string, extra: Record<string, unknown> = {}) =>
    db.user.create({
      data: { email, name, username, role: "DONOR", password, status: "ACTIVE", isActive: true, ...extra },
    });

  const user = await mk(`${PREFIX}@test.local`, `${PREFIX} author`, `${PREFIX}-author`);
  userId = user.id;
  const admin = await mk(`${PREFIX}-admin@test.local`, `${PREFIX} admin`, `${PREFIX}-admin`, { role: "ADMIN" });

  const tokenFor = (u: { id: string; role: string; name: string; email: string }) =>
    session.issueToken({ userId: u.id, role: u.role, name: u.name, email: u.email });
  userToken = tokenFor(user);
  adminToken = tokenFor(admin);

  for (const status of ["processing", "ready", "failed"] as const) {
    const media = await db.mediaAsset.create({
      data: {
        ownerId: userId,
        purpose: "reel",
        sourceKey: `${PREFIX}/${status}.mp4`,
        sourceMime: "video/mp4",
        sourceSize: 1000,
        status,
        attempts: status === "failed" ? 3 : 1,
        error: status === "failed" ? "ENOENT: missing source" : null,
      },
    });
    mediaIds.push(media.id);
    await db.communityReel.create({ data: { userId, mediaId: media.id, description: `${PREFIX} ${status} reel` } });
  }
  await db.communityReel.create({ data: { userId, description: `${PREFIX} legacy reel` } });
});

afterAll(cleanup);

describe("GET /api/community/admin/reels", () => {
  it("rejects a normal user", async () => {
    const res = await request(app).get("/api/community/admin/reels").set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it("lists every reel with its transcode state, paged", async () => {
    const res = await request(app)
      .get("/api/community/admin/reels")
      .query({ q: PREFIX, limit: 2, page: 1 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.hasMore).toBe(true);

    const page2 = await request(app)
      .get("/api/community/admin/reels")
      .query({ q: PREFIX, limit: 2, page: 2 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.hasMore).toBe(false);
  });

  it("filters by transcode status and reports the failure reason", async () => {
    const res = await request(app)
      .get("/api/community/admin/reels")
      .query({ q: PREFIX, status: "failed" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].transcode.status).toBe("failed");
    expect(res.body.items[0].transcode.attempts).toBe(3);
    expect(res.body.items[0].transcode.error).toContain("ENOENT");
  });

  it("rejects an unknown status", async () => {
    const res = await request(app)
      .get("/api/community/admin/reels")
      .query({ status: "nope" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it("prefers the cached status over the stored row", async () => {
    const { setCachedMedia } = await import("@/lib/cache");
    await setCachedMedia({ id: mediaIds[0], status: "ready", ownerId: userId, attempts: 1, error: null });

    const res = await request(app)
      .get("/api/community/admin/reels")
      .query({ q: `${PREFIX} processing`, status: "processing" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    // The row is still "processing" in the database, so the filter matches,
    // but the response shows the cached state the worker last wrote.
    expect(res.body.items[0].transcode.status).toBe("ready");
  });
});
