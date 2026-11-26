/**
 * S1 — generic REST endpoints shared by web + mobile (community migration).
 *
 * Ports of the legacy mobile-only handlers onto the generic contract:
 *   auth       → POST /api/auth/{register,social,send-verification-otp,verify-email},
 *                GET /api/auth/username-available, DELETE /api/auth/account
 *   profile    → PATCH /api/profile (JSON + multipart), POST
 *                /api/profile/{verification,user-type,device-token},
 *                DELETE /api/profile/device-token
 *   users      → /api/community/users/* (profile, search, random, follow,
 *                followers/following, block, report)
 *   notifs     → GET /api/notifications?feed=all, /platform, POST /push
 *   config     → GET /api/settings/app (no secrets), GET /api/faqs
 *
 * Runs against the TEST database and only touches rows it creates (users with
 * a unique email prefix + their direct children).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `s1-${Date.now()}`;
const PASSWORD = "Test-Passw0rd!";

let app: express.Express;
let adminToken = "";
let aToken = "";
let bToken = "";
let adminId = "";
let aId = "";
let bId = "";
let cId = "";
let createdOwnSetting = false;
let createdInterests = false;
let interestId = 0;
let faqTypeId = 0;

async function buildApp() {
  const [{ router: authRouter }, { router: profileRouter }, { router: communityUsersRouter }, { router: notificationsRouter }, { router: settingsRouter }, { router: faqsRouter }] =
    await Promise.all([
      import("@/routes/auth"),
      import("@/routes/profile"),
      import("@/routes/community-users"),
      import("@/routes/notifications"),
      import("@/routes/settings"),
      import("@/routes/faqs"),
    ]);
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/profile", profileRouter);
  a.use("/api/community/users", communityUsersRouter);
  a.use("/api/notifications", notificationsRouter);
  a.use("/api/settings", settingsRouter);
  a.use("/api/faqs", faqsRouter);
  return a;
}

async function cleanup() {
  const { db } = await import("@/lib/db");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.userFollow.deleteMany({ where: { OR: [{ myUserId: { in: ids } }, { userId: { in: ids } }] } });
    await db.savedNotification.deleteMany({ where: { OR: [{ myUserId: { in: ids } }, { userId: { in: ids } }] } });
    await db.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { title: { startsWith: PREFIX } }] } });
    await db.communityReport.deleteMany({ where: { userId: { in: ids } } });
    await db.profileVerification.deleteMany({ where: { userId: { in: ids } } });
    await db.conversation.deleteMany({ where: { OR: [{ user1Id: { in: ids } }, { user2Id: { in: ids } }] } });
    await db.activityLog.deleteMany({ where: { userId: { in: ids } } });
    await db.volunteerApplication.deleteMany({ where: { OR: [{ userId: { in: ids } }, { email: { startsWith: PREFIX } }] } });
    await db.fileAsset.deleteMany({ where: { uploadedByName: { startsWith: PREFIX } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  await db.passwordReset.deleteMany({ where: { email: { startsWith: PREFIX } } });
  if (createdOwnSetting) await db.setting.deleteMany({ where: { key: "mobile.app" } });
  if (createdInterests) await db.communityInterest.deleteMany({ where: { id: interestId } });
  if (faqTypeId) {
    await db.faq.deleteMany({ where: { faqsTypeId: faqTypeId } });
    await db.faqType.deleteMany({ where: { id: faqTypeId } });
  }
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/lib/db");
  const { hashPassword } = await import("@/lib/session");

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
  const b = await mk(`${PREFIX}-b@test.local`, `${PREFIX} bob`, "DONOR", { username: `${PREFIX}-bob`, avatar: "http://x/y.png", about: "bio" });
  const c = await mk(`${PREFIX}-c@test.local`, `${PREFIX} carol`, "DONOR");
  adminId = admin.id;
  aId = a.id;
  bId = b.id;
  cId = c.id;

  const { issueToken } = await import("@/lib/session");
  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  aToken = issueToken({ userId: a.id, role: "DONOR", name: a.name, email: a.email });
  bToken = issueToken({ userId: b.id, role: "DONOR", name: b.name, email: b.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});

describe("S1 auth extensions", () => {
  it("registers without phone (mobile signup) and returns user + token", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: `${PREFIX} dave`, email: `${PREFIX}-dave@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user?.id).toBeTruthy();
    expect(typeof res.body.token).toBe("string");
  });

  it("registers with a user-chosen password — no tempCreds, same password logs in", async () => {
    const email = `${PREFIX}-pw@test.local`;
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ name: `${PREFIX} pw`, email, password: "Str0ng-Pass-1" });
    expect(reg.status).toBe(200);
    expect(reg.body.user?.email).toBe(email);
    expect(reg.body.token).toBeTruthy();
    expect(reg.body.tempCreds).toBeUndefined(); // chosen passwords are never echoed

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "Str0ng-Pass-1" });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
  });

  it("keeps the web path — registering without a password returns tempCreds", async () => {
    const email = `${PREFIX}-temp@test.local`;
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ name: `${PREFIX} temp`, email });
    expect(reg.status).toBe(200);
    expect(reg.body.tempCreds?.email).toBe(email);
    expect(typeof reg.body.tempCreds?.password).toBe("string");
  });

  it("rejects a weak chosen password with the policy message", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: `${PREFIX} weak`, email: `${PREFIX}-weak@test.local`, password: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Password must be at least 6 characters");
  });

  it("signs in / registers by identity via POST /api/auth/social", async () => {
    const created = await request(app)
      .post("/api/auth/social")
      .send({ identity: `${PREFIX}-social@test.local`, loginType: 0, fullName: `${PREFIX} social`, deviceToken: "dev-s1", deviceType: 2 });
    expect(created.status).toBe(200);
    expect(created.body.created).toBe(true);
    expect(created.body.token).toBeTruthy();
    expect(created.body.user.username).toContain("s1");

    const again = await request(app)
      .post("/api/auth/social")
      .send({ identity: `${PREFIX}-social@test.local`, loginType: 0 });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.user.id).toBe(created.body.user.id);
    expect(again.body.token).toBeTruthy();
  });

  it("reports username availability", async () => {
    const free = await request(app).get("/api/auth/username-available").query({ username: `${PREFIX}-free` });
    expect(free.status).toBe(200);
    expect(free.body.available).toBe(true);
    const taken = await request(app).get("/api/auth/username-available").query({ username: `${PREFIX}-bob` });
    expect(taken.body.available).toBe(false);
  });

  it("stores the device token on login (optional field)", async () => {
    const { db } = await import("@/lib/db");
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-a@test.local`, password: PASSWORD, deviceToken: "tok-s1-login", deviceType: 2 });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    const user = await db.user.findUnique({ where: { id: aId } });
    expect(user?.deviceToken).toBe("tok-s1-login");
  });

  it("sends a verification OTP and verifies the email with it", async () => {
    const missing = await request(app).post("/api/auth/send-verification-otp").send({ email: `nope-${PREFIX}@test.local` });
    expect(missing.status).toBe(404);

    const sent = await request(app).post("/api/auth/send-verification-otp").send({ email: `${PREFIX}-a@test.local` });
    expect(sent.status).toBe(200);
    expect(sent.body.otp).toBeUndefined(); // the OTP never leaks in the response

    // The OTP is only stored hashed — plant a known pending code to verify with.
    const { db } = await import("@/lib/db");
    const { hashPassword } = await import("@/lib/session");
    await db.passwordReset.create({
      data: { email: `${PREFIX}-a@test.local`, otpHash: hashPassword("123456"), expiresAt: new Date(Date.now() + 600_000) },
    });
    const bad = await request(app).post("/api/auth/verify-email").send({ email: `${PREFIX}-a@test.local`, otp: "000000" });
    expect(bad.status).toBe(400);
    const ok = await request(app).post("/api/auth/verify-email").send({ email: `${PREFIX}-a@test.local`, otp: "123456" });
    expect(ok.status).toBe(200);
    expect(ok.body.user?.emailVerifiedAt).toBeTruthy();
  });
});

describe("S1 profile extensions", () => {
  it("PATCHes community fields (username, about, interestIds, toggles)", async () => {
    const res = await request(app)
      .patch("/api/profile")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ username: `${PREFIX}-alice`, about: "hello", interestIds: ["1", "2"], pushNotifications: false, roomInvites: true });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(`${PREFIX}-alice`);
    expect(res.body.user.about).toBe("hello");
    expect(res.body.user.interestIds).toEqual(["1", "2"]);
    expect(res.body.user.pushNotifications).toBe(false);
    expect(res.body.user.roomInvites).toBe(true);
    expect(res.body.user.email).toBe(`${PREFIX}-a@test.local`); // self fields present
  });

  it("rejects a taken username", async () => {
    const res = await request(app)
      .patch("/api/profile")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ username: `${PREFIX}-bob` });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Username is not available");
  });

  it("accepts a multipart avatar upload", async () => {
    const res = await request(app)
      .patch("/api/profile")
      .set("Authorization", `Bearer ${aToken}`)
      .attach("avatar", Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000", "hex"), { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.user.avatar).toContain("/api/files/");
  });

  it("submits KYC verification (multipart selfie + document)", async () => {
    const png = { filename: "s.png", contentType: "image/png" };
    const ok = await request(app)
      .post("/api/profile/verification")
      .set("Authorization", `Bearer ${aToken}`)
      .field("fullName", `${PREFIX} alice`)
      .field("documentType", "Passport")
      .attach("selfie", Buffer.from("89504e47", "hex"), png)
      .attach("document", Buffer.from("89504e47", "hex"), png);
    expect(ok.status).toBe(200);
    expect(ok.body.verification?.id).toBeTruthy();

    const again = await request(app)
      .post("/api/profile/verification")
      .set("Authorization", `Bearer ${aToken}`)
      .field("fullName", `${PREFIX} alice`)
      .field("documentType", "Passport")
      .attach("selfie", Buffer.from("89504e47", "hex"), png)
      .attach("document", Buffer.from("89504e47", "hex"), png);
    expect(again.status).toBe(400); // pending review now
  });

  it("selects a one-time user type", async () => {
    const res = await request(app).post("/api/profile/user-type").set("Authorization", `Bearer ${aToken}`).send({ userType: "supporter" });
    expect(res.status).toBe(200);
    expect(res.body.user.userType).toBe("supporter");
    const again = await request(app).post("/api/profile/user-type").set("Authorization", `Bearer ${aToken}`).send({ userType: "volunteer" });
    expect(again.status).toBe(400);
  });

  it("registers and clears the device push token", async () => {
    const reg = await request(app)
      .post("/api/profile/device-token")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ token: "fcm-s1-token", platform: "android" });
    expect(reg.status).toBe(200);
    const { db } = await import("@/lib/db");
    const withToken = await db.user.findUnique({ where: { id: aId } });
    expect(withToken?.fcmToken).toBe("fcm-s1-token");
    expect(withToken?.deviceType).toBe(2);

    const del = await request(app).delete("/api/profile/device-token").set("Authorization", `Bearer ${aToken}`);
    expect(del.status).toBe(200);
    const cleared = await db.user.findUnique({ where: { id: aId } });
    expect(cleared?.fcmToken).toBeNull();
  });
});

describe("S1 community users", () => {
  it("follows, lists followers/following, and reports the follow status on profiles", async () => {
    const follow = await request(app).post(`/api/community/users/${bId}/follow`).set("Authorization", `Bearer ${aToken}`);
    expect(follow.status).toBe(200);
    expect(follow.body.following).toBe(true);

    const dup = await request(app).post(`/api/community/users/${bId}/follow`).set("Authorization", `Bearer ${aToken}`);
    expect(dup.status).toBe(409);

    const followers = await request(app).get(`/api/community/users/${bId}/followers`).set("Authorization", `Bearer ${bToken}`);
    expect(followers.status).toBe(200);
    expect(followers.body.items.map((u: { id: string }) => u.id)).toContain(aId);

    const following = await request(app).get(`/api/community/users/${aId}/following`).set("Authorization", `Bearer ${aToken}`);
    expect(following.body.items.map((u: { id: string }) => u.id)).toContain(bId);

    const profile = await request(app).get(`/api/community/users/${bId}`).set("Authorization", `Bearer ${aToken}`);
    expect(profile.status).toBe(200);
    expect(profile.body.followingStatus).toBe(2); // I follow him
    expect(profile.body.storyIds).toEqual([]); // stories are another slice
    expect(profile.body.interest).toEqual([]);

    const back = await request(app).post(`/api/community/users/${aId}/follow`).set("Authorization", `Bearer ${bToken}`);
    expect(back.status).toBe(200);
    const mutual = await request(app).get(`/api/community/users/${aId}`).set("Authorization", `Bearer ${bToken}`);
    expect(mutual.body.followingStatus).toBe(3); // mutual

    const unfollow = await request(app).delete(`/api/community/users/${bId}/follow`).set("Authorization", `Bearer ${aToken}`);
    expect(unfollow.status).toBe(200);
    expect(unfollow.body.following).toBe(false);
  });

  it("blocks, lists blocked users, refuses following blocked users, and unblocks", async () => {
    const block = await request(app).post(`/api/community/users/${bId}/block`).set("Authorization", `Bearer ${aToken}`);
    expect(block.status).toBe(200);
    expect(block.body.blockedUserIds).toContain(bId);

    const list = await request(app).get("/api/community/users/me/blocked").set("Authorization", `Bearer ${aToken}`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((u: { id: string }) => u.id)).toContain(bId);

    const followBlocked = await request(app).post(`/api/community/users/${bId}/follow`).set("Authorization", `Bearer ${aToken}`);
    expect(followBlocked.status).toBe(400);

    const unblock = await request(app).delete(`/api/community/users/${bId}/block`).set("Authorization", `Bearer ${aToken}`);
    expect(unblock.status).toBe(200);
    expect(unblock.body.blockedUserIds).not.toContain(bId);
  });

  it("searches profiles and chat contacts", async () => {
    const search = await request(app)
      .get("/api/community/users/search")
      .query({ q: `${PREFIX}-bob` })
      .set("Authorization", `Bearer ${aToken}`);
    expect(search.status).toBe(200);
    expect(search.body.items.map((u: { id: string }) => u.id)).toContain(bId);

    const chat = await request(app)
      .get("/api/community/users/search-chat")
      .query({ q: `${PREFIX}-bob` })
      .set("Authorization", `Bearer ${aToken}`);
    expect(chat.status).toBe(200);
    expect(chat.body.items.map((u: { id: string }) => u.id)).toContain(bId);
  });

  it("reports a user", async () => {
    const res = await request(app)
      .post(`/api/community/users/${bId}/report`)
      .set("Authorization", `Bearer ${aToken}`)
      .send({ reason: "Spam", desc: "test report" });
    expect(res.status).toBe(200);
    expect(res.body.report.type).toBe(2);

    const missing = await request(app).post(`/api/community/users/${bId}/report`).set("Authorization", `Bearer ${aToken}`).send({ reason: "Spam" });
    expect(missing.status).toBe(400);
  });

  it("returns a random profile sharing my interests", async () => {
    const { db } = await import("@/lib/db");
    await db.user.update({ where: { id: aId }, data: { interestIds: "" } });
    const none = await request(app).get("/api/community/users/random").set("Authorization", `Bearer ${aToken}`);
    expect(none.status).toBe(400); // no interests yet

    const interest = await db.communityInterest.create({ data: { title: `${PREFIX} interest` } });
    interestId = interest.id;
    createdInterests = true;
    await db.user.update({ where: { id: aId }, data: { interestIds: String(interest.id) } });
    await db.user.update({ where: { id: cId }, data: { interestIds: String(interest.id), about: "shared" } });

    const res = await request(app).get("/api/community/users/random").set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(200);
    expect(res.body?.id).toBe(cId);
  });
});

describe("S1 notifications", () => {
  it("serves the platform announcements feed", async () => {
    const { db } = await import("@/lib/db");
    await db.notification.create({ data: { userId: null, title: `${PREFIX} announce`, message: "hello all" } });
    const res = await request(app).get("/api/notifications/platform").query({ page: 1, limit: 5 });
    expect(res.status).toBe(200);
    const row = res.body.items.find((n: { title?: string }) => n.title === `${PREFIX} announce`);
    expect(row?.description).toBe("hello all");
    expect(row?.actionUrl).toBeNull(); // camelCase key, null when unset
  });

  it("exposes the community feed (saved notifications + marks read)", async () => {
    const { db } = await import("@/lib/db");
    // a follow-style saved notification lands in b's feed
    await db.savedNotification.create({ data: { myUserId: bId, userId: aId, type: 1 } });
    const res = await request(app).get("/api/notifications").query({ feed: "all", page: 1, limit: 10 }).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);

    const feedB = await request(app).get("/api/notifications").query({ feed: "all" }).set("Authorization", `Bearer ${bToken}`);
    const saved = feedB.body.items.find((n: { type: number }) => n.type === 1);
    expect(saved?.user?.id).toBeTruthy(); // actor embedded as author
    expect(saved?.createdAt).toBeTruthy();

    const mark = await request(app).patch("/api/notifications").set("Authorization", `Bearer ${bToken}`).send({ all: true });
    expect(mark.status).toBe(200);
  });

  it("lets admins push to anyone and users only chat-push their conversations", async () => {
    const adminPush = await request(app)
      .post("/api/notifications/push")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: aId, title: `${PREFIX} admin`, body: "hello" });
    expect(adminPush.status).toBe(200);
    expect(adminPush.body.notificationId).toBeTruthy();

    const forbidden = await request(app)
      .post("/api/notifications/push")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ userId: bId, title: "hi", body: "hi" });
    expect(forbidden.status).toBe(403);

    const { db } = await import("@/lib/db");
    const convo = await db.conversation.create({ data: { user1Id: aId, user2Id: bId } });
    await db.user.update({ where: { id: bId }, data: { fcmToken: "fcm-b-s1" } });

    const chat = await request(app)
      .post("/api/notifications/push")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ userId: bId, title: `${PREFIX} alice`, body: "msg", data: { type: "chat_message", conversationId: convo.id } });
    expect(chat.status).toBe(200); // chat push to the other participant

    const outsider = await request(app)
      .post("/api/notifications/push")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ userId: cId, title: "hi", body: "hi", data: { type: "chat_message", conversationId: convo.id } });
    expect(outsider.status).toBe(403); // carol is not a participant
  });

  it("deletes the signed-in account with the full cascade", async () => {
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ name: `${PREFIX} doom`, email: `${PREFIX}-doom@test.local`, password: PASSWORD });
    expect(reg.status).toBe(200);

    const res = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${reg.body.token}`)
      .send({});
    expect(res.status).toBe(200);
    const { db } = await import("@/lib/db");
    expect(await db.user.findUnique({ where: { id: reg.body.user.id } })).toBeNull();
  });

  it("deletes the user's volunteer application with the account (no dangling PENDING rows)", async () => {
    const { db } = await import("@/lib/db");
    const email = `${PREFIX}-volapp@test.local`;
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ name: `${PREFIX} volapp`, email, password: "Test-Pass-123" });
    expect(reg.status).toBe(200);
    const userId = reg.body.user.id as string;
    const application = await db.volunteerApplication.create({
      data: {
        userId,
        fullName: `${PREFIX} volapp`,
        email,
        phone: "0123456789",
        city: "Testville",
        motivation: "help the camps",
        status: "PENDING",
      },
    });

    const res = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${reg.body.token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(await db.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await db.volunteerApplication.findUnique({ where: { id: application.id } })).toBeNull();
  });
});

describe("S1 app config", () => {
  it("serves the mobile app settings without secrets", async () => {
    const { db } = await import("@/lib/db");
    const existing = await db.setting.findUnique({ where: { key: "mobile.app" } });
    if (!existing) {
      createdOwnSetting = true;
      await db.setting.create({
        data: {
          key: "mobile.app",
          value: JSON.stringify({ app_name: "S1 App", is_admob_on: 0, sight_engine_api_secret: "super-secret-value", support_email: "s1@x.y" }),
        },
      });
    }

    const res = await request(app).get("/api/settings/app");
    expect(res.status).toBe(200);
    expect(res.body.app_name).toContain("S1");
    expect(JSON.stringify(res.body)).not.toContain("super-secret-value");
    expect(res.body.sight_engine_api_secret).toBeUndefined();
    expect(Array.isArray(res.body.interests)).toBe(true);
    expect(Array.isArray(res.body.reportReasons)).toBe(true);
    expect(Array.isArray(res.body.restrictedUsernames)).toBe(true);
  });

  it("serves the FAQ categories with nested faqs", async () => {
    const { db } = await import("@/lib/db");
    const type = await db.faqType.create({ data: { title: `${PREFIX} faq` } });
    faqTypeId = type.id;
    await db.faq.create({ data: { faqsTypeId: type.id, question: `${PREFIX} q?`, answer: `${PREFIX} a` } });

    const res = await request(app).get("/api/faqs");
    expect(res.status).toBe(200);
    const mine = res.body.items.find((t: { id: number }) => t.id === type.id);
    expect(mine?.faqs?.[0]?.question).toBe(`${PREFIX} q?`);
  });
});
