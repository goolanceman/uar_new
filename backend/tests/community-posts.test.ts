/**
 * S2 — generic posts/stories/interests endpoints shared by web + mobile.
 *
 * Ports of the legacy mobile-only handlers (src/routes/mobile/posts.ts +
 * the post/comment Moderator handlers of src/routes/mobile/auth-users.ts):
 *   posts     → GET/POST /api/posts, GET/DELETE /api/posts/:id,
 *               GET /api/posts/user/:userId, /search, /by-interest,
 *               /by-hashtag, /hashtags, POST /api/posts/:id/report
 *   reactions → POST/DELETE /api/posts/:id/like, GET /api/posts/:id/likes
 *   comments  → GET/POST /api/posts/:id/comments,
 *               DELETE /api/posts/comments/:commentId,
 *               POST /api/posts/comments/:commentId/like
 *   stories   → GET/POST /api/stories, GET /api/stories/:id,
 *               POST /api/stories/:id/view, DELETE /api/stories/:id
 *   interests → GET /api/interests
 *   moderator → POST /api/community/users/:id/moderator-block
 *   uploads   → POST /api/files?folder=community (absolute URLs)
 *
 * Runs against the TEST database and only touches rows it creates (users with
 * a unique email prefix + their direct children).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { issueToken } from "@/infrastructure/auth/session";

const PREFIX = `s2-${Date.now()}`;
const PASSWORD = ["Pass", "w0rd!", "123"].join("");

let app: express.Express;
let adminToken = ""; // platform ADMIN → moderator powers
let aToken = "";
let bToken = "";
let modToken = ""; // DONOR role + isModerator = 1 (DB flag)
let carolToken = "";
let adminId = "";
let aId = "";
let bId = "";
let modId = "";
let cId = "";
let createdInterests = false;
let interestId = 0;

async function buildApp() {
  const [
    { router: postsRouter },
    { router: storiesRouter },
    { router: interestsRouter },
    { router: communityUsersRouter },
    { router: filesRouter },
  ] = await Promise.all([
    import("@/routes/posts"),
    import("@/routes/stories"),
    import("@/routes/interests"),
    import("@/routes/community-users"),
    import("@/routes/files"),
  ]);
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/posts", postsRouter);
  a.use("/api/stories", storiesRouter);
  a.use("/api/interests", interestsRouter);
  a.use("/api/community/users", communityUsersRouter);
  a.use("/api/files", filesRouter);
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    const posts = await db.communityPost.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    const postIds = posts.map((p) => p.id);
    await db.communityReport.deleteMany({ where: { OR: [{ userId: { in: ids } }, { postId: { in: postIds } }] } });
    await db.savedNotification.deleteMany({ where: { OR: [{ myUserId: { in: ids } }, { userId: { in: ids } }] } });
    await db.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { title: { startsWith: PREFIX } }] } });
    await db.userFollow.deleteMany({ where: { OR: [{ myUserId: { in: ids } }, { userId: { in: ids } }] } });
    await db.activityLog.deleteMany({ where: { userId: { in: ids } } });
    await db.fileAsset.deleteMany({ where: { uploadedByName: { startsWith: PREFIX } } });
    // posts/comments/likes/likeComments/contents/stories cascade with the user
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  if (createdInterests) await db.communityInterest.deleteMany({ where: { id: interestId } });
}

const PNG = { filename: "p.png", contentType: "image/png" };

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword } = await import("@/infrastructure/auth/session");

  const mk = (email: string, name: string, role: string, extra: Record<string, unknown> = {}) =>
    db.user.create({
      data: {
        email,
        name,
        role,
        password: hashPassword(PASSWORD),
        status: "ACTIVE",
        isActive: true,
        ...extra,
      },
    });

  const admin = await mk(`${PREFIX}-admin@test.local`, `${PREFIX} admin`, "ADMIN");
  const a = await mk(`${PREFIX}-a@test.local`, `${PREFIX} alice`, "DONOR");
  const b = await mk(`${PREFIX}-b@test.local`, `${PREFIX} bob`, "DONOR");
  const mod = await mk(`${PREFIX}-mod@test.local`, `${PREFIX} mod`, "DONOR", { isModerator: 1 });
  const c = await mk(`${PREFIX}-c@test.local`, `${PREFIX} carol`, "DONOR");
  adminId = admin.id;
  aId = a.id;
  bId = b.id;
  modId = mod.id;
  cId = c.id;

  const tok = (u: { id: string; role: string; name: string | null; email: string }) =>
    issueToken({ userId: u.id, role: u.role, name: u.name ?? "", email: u.email });
  adminToken = tok(admin);
  aToken = tok(a);
  bToken = tok(b);
  modToken = tok(mod);
  carolToken = tok(c);

  const interest = await db.communityInterest.create({ data: { title: `${PREFIX} interest` } });
  interestId = interest.id;
  createdInterests = true;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

async function createAPost(token: string, fields: Record<string, string> = {}, attachContent = true) {
  const req = request(app).post("/api/posts").set("Authorization", `Bearer ${token}`);
  const all = { contentType: "0", ...fields }; // image content by default
  for (const [k, v] of Object.entries(all)) req.field(k, v);
  if (attachContent) req.attach("content", Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000", "hex"), PNG);
  return req;
}

describe("S2 posts CRUD", () => {
  it("creates a post with multipart media (actor from the session)", async () => {
    const res = await createAPost(aToken, { desc: `${PREFIX} hello #love`, tags: "love", interestIds: String(interestId), contentType: "0" });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(aId); // camelCase wire
    expect(res.body.desc).toBe(`${PREFIX} hello #love`);
    expect(res.body.interestIds).toBe(String(interestId));
    expect(res.body.content).toHaveLength(1);
    expect(res.body.content[0].contentType).toBe(0);
    expect(res.body.content[0].content).toContain("/api/files/");
    expect(res.body.user?.id).toBe(aId);
  });

  it("requires auth and rejects content without contentType", async () => {
    const noAuth = await request(app).get("/api/posts");
    expect(noAuth.status).toBe(401);

    const res = await request(app)
      .post("/api/posts")
      .set("Authorization", `Bearer ${aToken}`)
      .field("desc", "x")
      .attach("content", Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000", "hex"), PNG);
    expect(res.status).toBe(400); // content without contentType
  });

  it("serves the feed with author + reactions and cause progress", async () => {
    const created = (await createAPost(bToken, { desc: `${PREFIX} b-post` })).body;
    // addPost never sets the type — causes flip their own posts server-side.
    const { db } = await import("@/infrastructure/database/prisma");
    await db.communityPost.update({ where: { id: created.id }, data: { type: "cause", goalAmount: 200, raisedAmount: 50 } });

    const res = await request(app).get("/api/posts").query({ page: 1, limit: 10 }).set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    const mine = res.body.items.find((p: { desc?: string }) => p.desc === `${PREFIX} hello #love`);
    expect(mine.user.name).toBe(`${PREFIX} alice`);
    expect(mine.isLike).toBe(0);
    const cause = res.body.items.find((p: { desc?: string }) => p.desc === `${PREFIX} b-post`);
    expect(cause.type).toBe("cause");
    expect(cause.progressPercentage).toBe(25);

    const random = await request(app).get("/api/posts").query({ type: "random", limit: 5 }).set("Authorization", `Bearer ${aToken}`);
    expect(random.status).toBe(200);
    expect(Array.isArray(random.body.items)).toBe(true);
  });

  it("fetches a single post", async () => {
    const created = await createAPost(aToken, { desc: `${PREFIX} single` });
    const res = await request(app).get(`/api/posts/${created.body.id}`).set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
    expect(res.body.user.id).toBe(aId);

    const missing = await request(app).get("/api/posts/does-not-exist").set("Authorization", `Bearer ${bToken}`);
    expect(missing.status).toBe(404);
  });

  it("lists a user's posts", async () => {
    const res = await request(app).get(`/api/posts/user/${aId}`).query({ page: 1, limit: 10 }).set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.items.every((p: { userId: string }) => p.userId === aId)).toBe(true);
  });

  it("deletes posts: owner, DB-flag moderator and platform admin — but not strangers", async () => {
    const byA = (await createAPost(aToken, { desc: `${PREFIX} del-a` })).body;
    const byB = (await createAPost(bToken, { desc: `${PREFIX} del-b` })).body;
    const byB2 = (await createAPost(bToken, { desc: `${PREFIX} del-b2` })).body;

    const stranger = await request(app).delete(`/api/posts/${byA.id}`).set("Authorization", `Bearer ${bToken}`);
    expect(stranger.status).toBe(403);

    const owner = await request(app).delete(`/api/posts/${byA.id}`).set("Authorization", `Bearer ${aToken}`);
    expect(owner.status).toBe(200);

    const dbMod = await request(app).delete(`/api/posts/${byB.id}`).set("Authorization", `Bearer ${modToken}`);
    expect(dbMod.status).toBe(200); // DONOR role but isModerator = 1 in the DB

    const admin = await request(app).delete(`/api/posts/${byB2.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(admin.status).toBe(200);

    const gone = await request(app).get(`/api/posts/${byB2.id}`).set("Authorization", `Bearer ${aToken}`);
    expect(gone.status).toBe(404);
  });
});

describe("S2 reactions", () => {
  it("likes, updates the reaction, refuses duplicates and unlikes", async () => {
    const post = (await createAPost(bToken, { desc: `${PREFIX} liked` })).body;

    const like = await request(app).post(`/api/posts/${post.id}/like`).set("Authorization", `Bearer ${aToken}`).send({ reaction: "prayers" });
    expect(like.status).toBe(200);
    expect(like.body.like.reactionType).toBe("prayers");
    expect(like.body.post.likesCount).toBe(1);

    const feed = await request(app).get(`/api/posts/${post.id}`).set("Authorization", `Bearer ${aToken}`);
    expect(feed.body.isLike).toBe(1);
    expect(feed.body.reactionType).toBe("prayers");
    expect(feed.body.prayersCount).toBe(1);
    expect(feed.body.totalReactions).toBe(1);

    const dup = await request(app).post(`/api/posts/${post.id}/like`).set("Authorization", `Bearer ${aToken}`).send({ reaction: "prayers" });
    expect(dup.status).toBe(409);

    const change = await request(app).post(`/api/posts/${post.id}/like`).set("Authorization", `Bearer ${aToken}`).send({ reaction: "help" });
    expect(change.status).toBe(200);
    expect(change.body.like.reactionType).toBe("help");

    const invalid = await request(app).post(`/api/posts/${post.id}/like`).set("Authorization", `Bearer ${aToken}`).send({ reaction: "nope" });
    expect(invalid.status).toBe(400);

    const likers = await request(app).get(`/api/posts/${post.id}/likes`).set("Authorization", `Bearer ${aToken}`);
    expect(likers.status).toBe(200);
    expect(likers.body.items.map((l: { userId: string }) => l.userId)).toContain(aId);
    expect(likers.body.items[0].user.id).toBe(aId);

    // a saved notification landed on the post owner
    const { db } = await import("@/infrastructure/database/prisma");
    const saved = await db.savedNotification.findFirst({ where: { myUserId: bId, userId: aId, postId: post.id, type: 3 } });
    expect(saved).toBeTruthy();

    const unlike = await request(app).delete(`/api/posts/${post.id}/like`).set("Authorization", `Bearer ${aToken}`);
    expect(unlike.status).toBe(200);
    const twice = await request(app).delete(`/api/posts/${post.id}/like`).set("Authorization", `Bearer ${aToken}`);
    expect(twice.status).toBe(404);

    const feed2 = await request(app).get(`/api/posts/${post.id}`).set("Authorization", `Bearer ${aToken}`);
    expect(feed2.body.isLike).toBe(0);
    expect(feed2.body.likesCount).toBe(0);

    // the unlike removed the saved notification again
    const savedGone = await db.savedNotification.findFirst({ where: { myUserId: bId, userId: aId, postId: post.id, type: 3 } });
    expect(savedGone).toBeNull();
  });
});

describe("S2 comments", () => {
  it("adds, lists, toggles likes on and deletes comments (owner path)", async () => {
    const post = (await createAPost(bToken, { desc: `${PREFIX} commented` })).body;

    const added = await request(app).post(`/api/posts/${post.id}/comments`).set("Authorization", `Bearer ${aToken}`).send({ desc: `${PREFIX} nice!` });
    expect(added.status).toBe(201);
    expect(added.body.postId).toBe(post.id);
    expect(added.body.desc).toBe(`${PREFIX} nice!`);
    expect(added.body.user.id).toBe(aId);

    const list = await request(app).get(`/api/posts/${post.id}/comments`).query({ page: 1, limit: 10 }).set("Authorization", `Bearer ${bToken}`);
    expect(list.status).toBe(200);
    const comment = list.body.items.find((c: { desc?: string }) => c.desc === `${PREFIX} nice!`);
    expect(comment.isLike).toBe(0);
    expect(comment.commentLikeCount).toBe(0);

    const toggleOn = await request(app).post(`/api/posts/comments/${comment.id}/like`).set("Authorization", `Bearer ${bToken}`);
    expect(toggleOn.status).toBe(200);
    expect(toggleOn.body.liked).toBe(true);

    const list2 = await request(app).get(`/api/posts/${post.id}/comments`).set("Authorization", `Bearer ${aToken}`);
    expect(list2.body.items[0].commentLikeCount).toBe(1);

    const toggleOff = await request(app).post(`/api/posts/comments/${comment.id}/like`).set("Authorization", `Bearer ${bToken}`);
    expect(toggleOff.body.liked).toBe(false);

    // comments_count synced (comments by non-blocked users)
    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.communityPost.findUnique({ where: { id: post.id } });
    expect(row?.commentsCount).toBe(1);

    // stranger (neither owner nor moderator) cannot delete
    const stranger = await request(app).delete(`/api/posts/comments/${comment.id}`).set("Authorization", `Bearer ${carolToken}`);
    expect(stranger.status).toBe(403);

    const ownerDel = await request(app).delete(`/api/posts/comments/${comment.id}`).set("Authorization", `Bearer ${aToken}`);
    expect(ownerDel.status).toBe(200);

    const row2 = await db.communityPost.findUnique({ where: { id: post.id } });
    expect(row2?.commentsCount).toBe(0);
  });

  it("lets a moderator delete someone else's comment", async () => {
    const post = (await createAPost(aToken, { desc: `${PREFIX} mod-comment` })).body;
    const added = await request(app).post(`/api/posts/${post.id}/comments`).set("Authorization", `Bearer ${bToken}`).send({ desc: "spam" });
    const commentId = added.body.id;

    const modDel = await request(app).delete(`/api/posts/comments/${commentId}`).set("Authorization", `Bearer ${modToken}`);
    expect(modDel.status).toBe(200);
  });
});

describe("S2 search + filters", () => {
  it("searches posts by keyword", async () => {
    await createAPost(aToken, { desc: `${PREFIX} searchable-zebra` });
    const res = await request(app).get("/api/posts/search").query({ q: "searchable-zebra", page: 1, limit: 10 }).set("Authorization", `Bearer ${bToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].desc).toContain("searchable-zebra");
  });

  it("filters by interest and lists hashtags", async () => {
    await createAPost(aToken, { desc: "interest post", interestIds: `${interestId}`, contentType: "0" });

    const byInterest = await request(app)
      .get("/api/posts/by-interest")
      .query({ ids: String(interestId), page: 1, limit: 10 })
      .set("Authorization", `Bearer ${bToken}`);
    expect(byInterest.status).toBe(200);
    expect(byInterest.body.items.every((p: { interestIds: string }) => p.interestIds.split(",").includes(String(interestId)))).toBe(true);

    const missingInterest = await request(app)
      .get("/api/posts/by-interest")
      .query({ ids: "999999" })
      .set("Authorization", `Bearer ${bToken}`);
    expect(missingInterest.status).toBe(404);

    await createAPost(bToken, { desc: "tagged post", tags: `${PREFIX}tag` });
    const byHashtag = await request(app)
      .get("/api/posts/by-hashtag")
      .query({ tags: `${PREFIX}tag`, page: 1, limit: 10 })
      .set("Authorization", `Bearer ${aToken}`);
    expect(byHashtag.status).toBe(200);
    expect(byHashtag.body.items).toHaveLength(1);

    const hashtags = await request(app).get("/api/posts/hashtags").query({ q: "tagged" }).set("Authorization", `Bearer ${aToken}`);
    expect(hashtags.status).toBe(200);
    const tag = hashtags.body.items.find((t: { tag: string }) => t.tag === `${PREFIX}tag`);
    expect(tag?.postCount).toBe(1);
  });

  it("hides posts from authors I blocked", async () => {
    const hidden = (await createAPost(bToken, { desc: `${PREFIX} blocked-post` })).body;

    const block = await request(app).post(`/api/community/users/${bId}/block`).set("Authorization", `Bearer ${aToken}`);
    expect(block.status).toBe(200);

    const feed = await request(app).get("/api/posts").query({ page: 1, limit: 50 }).set("Authorization", `Bearer ${aToken}`);
    expect(feed.body.items.some((p: { id: string }) => p.id === hidden.id)).toBe(false);

    const single = await request(app).get(`/api/posts/${hidden.id}`).set("Authorization", `Bearer ${aToken}`);
    expect(single.status).toBe(404);

    await request(app).delete(`/api/community/users/${bId}/block`).set("Authorization", `Bearer ${aToken}`);
  });

  it("reports a post", async () => {
    const post = (await createAPost(bToken, { desc: `${PREFIX} reportable` })).body;
    const res = await request(app)
      .post(`/api/posts/${post.id}/report`)
      .set("Authorization", `Bearer ${aToken}`)
      .send({ reason: "Spam", desc: `${PREFIX} report` });
    expect(res.status).toBe(200);
    expect(res.body.report.type).toBe(1);
    expect(res.body.report.postId).toBe(post.id);

    const missing = await request(app).post(`/api/posts/${post.id}/report`).set("Authorization", `Bearer ${aToken}`).send({ reason: "Spam" });
    expect(missing.status).toBe(400);
  });
});

describe("S2 stories", () => {
  it("creates a story (multipart), lists it for followers, marks it viewed", async () => {
    // a follows b → b's story shows in a's feed
    const follow = await request(app).post(`/api/community/users/${bId}/follow`).set("Authorization", `Bearer ${aToken}`);
    expect(follow.status).toBe(200);

    const created = await request(app)
      .post("/api/stories")
      .set("Authorization", `Bearer ${bToken}`)
      .field("type", "0")
      .field("duration", "5")
      .attach("content", Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000", "hex"), PNG);
    expect(created.status).toBe(201);
    expect(created.body.userId).toBe(bId);
    expect(created.body.content).toContain("/api/files/");

    const noContent = await request(app).post("/api/stories").set("Authorization", `Bearer ${bToken}`).field("type", "0");
    expect(noContent.status).toBe(400);

    const feed = await request(app).get("/api/stories").set("Authorization", `Bearer ${aToken}`);
    expect(feed.status).toBe(200);
    const storyUser = feed.body.items.find((u: { id: string }) => u.id === bId);
    expect(storyUser?.stories.length).toBeGreaterThanOrEqual(1);
    expect(storyUser.name).toBe(`${PREFIX} bob`);

    const byId = await request(app).get(`/api/stories/${created.body.id}`).set("Authorization", `Bearer ${aToken}`);
    expect(byId.status).toBe(200);
    expect(byId.body.user.id).toBe(bId);

    const viewed = await request(app).post(`/api/stories/${created.body.id}/view`).set("Authorization", `Bearer ${aToken}`);
    expect(viewed.status).toBe(200);
    expect(viewed.body.viewByUserIds).toContain(aId);
    const again = await request(app).post(`/api/stories/${created.body.id}/view`).set("Authorization", `Bearer ${aToken}`);
    expect((again.body.viewByUserIds as string).split(",").filter(Boolean)).toHaveLength(1); // idempotent
  });

  it("deletes stories: owner or moderator only", async () => {
    const mk = () =>
      request(app)
        .post("/api/stories")
        .set("Authorization", `Bearer ${aToken}`)
        .field("type", "0")
        .attach("content", Buffer.from("89504e47", "hex"), PNG);
    const s1 = await mk();
    const s2 = await mk();

    const stranger = await request(app).delete(`/api/stories/${s1.body.id}`).set("Authorization", `Bearer ${bToken}`);
    expect(stranger.status).toBe(403);

    const owner = await request(app).delete(`/api/stories/${s1.body.id}`).set("Authorization", `Bearer ${aToken}`);
    expect(owner.status).toBe(200);

    const modDel = await request(app).delete(`/api/stories/${s2.body.id}`).set("Authorization", `Bearer ${modToken}`);
    expect(modDel.status).toBe(200);
  });
});

describe("S2 interests + moderator tools", () => {
  it("lists interests with room counts", async () => {
    const res = await request(app).get("/api/interests");
    expect(res.status).toBe(200);
    const mine = res.body.items.find((i: { id: number }) => i.id === interestId);
    expect(mine?.title).toBe(`${PREFIX} interest`);
    expect(mine?.totalRoomOfInterest).toBe(0);
  });

  it("lets moderators block users (role and DB-flag paths) and refuses strangers", async () => {
    const notMod = await request(app).post(`/api/community/users/${cId}/moderator-block`).set("Authorization", `Bearer ${bToken}`);
    expect(notMod.status).toBe(403);

    const self = await request(app).post(`/api/community/users/${adminId}/moderator-block`).set("Authorization", `Bearer ${adminToken}`);
    expect(self.status).toBe(400); // cannot block yourself

    const missing = await request(app).post("/api/community/users/nope/moderator-block").set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);

    const byFlag = await request(app).post(`/api/community/users/${cId}/moderator-block`).set("Authorization", `Bearer ${modToken}`);
    expect(byFlag.status).toBe(200);
    expect(byFlag.body.user.isBlocked).toBe(true);

    // restore carol so her rows keep behaving in other tests
    const { db } = await import("@/infrastructure/database/prisma");
    await db.user.update({ where: { id: cId }, data: { isBlock: 0 } });
  });

  it("uploads community media to /api/files with absolute URLs", async () => {
    const res = await request(app)
      .post("/api/files")
      .set("Authorization", `Bearer ${aToken}`)
      .field("folder", "community")
      .attach("file", Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000", "hex"), PNG);
    expect(res.status).toBe(201);
    expect(res.body.urls).toHaveLength(1);
    expect(res.body.urls[0]).toContain("/api/files/");
    expect(res.body.files[0].folder).toBe("community");
    expect(res.body.urls[0].startsWith("http")).toBe(true);
  });
});
