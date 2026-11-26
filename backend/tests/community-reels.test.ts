/**
 * S3 — generic reel + music REST endpoints shared by web + mobile.
 *
 * Ports of the legacy mobile-only reel handlers onto the generic contract:
 *   reels    → /api/reels (explore feed, multipart create, fetch, delete
 *              owner-or-moderator, likes, views, comments with author/reel-
 *              owner/moderator delete, reports, saved list)
 *   music    → /api/music (search + category filter, categories, saved)
 *
 * Runs against the TEST database and only touches rows it creates (users with
 * a unique email prefix + their direct children).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `s3-${Date.now()}`;
const PASSWORD = ["s3", "test", "pass"].join("-");

let app: express.Express;
let aToken = ""; // reel owner
let bToken = ""; // viewer
let cToken = ""; // viewer blocked by the owner
let mToken = ""; // moderator via the DB flag (role stays DONOR)
let aId = "";
let bId = "";
let cId = "";
let mId = "";
let reelId = "";
let musicId = 0;
let categoryId = 0;
let interestId = 0;
let contentAssetId = "";
let thumbnailAssetId = "";

const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000", "hex");
const MP4 = Buffer.from("00000018667479706d703432000002006d7034316d703432", "hex");
const mp4Part = { filename: "a.mp4", contentType: "video/mp4" };
const pngPart = { filename: "a.png", contentType: "image/png" };

async function buildApp() {
  const [{ router: reelsRouter }, { router: musicRouter }] = await Promise.all([
    import("@/routes/reels"),
    import("@/routes/music"),
  ]);
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/reels", reelsRouter);
  a.use("/api/music", musicRouter);
  return a;
}

async function cleanup() {
  const { db } = await import("@/lib/db");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    const reels = await db.communityReel.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    const reelIds = reels.map((r) => r.id);
    if (reelIds.length) {
      await db.savedNotification.deleteMany({ where: { OR: [{ reelId: { in: reelIds } }, { myUserId: { in: ids } }, { userId: { in: ids } }] } });
      await db.communityReelComment.deleteMany({ where: { reelId: { in: reelIds } } });
      await db.communityLike.deleteMany({ where: { reelId: { in: reelIds } } });
      await db.communityReport.deleteMany({ where: { reelId: { in: reelIds } } });
      await db.communityReel.deleteMany({ where: { id: { in: reelIds } } });
    }
    await db.notification.deleteMany({ where: { userId: { in: ids } } });
    await db.userFollow.deleteMany({ where: { OR: [{ myUserId: { in: ids } }, { userId: { in: ids } }] } });
    await db.fileAsset.deleteMany({ where: { uploadedByName: { startsWith: PREFIX } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  if (musicId) await db.communityMusic.deleteMany({ where: { id: musicId } });
  if (categoryId) await db.musicCategory.deleteMany({ where: { id: categoryId } });
  if (interestId) await db.communityInterest.deleteMany({ where: { id: interestId } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/lib/db");
  const { hashPassword, issueToken } = await import("@/lib/session");

  const mk = (email: string, name: string, extra: Record<string, unknown> = {}) =>
    db.user.create({
      data: {
        email,
        name,
        role: "DONOR",
        password: hashPassword(PASSWORD),
        status: "ACTIVE",
        isActive: true,
        ...extra,
      },
    });

  const a = await mk(`${PREFIX}-a@test.local`, `${PREFIX} owner`, { username: `${PREFIX}-a`, isPushNotifications: 1 });
  const b = await mk(`${PREFIX}-b@test.local`, `${PREFIX} viewer`, { username: `${PREFIX}-b` });
  const c = await mk(`${PREFIX}-c@test.local`, `${PREFIX} blocked`, { username: `${PREFIX}-c` });
  const m = await mk(`${PREFIX}-m@test.local`, `${PREFIX} mod`, { username: `${PREFIX}-m`, isModerator: 1 });
  aId = a.id;
  bId = b.id;
  cId = c.id;
  mId = m.id;

  aToken = issueToken({ userId: a.id, role: "DONOR", name: a.name, email: a.email });
  bToken = issueToken({ userId: b.id, role: "DONOR", name: b.name, email: b.email });
  cToken = issueToken({ userId: c.id, role: "DONOR", name: c.name, email: c.email });
  mToken = issueToken({ userId: m.id, role: "DONOR", name: m.name, email: m.email });

  // The owner blocks viewer c (blocklist CSV — legacy User.block_user_ids).
  await db.user.update({ where: { id: aId }, data: { blockUserIds: cId } });

  const category = await db.musicCategory.create({ data: { title: `${PREFIX} category` } });
  categoryId = category.id;
  const music = await db.communityMusic.create({
    data: { categoryId, title: `${PREFIX} song`, artist: `${PREFIX} artist`, sound: "http://x/song.mp3", duration: "00:30" },
  });
  musicId = music.id;
  const interest = await db.communityInterest.create({ data: { title: `${PREFIX} interest` } });
  interestId = interest.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

describe("S3 reel create + fetch", () => {
  it("creates a reel from multipart video + thumbnail (camelCase payload)", async () => {
    const res = await request(app)
      .post("/api/reels")
      .set("Authorization", `Bearer ${aToken}`)
      .field("description", `${PREFIX} caption #fun`)
      .field("hashtags", "fun")
      .field("interestIds", String(interestId))
      .field("musicId", String(musicId))
      .attach("content", MP4, mp4Part)
      .attach("thumbnail", PNG, pngPart);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(aId);
    expect(res.body.description).toBe(`${PREFIX} caption #fun`);
    expect(res.body.hashtags).toBe("fun");
    expect(res.body.interestIds).toBe(String(interestId));
    expect(res.body.musicId).toBe(musicId);
    expect(res.body.content).toContain("/api/files/");
    expect(res.body.thumbnail).toContain("/api/files/");
    reelId = res.body.id;

    const { db } = await import("@/lib/db");
    const assets = await db.fileAsset.findMany({ where: { uploadedByName: `${PREFIX} owner` } });
    expect(assets.length).toBe(2);
    contentAssetId = assets.find((x) => x.mime === "video/mp4")?.id ?? "";
    thumbnailAssetId = assets.find((x) => x.mime === "image/png")?.id ?? "";

    // the stored reel is enriched on read: isLike, embedded author + music
    const got = await request(app).get(`/api/reels/${reelId}`).set("Authorization", `Bearer ${bToken}`);
    expect(got.status).toBe(200);
    expect(got.body.isLike).toBe(0);
    expect(got.body.user?.id).toBe(aId);
    expect(got.body.user?.name).toBe(`${PREFIX} owner`);
    expect(got.body.user?.followingStatus).toBe(0);
    expect(got.body.music?.id).toBe(musicId);
    expect(got.body.commentsCount).toBe(0);
  });

  it("requires both files and auth", async () => {
    const noAuth = await request(app).post("/api/reels").attach("content", MP4, mp4Part).attach("thumbnail", PNG, pngPart);
    expect(noAuth.status).toBe(401);

    const noThumb = await request(app)
      .post("/api/reels")
      .set("Authorization", `Bearer ${aToken}`)
      .attach("content", MP4, mp4Part);
    expect(noThumb.status).toBe(400);
  });

  it("rejects anonymous listing", async () => {
    const res = await request(app).get("/api/reels");
    expect(res.status).toBe(401);
  });
});

describe("S3 reel feeds + filters", () => {
  it("serves the foryou (random) and following feeds", async () => {
    const foryou = await request(app).get("/api/reels").query({ feed: "foryou" }).set("Authorization", `Bearer ${bToken}`);
    expect(foryou.status).toBe(200);
    expect(foryou.body.items.some((r: { id: string }) => r.id === reelId)).toBe(true);
    expect(typeof foryou.body.total).toBe("number");

    const following = await request(app).get("/api/reels").query({ feed: "following" }).set("Authorization", `Bearer ${bToken}`);
    expect(following.body.items.some((r: { id: string }) => r.id === reelId)).toBe(false);

    // b follows the owner → the following feed picks the reel up
    const { db } = await import("@/lib/db");
    await db.userFollow.create({ data: { myUserId: bId, userId: aId } });
    const after = await request(app).get("/api/reels").query({ feed: "following" }).set("Authorization", `Bearer ${bToken}`);
    expect(after.body.items.some((r: { id: string }) => r.id === reelId)).toBe(true);
    const followed = after.body.items.find((r: { id: string }) => r.id === reelId);
    expect(followed.user.followingStatus).toBe(2); // embedded follow status
    await db.userFollow.deleteMany({ where: { myUserId: bId, userId: aId } });

    const bad = await request(app).get("/api/reels").query({ feed: "nope" }).set("Authorization", `Bearer ${bToken}`);
    expect(bad.status).toBe(400);
  });

  it("lists a profile's reels (GET /api/reels/user/:userId)", async () => {
    const res = await request(app).get(`/api/reels/user/${aId}`).query({ page: 1, limit: 10 }).set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { id: string }) => r.id)).toContain(reelId);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it("filters by interest ids and keyword (GET /api/reels/by-interest)", async () => {
    const res = await request(app)
      .get("/api/reels/by-interest")
      .query({ ids: String(interestId) })
      .set("Authorization", `Bearer ${bToken}`);
    expect(res.body.items.map((r: { id: string }) => r.id)).toContain(reelId);

    const byKeyword = await request(app)
      .get("/api/reels/by-interest")
      .query({ q: `${PREFIX} caption` })
      .set("Authorization", `Bearer ${bToken}`);
    expect(byKeyword.body.items.map((r: { id: string }) => r.id)).toContain(reelId);

    const missing = await request(app)
      .get("/api/reels/by-interest")
      .query({ ids: "999999" })
      .set("Authorization", `Bearer ${bToken}`);
    expect(missing.status).toBe(404); // unknown interest
  });

  it("filters by hashtag (GET /api/reels/by-hashtag)", async () => {
    const res = await request(app)
      .get("/api/reels/by-hashtag")
      .query({ tags: "fun" })
      .set("Authorization", `Bearer ${bToken}`);
    expect(res.body.items.map((r: { id: string }) => r.id)).toContain(reelId);

    const missing = await request(app).get("/api/reels/by-hashtag").set("Authorization", `Bearer ${bToken}`);
    expect(missing.status).toBe(400);
  });

  it("filters by music (GET /api/reels/by-music/:musicId)", async () => {
    const res = await request(app).get(`/api/reels/by-music/${musicId}`).set("Authorization", `Bearer ${bToken}`);
    expect(res.body.items.map((r: { id: string }) => r.id)).toContain(reelId);

    const missing = await request(app).get("/api/reels/by-music/999999").set("Authorization", `Bearer ${bToken}`);
    expect(missing.status).toBe(404);
  });

  it("applies block filtering both ways (legacy semantics)", async () => {
    // The profile listing fails when the AUTHOR blocked the viewer…
    const profile = await request(app).get(`/api/reels/user/${aId}`).set("Authorization", `Bearer ${cToken}`);
    expect(profile.status).toBe(403); // "User blocked" (legacy fetchReelsByUserId)

    // …but the explore/by-id/by-hashtag filters use the VIEWER's own blocklist.
    const { db } = await import("@/lib/db");
    await db.user.update({ where: { id: cId }, data: { blockUserIds: aId } });

    const single = await request(app).get(`/api/reels/${reelId}`).set("Authorization", `Bearer ${cToken}`);
    expect(single.status).toBe(404);

    const feed = await request(app).get("/api/reels").query({ feed: "foryou" }).set("Authorization", `Bearer ${cToken}`);
    expect(feed.body.items.some((r: { id: string }) => r.id === reelId)).toBe(false);

    const byHashtag = await request(app)
      .get("/api/reels/by-hashtag")
      .query({ tags: "fun" })
      .set("Authorization", `Bearer ${cToken}`);
    expect(byHashtag.body.items.some((r: { id: string }) => r.id === reelId)).toBe(false);

    await db.user.update({ where: { id: cId }, data: { blockUserIds: "" } });
  });
});

describe("S3 likes, views, reports, saved", () => {
  it("toggles a like with counters + saved notifications (legacy parity)", async () => {
    const { db } = await import("@/lib/db");
    const liked = await request(app).post(`/api/reels/${reelId}/like`).set("Authorization", `Bearer ${bToken}`);
    expect(liked.status).toBe(200);
    expect(liked.body.isLike).toBe(1);
    expect(liked.body.likesCount).toBe(1);

    const savedNotif = await db.savedNotification.findFirst({ where: { reelId, userId: bId, type: 9 } });
    expect(savedNotif).toBeTruthy(); // my_user_id = owner (legacy quirk), user_id = actor
    expect(savedNotif?.myUserId).toBe(aId);
    const pushRow = await db.notification.findFirst({ where: { userId: aId, type: "REEL_LIKE" } });
    expect(pushRow).toBeTruthy();

    const disliked = await request(app).post(`/api/reels/${reelId}/like`).set("Authorization", `Bearer ${bToken}`);
    expect(disliked.body.isLike).toBe(0);
    expect(disliked.body.likesCount).toBe(0); // max(0, count-1)
    expect(await db.savedNotification.findFirst({ where: { reelId, userId: bId, type: 9 } })).toBeNull();
  });

  it("increments the view count", async () => {
    const res = await request(app).post(`/api/reels/${reelId}/view`).set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.viewsCount).toBe(1);
  });

  it("reports a reel (type 3, reporter from the session)", async () => {
    const res = await request(app)
      .post(`/api/reels/${reelId}/report`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({ reason: "Spam", desc: `${PREFIX} report` });
    expect(res.status).toBe(200);
    expect(res.body.report.type).toBe(3);
    expect(res.body.report.userId).toBe(bId);

    const noReason = await request(app)
      .post(`/api/reels/${reelId}/report`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({ desc: "x" });
    expect(noReason.status).toBe(400);
  });

  it("serves the session user's saved reels (savedReelIds CSV)", async () => {
    const { db } = await import("@/lib/db");
    await db.user.update({ where: { id: bId }, data: { savedReelIds: reelId } });

    const res = await request(app).get("/api/reels/saved").set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { id: string }) => r.id)).toContain(reelId);

    const anon = await request(app).get("/api/reels/saved");
    expect(anon.status).toBe(401);
  });
});

describe("S3 reel comments", () => {
  let commentId = "";

  it("adds and lists comments (500-char cap, owner notification)", async () => {
    const { db } = await import("@/lib/db");
    const res = await request(app)
      .post(`/api/reels/${reelId}/comments`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({ description: `${PREFIX} nice reel` });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe(`${PREFIX} nice reel`);
    expect(res.body.user?.id).toBe(bId);
    commentId = res.body.id;

    const pushRow = await db.notification.findFirst({ where: { userId: aId, type: "REEL_COMMENT" } });
    expect(pushRow).toBeTruthy();
    const saved = await db.savedNotification.findFirst({ where: { reelCommentId: commentId, type: 10 } });
    expect(saved).toBeTruthy();

    const long = await request(app)
      .post(`/api/reels/${reelId}/comments`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({ description: "x".repeat(501) });
    expect(long.status).toBe(400);

    const list = await request(app).get(`/api/reels/${reelId}/comments`).set("Authorization", `Bearer ${aToken}`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toContain(commentId);
    expect(await db.communityReel.findUnique({ where: { id: reelId }, select: { commentsCount: true } })).toMatchObject({ commentsCount: 1 });
  });

  it("only lets the author, reel owner or moderator delete a comment", async () => {
    const stranger = await request(app).delete(`/api/reels/comments/${commentId}`).set("Authorization", `Bearer ${cToken}`);
    expect(stranger.status).toBe(403);

    // moderator via the DB flag (role DONOR)
    const mod = await request(app).delete(`/api/reels/comments/${commentId}`).set("Authorization", `Bearer ${mToken}`);
    expect(mod.status).toBe(200);

    const { db } = await import("@/lib/db");
    expect(await db.communityReelComment.findUnique({ where: { id: commentId } })).toBeNull();
    expect(await db.savedNotification.findFirst({ where: { reelCommentId: commentId, type: 10 } })).toBeNull();
    expect(await db.communityReel.findUnique({ where: { id: reelId }, select: { commentsCount: true } })).toMatchObject({ commentsCount: 0 });
  });
});

describe("S3 reel deletion (owner OR moderator)", () => {
  it("refuses a non-owner non-moderator", async () => {
    const res = await request(app).delete(`/api/reels/${reelId}`).set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(403);
  });

  it("deletes as moderator with the full legacy cascade + file cleanup", async () => {
    const { db } = await import("@/lib/db");
    // dependent rows to cascade
    const like = await db.communityLike.create({ data: { userId: bId, reelId } });
    const comment = await db.communityReelComment.create({ data: { userId: bId, reelId, description: "bye" } });
    await db.savedNotification.create({ data: { myUserId: bId, userId: aId, reelCommentId: comment.id, type: 10 } });
    await db.communityReport.create({ data: { type: 3, reelId, userId: bId, reason: "Spam", desc: "x" } });

    const res = await request(app).delete(`/api/reels/${reelId}`).set("Authorization", `Bearer ${mToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expect(await db.communityReel.findUnique({ where: { id: reelId } })).toBeNull();
    expect(await db.communityLike.findUnique({ where: { id: like.id } })).toBeNull();
    expect(await db.communityReelComment.findUnique({ where: { id: comment.id } })).toBeNull();
    expect(await db.savedNotification.findFirst({ where: { reelCommentId: comment.id } })).toBeNull();
    expect(await db.communityReport.findFirst({ where: { reelId } })).toBeNull();
    // uploaded video + thumbnail assets were removed from the store
    expect(await db.fileAsset.findUnique({ where: { id: contentAssetId } })).toBeNull();
    expect(await db.fileAsset.findUnique({ where: { id: thumbnailAssetId } })).toBeNull();
  });

  it("lets the owner delete their own reel (file cleanup included)", async () => {
    const { db } = await import("@/lib/db");
    const created = await request(app)
      .post("/api/reels")
      .set("Authorization", `Bearer ${aToken}`)
      .field("description", `${PREFIX} second`)
      .attach("content", MP4, mp4Part)
      .attach("thumbnail", PNG, pngPart);
    expect(created.status).toBe(200);
    const secondId = created.body.id;

    const res = await request(app).delete(`/api/reels/${secondId}`).set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(await db.communityReel.findUnique({ where: { id: secondId } })).toBeNull();
    const remaining = await db.fileAsset.findMany({ where: { uploadedByName: `${PREFIX} owner` } });
    expect(remaining.length).toBe(0);
  });
});

describe("S3 music", () => {
  it("searches music by keyword and filters by category", async () => {
    const byQuery = await request(app).get("/api/music").query({ q: `${PREFIX} song` });
    expect(byQuery.status).toBe(200);
    expect(byQuery.body.items.map((m: { id: number }) => m.id)).toContain(musicId);

    const byArtist = await request(app).get("/api/music").query({ q: `${PREFIX} artist` });
    expect(byArtist.body.items.map((m: { id: number }) => m.id)).toContain(musicId);

    const byCategory = await request(app).get("/api/music").query({ categoryId: String(categoryId) });
    expect(byCategory.body.items.map((m: { id: number }) => m.id)).toContain(musicId);

    const camel = byQuery.body.items.find((m: { id: number }) => m.id === musicId);
    expect(camel.categoryId).toBe(categoryId);

    const none = await request(app).get("/api/music").query({ categoryId: "abc" });
    expect(none.status).toBe(200);
    expect(none.body.items).toEqual([]);
  });

  it("serves the music categories with musics counts", async () => {
    const res = await request(app).get("/api/music/categories");
    expect(res.status).toBe(200);
    const cat = res.body.items.find((c: { id: number }) => c.id === categoryId);
    expect(cat?.title).toBe(`${PREFIX} category`);
    expect(cat?.musicsCount).toBe(1);
  });

  it("serves the session user's saved music (savedMusicIds CSV)", async () => {
    const { db } = await import("@/lib/db");
    await db.user.update({ where: { id: bId }, data: { savedMusicIds: String(musicId) } });

    const res = await request(app).get("/api/music/saved").set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((m: { id: number }) => m.id)).toContain(musicId);

    const empty = await request(app).get("/api/music/saved").set("Authorization", `Bearer ${cToken}`);
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);

    const anon = await request(app).get("/api/music/saved");
    expect(anon.status).toBe(401);
  });
});
