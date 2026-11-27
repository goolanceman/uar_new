/**
 * Stories module — /api/stories (real router via @/routes/stories). Route
 * surface: multipart create, the followed-users feed, mark-viewed, single
 * fetch, metadata edit and owner/moderator delete. Only touches rows it
 * creates (unique email PREFIX).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { promises as fs } from "node:fs";
import path from "node:path";

const PREFIX = `stories-mod-${Date.now()}`;

let app: express.Express;
let aToken = ""; // follower
let bToken = ""; // poster
let modToken = ""; // DONOR + isModerator = 1
let aId = "";
let bId = "";
let storeDir = "";

const PNG = { filename: "s.png", contentType: "image/png" };

async function buildApp() {
  const { router } = await import("@/routes/stories");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/stories", router);
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
    const assets = await db.fileAsset.findMany({ where: { uploadedByName: { startsWith: PREFIX } }, select: { storedName: true } });
    await db.fileAsset.deleteMany({ where: { uploadedByName: { startsWith: PREFIX } } });
    for (const asset of assets) {
      await fs.rm(path.join(storeDir, "..", asset.storedName), { force: true }).catch(() => undefined);
    }
    await db.userFollow.deleteMany({ where: { OR: [{ myUserId: { in: ids } }, { userId: { in: ids } }] } });
    await db.user.deleteMany({ where: { id: { in: ids } } }); // stories cascade
  }
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { UPLOAD_DIR } = await import("@/domains/files");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");
  storeDir = path.join(UPLOAD_DIR); // FileAsset.storedName is UPLOAD_DIR-relative

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

  const a = await mk(`${PREFIX}-a@test.local`, `${PREFIX} a`);
  const b = await mk(`${PREFIX}-b@test.local`, `${PREFIX} b`);
  const mod = await mk(`${PREFIX}-mod@test.local`, `${PREFIX} mod`, { isModerator: 1 });
  aId = a.id;
  bId = b.id;

  const tok = (u: { id: string; role: string; name: string | null; email: string }) =>
    issueToken({ userId: u.id, role: u.role, name: u.name ?? "", email: u.email });
  aToken = tok(a);
  bToken = tok(b);
  modToken = tok(mod);

  // a follows b → b's story shows in a's feed
  await db.userFollow.create({ data: { myUserId: aId, userId: bId } });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/stories (multipart create)", () => {
  it("401 without a token and 400 without content", async () => {
    const anon = await request(app).post("/api/stories").field("type", "0");
    expect(anon.status).toBe(401);

    const noContent = await request(app)
      .post("/api/stories")
      .set("Authorization", `Bearer ${bToken}`)
      .field("type", "0");
    expect(noContent.status).toBe(400);
  });

  it("creates a story with media (201, camelCase wire)", async () => {
    const res = await request(app)
      .post("/api/stories")
      .set("Authorization", `Bearer ${bToken}`)
      .field("type", "0")
      .field("duration", "5")
      .attach("content", Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000", "hex"), PNG);
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(bId);
    expect(res.body.type).toBe(0);
    expect(res.body.duration).toBe(5);
    expect(String(res.body.content)).toContain("/api/files/");
  });
});

describe("GET /api/stories + /:id + view", () => {
  let storyId = "";

  it("serves the followed-users feed and single fetch (404 unknown)", async () => {
    const created = await request(app)
      .post("/api/stories")
      .set("Authorization", `Bearer ${bToken}`)
      .field("type", "0")
      .attach("content", Buffer.from("89504e47", "hex"), PNG);
    storyId = created.body.id;

    const feed = await request(app).get("/api/stories").set("Authorization", `Bearer ${aToken}`);
    expect(feed.status).toBe(200);
    const storyUser = feed.body.items.find((u: { id: string }) => u.id === bId);
    expect(storyUser?.stories.length).toBeGreaterThanOrEqual(1);
    expect(storyUser.name).toBe(`${PREFIX} b`);

    const single = await request(app).get(`/api/stories/${storyId}`).set("Authorization", `Bearer ${aToken}`);
    expect(single.status).toBe(200);
    expect(single.body.user.id).toBe(bId);

    const missing = await request(app).get("/api/stories/does-not-exist").set("Authorization", `Bearer ${aToken}`);
    expect(missing.status).toBe(404);
  });

  it("marks the story viewed (idempotent)", async () => {
    const storyId = (await request(app).get("/api/stories").set("Authorization", `Bearer ${aToken}`)).body.items
      .find((u: { id: string }) => u.id === bId)?.stories[0]?.id;

    const res = await request(app).post(`/api/stories/${storyId}/view`).set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(res.body.viewByUserIds).toContain(aId);

    const again = await request(app).post(`/api/stories/${storyId}/view`).set("Authorization", `Bearer ${aToken}`);
    expect((again.body.viewByUserIds as string).split(",").filter(Boolean)).toHaveLength(1);
  });

  it("edits metadata as the owner and deletes (owner / moderator only)", async () => {
    const storyId = (await request(app).get("/api/stories").set("Authorization", `Bearer ${aToken}`)).body.items
      .find((u: { id: string }) => u.id === bId)?.stories[0]?.id;

    const stranger = await request(app).delete(`/api/stories/${storyId}`).set("Authorization", `Bearer ${aToken}`);
    expect(stranger.status).toBe(403); // a is a follower, not the owner/moderator

    const patch = await request(app)
      .patch(`/api/stories/${storyId}`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({ duration: "9" });
    expect(patch.status).toBe(200);

    const modDelete = await request(app).delete(`/api/stories/${storyId}`).set("Authorization", `Bearer ${modToken}`);
    expect(modDelete.status).toBe(200);

    const gone = await request(app).get(`/api/stories/${storyId}`).set("Authorization", `Bearer ${aToken}`);
    expect(gone.status).toBe(404);
  });
});
