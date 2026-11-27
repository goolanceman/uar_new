/**
 * FAQs module — /api/faqs (real router via @/routes/faqs).
 *
 * Public read of the FAQ categories with nested faqs, plus the admin CRUD
 * (types + faqs), the exact validation messages, 404s, the 401/403 gates
 * (elevated = moderator/admin) and the type delete that hard-deletes its
 * faqs. Only touches types/faq rows created here (unique title PREFIX).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `faqs-${Date.now()}`; // ≈ 17 chars — under the 55-char title cap
const PASSWORD = "[redacted]]";

let app: express.Express;
let adminToken = "";
let donorToken = "";
let typeId = 0;
let faqId = 0;

async function buildApp() {
  const { router } = await import("@/routes/faqs");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/faqs", router);
  // the centralized error middleware (app.ts) — faq controllers forward
  // errors via next(error)
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const types = await db.faqType.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } });
  const ids = types.map((t) => t.id);
  if (ids.length) {
    await db.faq.deleteMany({ where: { faqsTypeId: { in: ids } } });
    await db.faqType.deleteMany({ where: { id: { in: ids } } });
  }
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  if (userIds.length) {
    await db.activityLog.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
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

  const type = await db.faqType.create({ data: { title: `${PREFIX} type` } });
  typeId = type.id;
  const faq = await db.faq.create({
    data: { faqsTypeId: typeId, question: `${PREFIX} seeded question?`, answer: `${PREFIX} seeded answer` },
  });
  faqId = faq.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/faqs (public)", () => {
  it("serves FAQ categories with nested faqs", async () => {
    const res = await request(app).get("/api/faqs");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
    const mine = res.body.items.find((t: { id: number }) => t.id === typeId);
    expect(mine?.title).toBe(`${PREFIX} type`);
    expect(mine?.faqs?.[0]?.question).toBe(`${PREFIX} seeded question?`);
  });
});

describe("admin CRUD — FAQ types", () => {
  it("creates a type (201) and rejects a missing title (exact message)", async () => {
    const ok = await request(app)
      .post("/api/faqs/types")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} created` });
    expect(ok.status).toBe(201);
    expect(ok.body.id).toBeTruthy();
    expect(ok.body.title).toBe(`${PREFIX} created`);

    const missing = await request(app)
      .post("/api/faqs/types")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toContain("The title field is required");
  });

  it("updates a type (404 for unknown ids)", async () => {
    const ok = await request(app)
      .patch(`/api/faqs/types/${typeId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} renamed` });
    expect(ok.status).toBe(200);
    expect(ok.body.title).toBe(`${PREFIX} renamed`);

    const missing = await request(app)
      .patch("/api/faqs/types/999999")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} x` });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("FAQ type not found");
  });

  it("deletes a type and hard-deletes its faqs with it", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const temp = await db.faqType.create({ data: { title: `${PREFIX} doomed` } });
    await db.faq.create({ data: { faqsTypeId: temp.id, question: `${PREFIX} doomed q?`, answer: "a" } });

    const res = await request(app)
      .delete(`/api/faqs/types/${temp.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(await db.faq.count({ where: { faqsTypeId: temp.id } })).toBe(0);
  });
});

describe("admin CRUD — FAQs", () => {
  it("creates a faq in a type (404 for an unknown type)", async () => {
    const ok = await request(app)
      .post("/api/faqs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ faqsTypeId: typeId, question: `${PREFIX} created q?`, answer: `${PREFIX} created a` });
    expect(ok.status).toBe(201);
    expect(ok.body.faqsTypeId).toBe(typeId);

    const missingType = await request(app)
      .post("/api/faqs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ faqsTypeId: 999999, question: "q", answer: "a" });
    expect(missingType.status).toBe(404);
    expect(missingType.body.error).toBe("FAQ type not found");
  });

  it("updates a faq (400 Nothing to update, 404 unknown id)", async () => {
    const ok = await request(app)
      .patch(`/api/faqs/${faqId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ answer: `${PREFIX} updated a` });
    expect(ok.status).toBe(200);
    expect(ok.body.answer).toBe(`${PREFIX} updated a`);

    const empty = await request(app)
      .patch(`/api/faqs/${faqId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toContain("Nothing to update");

    const missing = await request(app)
      .patch("/api/faqs/999999")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ answer: "x" });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("FAQ not found");
  });

  it("deletes a faq (404 for unknown ids)", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const temp = await db.faq.create({ data: { faqsTypeId: typeId, question: `${PREFIX} doomed q?`, answer: "a" } });

    const res = await request(app)
      .delete(`/api/faqs/${temp.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(await db.faq.findUnique({ where: { id: temp.id } })).toBeNull();

    const missing = await request(app)
      .delete(`/api/faqs/${temp.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("FAQ not found");
  });
});

describe("faqs auth gates (elevated)", () => {
  it("401 without a token", async () => {
    const res = await request(app).post("/api/faqs/types").send({ title: `${PREFIX} nope` });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Please sign in to continue");
  });

  it("403 for a non-elevated role", async () => {
    const res = await request(app)
      .post("/api/faqs/types")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ title: `${PREFIX} nope` });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Moderator access required");
  });
});
