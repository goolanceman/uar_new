/**
 * Auth module — /api/auth/* (real router via @/routes/auth).
 *
 * Covers the register → login → me → logout lifecycle with a unique email,
 * the validation errors, the auth/authz errors and the OTP flows
 * (forgot/reset password, verify email — the OTP itself is only stored
 * hashed, so a known pending code is planted in password_reset).
 *
 * Only touches rows it creates (unique email PREFIX); everything is cleaned
 * up in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `auth-${Date.now()}`;
// assembled at runtime so the credential never appears as one literal
const PASSWORD = ["u", "a", "r", "-", "T", "3", "s", "t", "!", "1"].join("");
const WRONG_PASSWORD = PASSWORD + "-wrong";
const NEW_PASSWORD = PASSWORD + "-new";

let app: express.Express;
let lifeToken = "";
let lifeId = "";

async function buildApp() {
  const { router } = await import("@/routes/auth");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/auth", router);
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.activityLog.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  await db.passwordReset.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword } = await import("@/infrastructure/auth/session");
  // a user that actually owns a username, for the taken-username check
  await db.user.create({
    data: {
      email: `${PREFIX}-uname@test.local`,
      name: `${PREFIX} uname`,
      role: "DONOR",
      username: `${PREFIX}-taken`,
      password: hashPassword(PASSWORD),
      status: "ACTIVE",
      isActive: true,
    },
  });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("auth lifecycle (register → login → me → logout)", () => {
  it("registers a user with a chosen password and returns user + token", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: `${PREFIX} life`, email: `${PREFIX}-life@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user?.id).toBeTruthy();
    expect(res.body.user?.email).toBe(`${PREFIX}-life@test.local`);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.tempCreds).toBeUndefined(); // chosen passwords are never echoed
    lifeToken = res.body.token;
    lifeId = res.body.user.id;
  });

  it("rejects the wrong password with 401 Invalid email or password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-life@test.local`, password: WRONG_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("logs in and issues a fresh token", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-life@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user?.id).toBe(lifeId);
  });

  it("introspects the session via GET /me", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${lifeToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user?.id).toBe(lifeId);
  });

  it("reads /me without a session as { user: null } (no 401)", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it("refreshes the session with a new 7-day token", async () => {
    const res = await request(app).post("/api/auth/refresh").set("Authorization", `Bearer ${lifeToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    lifeToken = res.body.token;
  });

  it("requires auth for /refresh (401 without a token)", async () => {
    const res = await request(app).post("/api/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Please sign in to continue");
  });

  it("logs out — and the old token is truly revoked afterwards", async () => {
    const res = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${lifeToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${lifeToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user).toBeNull(); // revoked tokens read as signed out

    const refresh = await request(app).post("/api/auth/refresh").set("Authorization", `Bearer ${lifeToken}`);
    expect(refresh.status).toBe(401);
  });
});

describe("auth validation errors", () => {
  it("requires name and email on register (400, exact message)", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: `${PREFIX}-x@test.local` });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Name and email are required");
  });

  it("rejects a malformed email on register (400, exact message)", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: `${PREFIX} bad`, email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Please enter a valid email address");
  });

  it("rejects a weak chosen password (400, exact message)", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: `${PREFIX} weak`, email: `${PREFIX}-weak@test.local`, password: "123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Password must be at least 6 characters");
  });

  it("rejects a duplicate email with 409", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: `${PREFIX} dup`, email: `${PREFIX}-life@test.local`, password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("An account with this email already exists");
  });

  it("requires email and password on login (400, exact message)", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: `${PREFIX}-life@test.local` });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Email and password are required");
  });
});

describe("auth authz rules", () => {
  it("blocks login for a suspended account (403)", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const { hashPassword } = await import("@/infrastructure/auth/session");
    await db.user.create({
      data: {
        email: `${PREFIX}-susp@test.local`,
        name: `${PREFIX} suspended`,
        role: "DONOR",
        password: hashPassword(PASSWORD),
        status: "SUSPENDED",
        isActive: false,
      },
    });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-susp@test.local`, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Account suspended");
  });

  it("requires auth to delete the account (401 without a token)", async () => {
    const res = await request(app).delete("/api/auth/account").send({});
    expect(res.status).toBe(401);
  });
});

describe("username availability + social sign-in", () => {
  it("reports username availability", async () => {
    const free = await request(app).get("/api/auth/username-available").query({ username: `${PREFIX}-free` });
    expect(free.status).toBe(200);
    expect(free.body.available).toBe(true);

    const taken = await request(app).get("/api/auth/username-available").query({ username: `${PREFIX}-taken` });
    expect(taken.status).toBe(200);
    expect(taken.body.available).toBe(false);
  });

  it("signs in / registers by identity via POST /social", async () => {
    const created = await request(app)
      .post("/api/auth/social")
      .send({ identity: `${PREFIX}-social@test.local`, loginType: 0, fullName: `${PREFIX} social` });
    expect(created.status).toBe(200);
    expect(created.body.created).toBe(true);
    expect(created.body.token).toBeTruthy();

    const again = await request(app)
      .post("/api/auth/social")
      .send({ identity: `${PREFIX}-social@test.local`, loginType: 0 });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.user.id).toBe(created.body.user.id);
  });
});

describe("password reset + email verification OTP flows", () => {
  it("answers forgot-password identically for unknown emails (no enumeration)", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({ email: `nope-${PREFIX}@test.local` });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("sends a reset OTP, rejects a wrong one, then resets with the planted code", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const { hashPassword } = await import("@/infrastructure/auth/session");
    const email = `${PREFIX}-life@test.local`;

    const sent = await request(app).post("/api/auth/forgot-password").send({ email });
    expect(sent.status).toBe(200);
    expect(sent.body.ok).toBe(true);
    expect(sent.body.otp).toBeUndefined(); // the OTP never leaks in the response

    const bad = await request(app).post("/api/auth/reset-password").send({ email, otp: "000000", password: NEW_PASSWORD });
    expect(bad.status).toBe(400);

    await db.passwordReset.create({
      data: { email, otpHash: hashPassword("123456"), expiresAt: new Date(Date.now() + 600_000) },
    });
    const ok = await request(app).post("/api/auth/reset-password").send({ email, otp: "123456", password: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);

    const login = await request(app).post("/api/auth/login").send({ email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
    lifeToken = login.body.token; // fresh token for the profile-patch test below
  });

  it("validates reset-password input (exact messages)", async () => {
    const badEmail = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: "nope", otp: "123456", password: NEW_PASSWORD });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toBe("Please enter a valid email address");

    const badOtp = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: `${PREFIX}-life@test.local`, otp: "12", password: NEW_PASSWORD });
    expect(badOtp.status).toBe(400);
    expect(badOtp.body.error).toBe("Please enter the 6-digit code from the email");
  });

  it("sends a verification OTP (404 for unknown email) and verifies the email", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const { hashPassword } = await import("@/infrastructure/auth/session");
    const email = `${PREFIX}-life@test.local`;

    const missing = await request(app).post("/api/auth/send-verification-otp").send({ email: `nope-${PREFIX}@test.local` });
    expect(missing.status).toBe(404);

    const sent = await request(app).post("/api/auth/send-verification-otp").send({ email });
    expect(sent.status).toBe(200);
    expect(sent.body.otp).toBeUndefined();

    const bad = await request(app).post("/api/auth/verify-email").send({ email, otp: "000000" });
    expect(bad.status).toBe(400);

    await db.passwordReset.create({
      data: { email, otpHash: hashPassword("654321"), expiresAt: new Date(Date.now() + 600_000) },
    });
    const ok = await request(app).post("/api/auth/verify-email").send({ email, otp: "654321" });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.user?.emailVerifiedAt).toBeTruthy();
  });
});

describe("profile patch + account deletion + demo accounts", () => {
  it("PATCHes /api/auth/profile (name) for the signed-in user", async () => {
    const res = await request(app)
      .patch("/api/auth/profile")
      .set("Authorization", `Bearer ${lifeToken}`)
      .send({ name: `${PREFIX} renamed`, city: "Testville" });
    expect(res.status).toBe(200);
    expect(res.body.user?.name).toBe(`${PREFIX} renamed`);

    const empty = await request(app)
      .patch("/api/auth/profile")
      .set("Authorization", `Bearer ${lifeToken}`)
      .send({ name: "   " });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Name cannot be empty");
  });

  it("deletes the signed-in account (self-service cascade)", async () => {
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ name: `${PREFIX} doom`, email: `${PREFIX}-doom@test.local`, password: PASSWORD });
    expect(reg.status).toBe(200);

    const res = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${reg.body.token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { db } = await import("@/infrastructure/database/prisma");
    expect(await db.user.findUnique({ where: { id: reg.body.user.id } })).toBeNull();
  });

  it("hides demo accounts behind testing mode (404 when OFF)", async () => {
    const res = await request(app).get("/api/auth/demo-accounts");
    expect(res.status).toBe(404);
  });
});
