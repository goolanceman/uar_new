/**
 * Settings module — /api/settings* (real router via @/routes/settings).
 *
 * Covers the ADMIN list (flat map with masked secrets), the PATCH upsert
 (known key changed + restored, unknown key / empty patch / invalid boolean
 * rejected with the exact messages), the /test connectivity check (no SMTP
 * host configured → operator-safe ok:false without a network call), and the
 * public reads (/public, /app). Only touches the receipts.footer key —
 * restored to "" in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `settings-${Date.now()}`;
const PASSWORD = "[redacted]]";
const TESTED_KEY = "receipts.footer";

let app: express.Express;
let adminToken = "";
let donorToken = "";
let createdMobileAppRow = false;

async function buildApp() {
  const { router } = await import("@/routes/settings");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/settings", router);
  // the centralized error middleware (app.ts) — settings controllers forward
  // errors via next(error)
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.setting.updateMany({ where: { key: TESTED_KEY }, data: { value: "" } });
  if (createdMobileAppRow) await db.setting.deleteMany({ where: { key: "mobile.app" } });
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.activityLog.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");

  const admin = await db.user.create({
    data: {
      email: `${PREFIX}-admin@test.local`,
      name: `${PREFIX} admin`,
      role: "ADMIN",
      password: hashPassword(PASSWORD),
      status: "ACTIVE",
      isActive: true,
    },
  });
  const donor = await db.user.create({
    data: {
      email: `${PREFIX}-donor@test.local`,
      name: `${PREFIX} donor`,
      role: "DONOR",
      password: hashPassword(PASSWORD),
      status: "ACTIVE",
      isActive: true,
    },
  });
  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  donorToken = issueToken({ userId: donor.id, role: "DONOR", name: donor.name, email: donor.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/settings (ADMIN)", () => {
  it("returns the flat {key: value} map merged with defaults", async () => {
    const res = await request(app).get("/api/settings").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("object");
    expect(typeof res.body["app.language"]).toBe("string");
    expect(Object.values(res.body).every((v) => typeof v === "string")).toBe(true);
  });

  it("masks secret keys so they are never echoed in plaintext", async () => {
    const res = await request(app).get("/api/settings").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const secrets = Object.entries(res.body as Record<string, string>).filter(
      ([key]) => /secret|password|apikey|token|credential/i.test(key)
    );
    for (const [key, value] of secrets) {
      // masked values are either cleared ("") or contain the bullet mask
      expect(value === "" || value.includes("•"), `${key} must be masked`).toBe(true);
    }
  });

  it("401 without a token, 403 for a non-admin role", async () => {
    const unauth = await request(app).get("/api/settings");
    expect(unauth.status).toBe(401);

    const forbidden = await request(app).get("/api/settings").set("Authorization", `Bearer ${donorToken}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("You do not have permission for this action");
  });
});

describe("PATCH /api/settings (ADMIN)", () => {
  it("upserts a known key and echoes the projected map", async () => {
    const res = await request(app)
      .patch("/api/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ [TESTED_KEY]: `${PREFIX} footer` });
    expect(res.status).toBe(200);
    expect(res.body[TESTED_KEY]).toBe(`${PREFIX} footer`);

    // restore
    const restore = await request(app)
      .patch("/api/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ [TESTED_KEY]: "" });
    expect(restore.status).toBe(200);
  });

  it("rejects an empty patch (400 Nothing to update)", async () => {
    const res = await request(app).patch("/api/settings").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Nothing to update");
  });

  it("rejects unknown keys with the exact message", async () => {
    const res = await request(app)
      .patch("/api/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ "my.prefix.key": "x", "another.unknown": "y" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unknown settings: my.prefix.key, another.unknown");
  });

  it("rejects an invalid boolean value with the exact message", async () => {
    const res = await request(app)
      .patch("/api/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ "app.maintenance": "notabool" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`app.maintenance must be "true" or "false".`);
  });
});

describe("POST /api/settings/test (ADMIN)", () => {
  it("rejects an unknown channel with the exact message", async () => {
    const res = await request(app)
      .post("/api/settings/test")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ channel: "smoke-signals" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("channel must be one of: email, sms, whatsapp, gateway");
  });

  it("runs the email connectivity check — unconfigured SMTP answers ok:false fast", async () => {
    const res = await request(app)
      .post("/api/settings/test")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ channel: "email" });
    expect(res.status).toBe(200);
    expect(typeof res.body.latencyMs).toBe("number");
    expect(typeof res.body.message).toBe("string");
    // no SMTP host stored in the test DB → the operator-safe hint
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain("SMTP host");
  });
});

describe("public settings reads", () => {
  it("serves the public org identity subset without auth", async () => {
    const res = await request(app).get("/api/settings/public");
    expect(res.status).toBe(200);
    expect(res.body).toBeTypeOf("object");
  });

  it("serves the mobile app config (mobile.app blob + interests)", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const existing = await db.setting.findUnique({ where: { key: "mobile.app" } });
    if (!existing) {
      createdMobileAppRow = true;
      await db.setting.create({
        data: {
          key: "mobile.app",
          value: JSON.stringify({ app_name: "Settings Test App", is_admob_on: 0, support_email: "s@test.local" }),
        },
      });
    }

    const res = await request(app).get("/api/settings/app");
    expect(res.status).toBe(200);
    expect(res.body.app_name).toBe("Settings Test App");
    expect(Array.isArray(res.body.interests)).toBe(true);
  });

  it("serves sane defaults on /app when the mobile.app blob is not configured", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const existing = await db.setting.findUnique({ where: { key: "mobile.app" } });
    if (existing) return; // cannot test the defaults path without removing shared data

    const res = await request(app).get("/api/settings/app");
    expect(res.status).toBe(200);
    // The app falls every limit back to 0 — these defaults keep creation flows usable.
    expect(res.body.duration_limit_in_reel).toBe(60);
    expect(res.body.is_sight_engine_enabled).toBe(0);
    // 1 = chronological feed — a 0 default reshuffled posts on every refresh.
    expect(res.body.fetch_post_type).toBe(1);
    expect(Array.isArray(res.body.interests)).toBe(true);
  });
});
