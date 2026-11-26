/**
 * Mobile compat API — feed / post / comments module (vitest + supertest).
 * Mirrors what the Flutter feed card does (lib/common/api_service/post_service.dart,
 * moderator_service.dart): fetchPosts → action bar counts, likePost/dislikePost →
 * reaction picker, fetchComments/addComment/deleteComment → comment sheet + preview.
 *
 * Runs against the TEST database (vitest.config.ts) and only touches rows it
 * creates (users with a unique email prefix; posts/comments/likes cascade).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `mpt-${Date.now()}`;

let app: express.Express;
let me: { id: string };
let author: { id: string };
let blocked: { id: string };
let moderator: { id: string };
let postId: string;

async function buildApp() {
  const { router: mobileRouter } = await import("@/routes/mobile");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(express.urlencoded({ extended: true, limit: "10mb" }));
  a.use("/api", mobileRouter);
  return a;
}

/** POST like ApiService.call: JSON body + apikey header. */
function call(path: string, body: Record<string, unknown>) {
  return request(app).post(`/api/${path}`).set("apikey", "test").send(body);
}

async function createUser(tag: string, extra: Record<string, unknown> = {}) {
  const { db } = await import("@/lib/db");
  return db.user.create({
    data: { email: `${PREFIX}-${tag}@test.local`, name: `${tag} user`, password: "x", ...extra },
  });
}

async function fetchFeedPost(id: string) {
  const res = await call("fetchPosts", {
    my_user_id: me.id,
    limit: "100",
    start: 0,
    should_send_suggested_room: 0,
    fetch_post_type: 1,
  });
  expect(res.body.status).toBe(true);
  return (res.body.data as Array<Record<string, unknown>>).find((p) => p.id === id)!;
}

async function fetchCommentList(id: string, start = 0, limit = 20) {
  const res = await call("fetchComments", { post_id: id, my_user_id: me.id, start, limit });
  expect(res.body.status).toBe(true);
  return res.body.data as Array<Record<string, unknown>>;
}

async function cleanup() {
  const { db } = await import("@/lib/db");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  await db.savedNotification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { myUserId: { in: ids } }] } });
  await db.notification.deleteMany({ where: { userId: { in: ids } } });
  await db.communityPost.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  me = await createUser("me");
  author = await createUser("author");
  blocked = await createUser("blocked", { isBlock: 1 });
  moderator = await createUser("mod", { isModerator: 1 });

  const { db } = await import("@/lib/db");
  // Stored counter deliberately drifted (9) — only 2 visible comments + 1 by a blocked user.
  const post = await db.communityPost.create({ data: { userId: author.id, desc: "feed post", commentsCount: 9 } });
  postId = post.id;
  await db.communityComment.create({ data: { userId: author.id, postId, desc: "first" } });
  await db.communityComment.create({ data: { userId: me.id, postId, desc: "second" } });
  await db.communityComment.create({ data: { userId: blocked.id, postId, desc: "hidden" } });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

// ═══════════════════════════ FEED CARD COUNTS ═══════════════════════════
describe("feed card: comment count matches the comment sheet", () => {
  it("fetchPosts returns string ids and the real visible comment count, not the drifted counter", async () => {
    const post = await fetchFeedPost(postId);
    expect(typeof post.id).toBe("string");
    expect(typeof post.user_id).toBe("string");
    expect(post.comments_count).toBe(2);
  });

  it("fetchComments returns exactly the comments the count advertises (blocked users hidden)", async () => {
    const comments = await fetchCommentList(postId);
    expect(comments.map((c) => c.desc).sort()).toEqual(["first", "second"]);
    expect((await fetchFeedPost(postId)).comments_count).toBe(comments.length);
  });

  it("fetchComments pages with start/limit like LoadMoreWidget", async () => {
    const page1 = await fetchCommentList(postId, 0, 1);
    const page2 = await fetchCommentList(postId, 1, 1);
    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  it("fetchPostByPostId (single post screen) uses the same count", async () => {
    const res = await call("fetchPostByPostId", { post_id: postId, my_user_id: me.id });
    expect(res.body.status).toBe(true);
    expect(res.body.data.comments_count).toBe(2);
  });

  it("server-side stored counter is corrected after a comment action", async () => {
    const { db } = await import("@/lib/db");
    const add = await call("addComment", { user_id: me.id, desc: "third", post_id: postId });
    expect(add.body.status).toBe(true);
    const row = await db.communityPost.findUnique({ where: { id: postId } });
    expect(row!.commentsCount).toBe(3);
    await call("deleteComment", { user_id: me.id, comment_id: add.body.data.id });
  });
});

// ═══════════════════════════ COMMENT SHEET ═══════════════════════════
describe("comment sheet: add / delete / like", () => {
  let commentId = "";

  it("addComment returns the comment with a string id and the count goes up", async () => {
    const res = await call("addComment", { user_id: me.id, desc: "hello there", post_id: postId });
    expect(res.body.status).toBe(true);
    expect(typeof res.body.data.id).toBe("string");
    expect(res.body.data.desc).toBe("hello there");
    commentId = res.body.data.id;

    const post = await fetchFeedPost(postId);
    const comments = await fetchCommentList(postId);
    expect(post.comments_count).toBe(3);
    expect(comments).toHaveLength(3);
    expect(comments[0].id).toBe(commentId); // newest first, like the sheet inserts at 0
  });

  it("addComment validates required fields", async () => {
    const res = await call("addComment", { user_id: me.id, post_id: postId });
    expect(res.body.status).toBe(false);
  });

  it("blocked users cannot comment", async () => {
    const res = await call("addComment", { user_id: blocked.id, desc: "nope", post_id: postId });
    expect(res.body.status).toBe(false);
  });

  it("likeDislikeComment toggles is_like / comment_like_count", async () => {
    const like = await call("likeDislikeComment", { user_id: me.id, comment_id: commentId });
    expect(like.body.status).toBe(true);
    let c = (await fetchCommentList(postId)).find((x) => x.id === commentId)!;
    expect(c.is_like).toBe(1);
    expect(c.comment_like_count).toBe(1);

    await call("likeDislikeComment", { user_id: me.id, comment_id: commentId });
    c = (await fetchCommentList(postId)).find((x) => x.id === commentId)!;
    expect(c.is_like).toBe(0);
    expect(c.comment_like_count).toBe(0);
  });

  it("a user cannot delete someone else's comment", async () => {
    const res = await call("deleteComment", { user_id: author.id, comment_id: commentId });
    expect(res.body.status).toBe(false);
    expect(await fetchCommentList(postId)).toHaveLength(3);
  });

  it("deleteComment removes it and the count goes down", async () => {
    const res = await call("deleteComment", { user_id: me.id, comment_id: commentId });
    expect(res.body.status).toBe(true);
    expect((await fetchFeedPost(postId)).comments_count).toBe(2);
    expect(await fetchCommentList(postId)).toHaveLength(2);
  });
});

// ═══════════════════════════ REACTIONS ═══════════════════════════
describe("action bar: reactions", () => {
  it("likePost with a reaction sets is_like, reaction_type and the per-reaction count", async () => {
    const res = await call("likePost", { user_id: me.id, post_id: postId, reaction_type: "prayers" });
    expect(res.body.status).toBe(true);

    const post = await fetchFeedPost(postId);
    expect(post.is_like).toBe(1);
    expect(post.reaction_type).toBe("prayers");
    expect(post.prayers_count).toBe(1);
    expect(post.total_reactions).toBe(1);
  });

  it("switching reaction updates the type without adding a second like", async () => {
    const res = await call("likePost", { user_id: me.id, post_id: postId, reaction_type: "help" });
    expect(res.body.status).toBe(true);
    expect(res.body.message).toBe("Reaction Updated");

    const post = await fetchFeedPost(postId);
    expect(post.reaction_type).toBe("help");
    expect(post.help_count).toBe(1);
    expect(post.prayers_count).toBe(0);
    expect(post.total_reactions).toBe(1);
    expect(post.likes_count).toBe(1);
  });

  it("the same reaction twice is rejected (no double count)", async () => {
    const res = await call("likePost", { user_id: me.id, post_id: postId, reaction_type: "help" });
    expect(res.body.status).toBe(false);
    expect((await fetchFeedPost(postId)).total_reactions).toBe(1);
  });

  it("an unknown reaction type is rejected", async () => {
    const res = await call("likePost", { user_id: author.id, post_id: postId, reaction_type: "angry" });
    expect(res.body.status).toBe(false);
  });

  it("likePost without reaction_type defaults to support", async () => {
    const res = await call("likePost", { user_id: author.id, post_id: postId });
    expect(res.body.status).toBe(true);
    const post = await fetchFeedPost(postId);
    expect(post.support_count).toBe(1);
    expect(post.total_reactions).toBe(2);
  });

  it("fetchUsersWhoLikedPost lists both reactors", async () => {
    const res = await call("fetchUsersWhoLikedPost", { post_id: postId, user_id: me.id });
    expect(res.body.status).toBe(true);
    const ids = (res.body.data as Array<{ user: { id: string } }>).map((l) => l.user.id).sort();
    expect(ids).toEqual([me.id, author.id].sort());
  });

  it("fetchPostByPostId returns my reaction and the breakdown", async () => {
    const res = await call("fetchPostByPostId", { post_id: postId, my_user_id: me.id });
    expect(res.body.data.is_like).toBe(1);
    expect(res.body.data.reaction_type).toBe("help");
    expect(res.body.data.help_count).toBe(1);
    expect(res.body.data.support_count).toBe(1);
  });

  it("dislikePost removes my reaction", async () => {
    const res = await call("dislikePost", { user_id: me.id, post_id: postId });
    expect(res.body.status).toBe(true);
    const post = await fetchFeedPost(postId);
    expect(post.is_like).toBe(0);
    expect(post.reaction_type).toBeNull();
    expect(post.help_count).toBe(0);
    expect(post.total_reactions).toBe(1);

    const again = await call("dislikePost", { user_id: me.id, post_id: postId });
    expect(again.body.status).toBe(false);
  });
});

// ═══════════════════════ USER ROLE ON THE WIRE ═══════════════════════
describe("user role is exposed on the mobile wire", () => {
  it("legacyUser keeps existing fields and adds role on feed authors and profiles", async () => {
    const { db } = await import("@/lib/db");
    const vol = await createUser("rolevol", { role: "VOLUNTEER", isModerator: 0, userType: "volunteer", volunteerStatus: "approved" });
    const rolePost = await db.communityPost.create({ data: { userId: vol.id, desc: "role check post" } });

    const post = await fetchFeedPost(rolePost.id);
    const author = post.user as Record<string, unknown>;
    expect(author.role).toBe("VOLUNTEER");
    expect(author.user_type).toBe("volunteer");
    expect(author.volunteer_status).toBe("approved");
    expect(author).toHaveProperty("is_moderator");
    expect(author).toHaveProperty("full_name");

    const res = await call("fetchProfile", { my_user_id: me.id, user_id: vol.id });
    expect(res.body.status).toBe(true);
    expect(res.body.data.role).toBe("VOLUNTEER");
    expect(res.body.data.is_moderator).toBe(0);
    expect(res.body.data.followers).toBeDefined();
  });

  it("a moderator user reports role MODERATOR-style flags correctly", async () => {
    const modUser = await createUser("rolemore", { isModerator: 1 });
    const res = await call("fetchProfile", { my_user_id: me.id, user_id: modUser.id });
    expect(res.body.status).toBe(true);
    expect(res.body.data.role).toBe("DONOR"); // schema default
    expect(res.body.data.is_moderator).toBe(1);
  });
});

// ═══════════════════════════ MODERATION KEEPS COUNTS IN SYNC ═══════════════════════════
describe("moderation keeps the comment count in sync", () => {
  it("blocking a commenter globally hides their comments from both count and list", async () => {
    const { db } = await import("@/lib/db");
    const commenter = await createUser("commenter");
    await call("addComment", { user_id: commenter.id, desc: "soon hidden", post_id: postId });
    expect((await fetchFeedPost(postId)).comments_count).toBe(3);

    const res = await call("Moderator/userBlockByModerator", { user_id: moderator.id, to_user_id: commenter.id });
    expect(res.body.status).toBe(true);

    expect((await fetchFeedPost(postId)).comments_count).toBe(2);
    expect(await fetchCommentList(postId)).toHaveLength(2);
    const row = await db.communityPost.findUnique({ where: { id: postId } });
    expect(row!.commentsCount).toBe(2);
  });

  it("non-moderators cannot delete comments as moderator", async () => {
    const [comment] = await fetchCommentList(postId);
    const res = await call("Moderator/deleteCommentByModerator", { user_id: me.id, comment_id: comment.id });
    expect(res.body.status).toBe(false);
  });

  it("moderator comment delete updates count and list", async () => {
    const [comment] = await fetchCommentList(postId);
    const res = await call("Moderator/deleteCommentByModerator", { user_id: moderator.id, comment_id: comment.id });
    expect(res.body.status).toBe(true);
    expect((await fetchFeedPost(postId)).comments_count).toBe(1);
    expect(await fetchCommentList(postId)).toHaveLength(1);
  });
});
