/**
 * Phase 9 — mobile Feed/Reels/Chats redesign backend support.
 *
 * The redesign reuses the existing generic routers; the only genuinely
 * missing capability was saving (bookmarking) posts — reels already have it
 * (User.savedReelIds CSV edited via PATCH /api/profile + GET /api/reels/saved).
 * This adds the symmetric posts capability:
 *   User.savedPostIds      → new CSV column (mirrors savedReelIds)
 *   PATCH /api/profile     → accepts savedPostIds
 *   GET /api/posts/saved   → the session user's saved posts (paged)
 *
 * Runs against the TEST database and only touches rows it creates (users with
 * a unique email prefix + their direct children).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { issueToken } from "@/infrastructure/auth/session";

const PREFIX = `p9-${Date.now()}`;
const PASSWORD = ["Pass", "w0rd!", "123"].join("");
const PNG = { filename: "p.png", contentType: "image/png" };

let app: express.Express;
let aToken = "";
let bToken = "";
let aId = "";
let bId = "";
let postId = "";

async function buildApp() {
  const [{ router: postsRouter }, { router: profileRouter }] = await Promise.all([
    import("@/routes/posts"),
    import("@/routes/profile"),
  ]);
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/posts", postsRouter);
  a.use("/api/profile", profileRouter);
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.communityPost.deleteMany({ where: { userId: { in: ids } } });
    await db.fileAsset.deleteMany({ where: { uploadedByName: { startsWith: PREFIX } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword } = await import("@/infrastructure/auth/session");

  const mk = (tag: string) =>
    db.user.create({
      data: {
        email: `${PREFIX}-${tag}@test.local`,
        name: `${PREFIX} ${tag}`,
        role: "DONOR",
        password: hashPassword(PASSWORD),
      },
    });

  const a = await mk("alice");
  const b = await mk("bob");
  aId = a.id;
  bId = b.id;
  aToken = issueToken({ userId: a.id, role: a.role, name: a.name ?? "", email: a.email });
  bToken = issueToken({ userId: b.id, role: b.role, name: b.name ?? "", email: b.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

function createAPost(token: string, fields: Record<string, string> = {}) {
  const req = request(app).post("/api/posts").set("Authorization", `Bearer ${token}`);
  const all = { contentType: "0", ...fields };
  for (const [k, v] of Object.entries(all)) req.field(k, v);
  req.attach("content", Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000", "hex"), PNG);
  return req;
}

// ═══════════════════════════ SAVED POSTS ═══════════════════════════
describe("GET /api/posts/saved (savedPostIds CSV via PATCH /api/profile)", () => {
  it("starts empty", async () => {
    const res = await request(app).get("/api/posts/saved").set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("requires auth", async () => {
    const res = await request(app).get("/api/posts/saved");
    expect(res.status).toBe(401);
  });

  it("returns posts whose ids are stored in the session user's savedPostIds", async () => {
    const created = await createAPost(bToken, { desc: `${PREFIX} save me` });
    expect(created.status).toBe(201);
    postId = created.body.id;

    // a saves b's post — the CSV lives on the caller's profile row.
    const patch = await request(app)
      .patch("/api/profile")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ savedPostIds: postId });
    expect(patch.status).toBe(200);

    const res = await request(app).get("/api/posts/saved").set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: { id: string }) => p.id)).toContain(postId);
    expect(res.body.total).toBe(1);
    // Serializer sanity: the saved listing uses the same wire shape as the feed.
    expect(res.body.items[0].userId).toBe(bId);
    expect(res.body.items[0].desc).toBe(`${PREFIX} save me`);
  });

  it("unsaving removes the post from the saved listing", async () => {
    const patch = await request(app)
      .patch("/api/profile")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ savedPostIds: "" });
    expect(patch.status).toBe(200);

    const res = await request(app).get("/api/posts/saved").set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("keeps savedReelIds untouched when saving posts (independent CSVs)", async () => {
    await request(app).patch("/api/profile").set("Authorization", `Bearer ${aToken}`).send({ savedReelIds: "reel-1" });
    await request(app).patch("/api/profile").set("Authorization", `Bearer ${aToken}`).send({ savedPostIds: postId });

    const { db } = await import("@/infrastructure/database/prisma");
    const user = await db.user.findUnique({ where: { id: aId }, select: { savedPostIds: true, savedReelIds: true } });
    expect(user?.savedReelIds).toBe("reel-1");
    expect(user?.savedPostIds).toBe(postId);
  });

  it("pages the saved listing (?page=&limit=)", async () => {
    const res = await request(app)
      .get("/api/posts/saved")
      .query({ page: 1, limit: 1 })
      .set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(1);
    expect(typeof res.body.hasMore).toBe("boolean");
  });
});
