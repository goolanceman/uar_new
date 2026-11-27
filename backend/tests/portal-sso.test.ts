/**
 * Portal SSO — one login token works across the app and the portal endpoints.
 *
 * The Flutter role screens (lib/screens/my_hub + role folders) reuse the app's session JWT (no second
 * login) and calls the WEB routers with `Authorization: Bearer` and NO apikey
 * header. This pins the contract:
 *   1. POST /api/auth/login → { token } (web envelope, the same login the web uses).
 *   2. That token authenticates the portal endpoints without apikey:
 *      GET /api/auth/me → {user:{…}} (web shape), GET /api/donations?mine=1,
 *      POST /api/auth/refresh → {token}.
 *   3. Login failures answer with the web envelope { error } — no legacy {status} body.
 *
 * Runs against the TEST database (vitest.config.ts) and only touches rows it
 * creates (users with a unique email prefix + their activity logs).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `sso-${Date.now()}`;
const PASSWORD = "sso-test-password";

let app: express.Express;
let token = "";
let userId = "";

async function buildApp() {
  // The web routers the portal (and the app) consume, mounted like src/index.ts.
  const [{ router: authRouter }, { router: donationsRouter }, { router: settingsRouter }] =
    await Promise.all([import("@/routes/auth"), import("@/routes/donations"), import("@/routes/settings")]);
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/donations", donationsRouter);
  a.use("/api/settings", settingsRouter);
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  await db.activityLog.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword } = await import("@/infrastructure/auth/session");
  const user = await db.user.create({
    data: {
      email: `${PREFIX}-donor@test.local`,
      name: "portal sso donor",
      password: hashPassword(PASSWORD),
      role: "DONOR",
      status: "ACTIVE",
      isActive: true,
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("portal SSO: one login for the app and the portal", () => {
  it("POST /api/auth/login issues the shared session JWT (web envelope)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `${PREFIX}-donor@test.local`, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    token = res.body.token;
  });

  it("the app token authenticates the portal /api/auth/me (web envelope, no apikey)", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toBeTruthy();
    expect(res.body.user.id).toBe(userId);
    expect(res.body.user.role).toBe("DONOR");
    expect(res.body.status).toBeUndefined(); // web envelope, not the mobile one
  });

  it("the app token works on the role endpoint the portal home calls", async () => {
    const res = await request(app)
      .get("/api/donations?mine=1&limit=50")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("portal refresh reissues the token and the session stays valid", async () => {
    const res = await request(app).post("/api/auth/refresh").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user?.id).toBe(userId);
  });

  it("login failures keep the web envelope { error } (no legacy {status} body)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `nobody-${PREFIX}@nowhere.test`, password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
    expect(res.body.status).toBeUndefined();
  });
});
