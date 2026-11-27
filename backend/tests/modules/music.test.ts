/**
 * Music module — /api/music (real router via @/routes/music). Public browse +
# categories, session-scoped saved list (savedMusicIds CSV). Only touches
 * MusicCategory/CommunityMusic rows with the unique PREFIX.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `music-${Date.now()}`;

let app: express.Express;
let aToken = "";
let aId = "";
let categoryId = 0;
let musicId = 0;

async function buildApp() {
  const { router } = await import("@/routes/music");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json());
  a.use("/api/music", router);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.communityMusic.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await db.musicCategory.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");

  const a = await db.user.create({
    data: {
      email: `${PREFIX}-a@test.local`,
      name: `${PREFIX} a`,
      role: "DONOR",
      password: hashPassword("[redacted]]]"),
      status: "ACTIVE",
      isActive: true,
    },
  });
  aId = a.id;
  aToken = issueToken({ userId: a.id, role: a.role, name: a.name ?? "", email: a.email });

  const category = await db.musicCategory.create({ data: { title: `${PREFIX} lofi` } });
  categoryId = category.id;
  const m1 = await db.communityMusic.create({
    data: { categoryId, title: `${PREFIX} beat-one`, sound: "/api/files/sound1.mp3", artist: `${PREFIX} artist` },
  });
  await db.communityMusic.create({
    data: { categoryId, title: `${PREFIX} beat-two`, sound: "/api/files/sound2.mp3", artist: `${PREFIX} artist` },
  });
  musicId = m1.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/music (public browse)", () => {
  it("lists musics and filters by q + categoryId", async () => {
    const res = await request(app).get("/api/music").query({ q: PREFIX, page: 1, limit: 10 });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].title).toContain(PREFIX);
    expect(res.body.items[0].categoryId).toBe(categoryId);

    const byCategory = await request(app)
      .get("/api/music")
      .query({ categoryId: String(categoryId), page: 1, limit: 10 });
    expect(byCategory.status).toBe(200);
    expect(byCategory.body.total).toBe(2);
  });
});

describe("GET /api/music/categories (public)", () => {
  it("serves categories with their musics counts", async () => {
    const res = await request(app).get("/api/music/categories");
    expect(res.status).toBe(200);
    const mine = res.body.items.find((c: { id: number }) => c.id === categoryId);
    expect(mine?.title).toBe(`${PREFIX} lofi`);
    expect(mine?.musicsCount).toBe(2);
  });
});

describe("GET /api/music/saved (session)", () => {
  it("401 without a token", async () => {
    const res = await request(app).get("/api/music/saved");
    expect(res.status).toBe(401);
  });

  it("serves the saved CSV ids resolved to rows", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    await db.user.update({ where: { id: aId }, data: { savedMusicIds: String(musicId) } });

    const res = await request(app).get("/api/music/saved").set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(musicId);
  });
});
