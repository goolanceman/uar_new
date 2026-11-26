/**
 * Testing mode + demo accounts — Phase 3 contract.
 *
 * GET /api/auth/demo-answers (no auth):
 *   - testing mode OFF (default) → 404 { error: "Not found" } — no feature
 *     disclosure, no credentials anywhere.
 *   - testing mode ON (Setting "app.testingMode" = "true", settable by ADMIN
 *     through the ordinary PATCH /api/settings) →
 *     { testingMode: true, accounts: [{role,label,email,password,description,portal}] }
 *     containing ONLY accounts that exist and are usable in the DB.
 * GET /api/settings/public always carries `testingMode: boolean`.
 *
 * Runs against the TEST database (vitest.config.ts). The demo users may not
 * exist there — they are upserted from src/lib/demo-accounts.ts (the same
 * list prisma/seed.ts consumes) and ONLY rows this file created are deleted
 * afterwards, so it is safe to run alongside the other suites.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";

let app: express.Express;
let db: PrismaClient;
let hashPassword: (pw: string) => string;
/** Rows this test created (and therefore owns). */
const createdIds: string[] = [];
/** Original app.testingMode row value (undefined = row absent). */
let originalValue: string | undefined;

async function buildApp() {
  const [{ router: authRouter }, { router: settingsRouter }] = await Promise.all([
    import("@/routes/auth"),
    import("@/routes/settings"),
  ]);
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/auth", authRouter);
  a.use("/api/settings", settingsRouter);
  return a;
}

async function cleanup() {
  if (!createdIds.length) return;
  await db.activityLog.deleteMany({ where: { userId: { in: createdIds } } });
  await db.user.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
}

beforeAll(async () => {
  db = (await import("@/lib/db")).db;
  hashPassword = (await import("@/lib/session")).hashPassword;
  const { DEMO_ACCOUNTS } = await import("@/lib/demo-accounts");

  await cleanup();
  app = await buildApp();

  // Remember the testing-mode row so the shared test DB gets its original
  // state back no matter how these tests end.
  const originalRow = await db.setting.findUnique({
    where: { key: "app.testingMode" },
    select: { value: true },
  });
  originalValue = originalRow?.["value"];

  // Mirror prisma/seed.ts: every demo account exists, active (the applicant
  // stays PENDING + inactive like the seed makes it), with the demo password.
  for (const d of DEMO_ACCOUNTS) {
    const pending = d.key === "applicant";
    const data = {
      name: d.name,
      email: d.email,
      ["password"]: hashPassword(d.password),
      role: d.role,
      city: d.city ?? "Bengaluru",
      ...(d.phone ? { phone: d.phone } : {}),
      status: pending ? "PENDING" : "ACTIVE",
      isActive: !pending,
    };
    const existing = await db.user.findFirst({ where: { email: d.email }, select: { id: true } });
    if (existing) {
      await db.user.update({ where: { id: existing.id }, data });
    } else {
      const created = await db.user.create({ data });
      createdIds.push(created.id);
    }
  }
});

afterAll(async () => {
  await cleanup();
  if (originalValue !== undefined) {
    await db.setting.update({
      where: { key: "app.testingMode" },
      data: { ["value"]: originalValue },
    });
  } else {
    await db.setting.deleteMany({ where: { key: "app.testingMode" } });
  }
  await db.$disconnect();
});

/** OFF helper — force the flag low for the "hidden" assertions. */
async function setTestingMode(value: string) {
  await db.setting.upsert({
    where: { key: "app.testingMode" },
    create: { key: "app.testingMode", ["value"]: value },
    update: { ["value"]: value },
  });
}

describe("testing mode + demo accounts", () => {
  it("testing mode OFF → GET /api/auth/demo-answers answers 404 {error}", async () => {
    await setTestingMode("false");
    const res = await request(app).get("/api/auth/demo-accounts");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });

  it("testing mode OFF → GET /api/settings/public reports testingMode=false", async () => {
    const res = await request(app).get("/api/settings/public");
    expect(res.status).toBe(200);
    expect(res.body.testingMode).toBe(false);
  });

  it("admin flips testing mode through the ordinary PATCH /api/settings", async () => {
    const { DEMO_ACCOUNTS } = await import("@/lib/demo-accounts");
    const admin = DEMO_ACCOUNTS.find((d) => d.key === "admin")!;
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: admin.email, ["password"]: admin.password });
    expect(login.status).toBe(200);
    const sessionToken: string = login.body["token"];
    expect(typeof sessionToken).toBe("string");

    const patched = await request(app)
      .patch("/api/settings")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ "app.testingMode": "true" });
    expect(patched.status).toBe(200);
    expect(patched.body["app.testingMode"]).toBe("true");

    const pub = await request(app).get("/api/settings/public");
    expect(pub.status).toBe(200);
    expect(pub.body.testingMode).toBe(true);
  });

  it("testing mode ON → every demo account+role is returned", async () => {
    const { DEMO_ACCOUNTS } = await import("@/lib/demo-accounts");
    const res = await request(app).get("/api/auth/demo-accounts");
    expect(res.status).toBe(200);
    expect(res.body.testingMode).toBe(true);
    const accounts = res.body.accounts as Array<{
      role: string;
      label: string;
      email: string;
      password: string;
      description: string;
      portal: string;
    }>;
    expect(accounts.map((a) => a.role).sort()).toEqual(DEMO_ACCOUNTS.map((d) => d.role).sort());
    for (const a of accounts) {
      expect(a.email).toBeTruthy();
      expect(a.password).toBeTruthy();
      expect(a.label).toBeTruthy();
      expect(a.description).toBeTruthy();
      expect(a.portal).toMatch(/^\//);
    }
  });

  it("each returned demo account logs in and /me reports its role", async () => {
    const res = await request(app).get("/api/auth/demo-accounts");
    const accounts = res.body.accounts as Array<{ role: string; email: string; password: string }>;
    expect(accounts.length).toBeGreaterThan(0);
    for (const a of accounts) {
      const login = await request(app)
        .post("/api/auth/login")
        .send({ email: a.email, ["password"]: a.password });
      expect(login.status).toBe(200);
      const sessionToken = login.body["token"];
      expect(typeof sessionToken).toBe("string");
      const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${sessionToken}`);
      expect(me.status).toBe(200);
      expect(me.body.user?.email.toLowerCase()).toBe(a.email.toLowerCase());
      expect(me.body.user?.role).toBe(a.role);
    }
  });
});
