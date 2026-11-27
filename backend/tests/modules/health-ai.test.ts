/**
 * Health-AI integration tests — /api/health-ai (thin routes over
 * src/modules/health-ai). Covers ONLY the validation / role / 404 / review
 * / rate-limit paths — never the external AI SDK generation flows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `hai-${Date.now()}`;
const PASSWORD = "hai-test-pass";

let app: express.Express;
let adminToken = "";
let doctorToken = "";
let nurseToken = "";
let benToken = "";
let rlToken = ""; // dedicated user for the 429 test
let rlUserId = "";

const userIds: string[] = [];
let beneficiaryId = "";
let documentId = "";
let interactionId = "";

async function buildApp() {
  const { router } = await import("@/routes/health-ai");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/health-ai", router);
  a.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.aIInteraction.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { id: interactionId }] } });
  await db.medicalDocument.deleteMany({ where: { beneficiary: { name: { startsWith: PREFIX } } } });
  await db.beneficiary.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.activityLog.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");

  const mk = async (email: string, name: string, role: string) => {
    const u = await db.user.create({
      data: { email, name, role, password: hashPassword(PASSWORD), status: "ACTIVE", isActive: true },
    });
    userIds.push(u.id);
    return u;
  };

  const admin = await mk(`${PREFIX}-admin@test.local`, `${PREFIX} admin`, "ADMIN");
  const doctor = await mk(`${PREFIX}-doctor@test.local`, `${PREFIX} doctor`, "DOCTOR");
  const nurse = await mk(`${PREFIX}-nurse@test.local`, `${PREFIX} nurse`, "NURSE");
  const ben = await mk(`${PREFIX}-ben@test.local`, `${PREFIX} ben`, "BENEFICIARY");
  const rl = await mk(`${PREFIX}-rl@test.local`, `${PREFIX} ratelimit`, "ADMIN");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  doctorToken = issueToken({ userId: doctor.id, role: "DOCTOR", name: doctor.name, email: doctor.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
  benToken = issueToken({ userId: ben.id, role: "BENEFICIARY", name: ben.name, email: ben.email });
  rlToken = issueToken({ userId: rl.id, role: "ADMIN", name: rl.name, email: rl.email });
  rlUserId = rl.id;

  const beneficiary = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 11)}`, name: `${PREFIX} patient`, userId: ben.id },
  });
  beneficiaryId = beneficiary.id;

  const doc = await db.medicalDocument.create({
    data: { beneficiaryId: beneficiary.id, name: `${PREFIX} report`, kind: "LAB_REPORT", url: "https://example.com/x.txt" },
  });
  documentId = doc.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("health-ai list (audit)", () => {
  it("401 anonymous, 403 non-admin, 200 for ADMIN", async () => {
    const anon = await request(app).get("/api/health-ai");
    expect(anon.status).toBe(401);

    const nurse = await request(app).get("/api/health-ai").set("Authorization", `Bearer ${nurseToken}`);
    expect(nurse.status).toBe(403);

    const admin = await request(app).get("/api/health-ai").set("Authorization", `Bearer ${adminToken}`);
    expect(admin.status).toBe(200);
    expect(Array.isArray(admin.body.items)).toBe(true);
    expect(typeof admin.body.total).toBe("number");
  });
});

describe("health-ai POST validation / roles / 404 (no AI generation)", () => {
  it("401 anonymous", async () => {
    const res = await request(app).post("/api/health-ai").send({ action: "camp-plan" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown action (400)", async () => {
    const res = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "write-poetry" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("action must be one of: consult-draft, timeline-summary, camp-plan, doc-extract");
  });

  it("consult-draft: ADMIN 403, DOCTOR missing beneficiaryId 400, unknown beneficiary 404, unknown encounter 404", async () => {
    const forbidden = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "consult-draft", beneficiaryId });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("consult-draft is available to doctors only");

    const missing = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ action: "consult-draft" });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("beneficiaryId is required");

    const noBen = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ action: "consult-draft", beneficiaryId: "ghost" });
    expect(noBen.status).toBe(404);
    expect(noBen.body.error).toBe("Beneficiary not found");

    const noEnc = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ action: "consult-draft", beneficiaryId, encounterId: "ghost-encounter" });
    expect(noEnc.status).toBe(404);
    expect(noEnc.body.error).toBe("Encounter not found");
  });

  it("timeline-summary: NURSE 403, DOCTOR missing beneficiaryId 400, unknown beneficiary 404", async () => {
    const forbidden = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ action: "timeline-summary", beneficiaryId });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("timeline-summary is available to doctors and admins only");

    const missing = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ action: "timeline-summary" });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("beneficiaryId is required");

    const noBen = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ action: "timeline-summary", beneficiaryId: "ghost" });
    expect(noBen.status).toBe(404);
  });

  it("camp-plan: DOCTOR 403 (admins only)", async () => {
    const res = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ action: "camp-plan", city: "Testville" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("camp-plan is available to admins only");
  });

  it("doc-extract: BENEFICIARY 403, missing documentId 400, unknown document 404", async () => {
    const forbidden = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${benToken}`)
      .send({ action: "doc-extract", documentId });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("doc-extract is available to staff only");

    const missing = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "doc-extract" });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("documentId is required");

    const noDoc = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "doc-extract", documentId: "ghost-doc" });
    expect(noDoc.status).toBe(404);
    expect(noDoc.body.error).toBe("Document not found");
  });
});

describe("health-ai rate limit (429)", () => {
  it("returns 429 after 20 AI calls per hour for the same account", async () => {
    const { resetRateLimit } = await import("@/infrastructure/cache/rate-limit");
    resetRateLimit(`health-ai:${rlUserId}`);

    // 20 calls are allowed (each rejected 400 for the bogus action — no AI SDK hit)
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post("/api/health-ai")
        .set("Authorization", `Bearer ${rlToken}`)
        .send({ action: "write-poetry" });
      expect(res.status).toBe(400);
    }

    const blocked = await request(app)
      .post("/api/health-ai")
      .set("Authorization", `Bearer ${rlToken}`)
      .send({ action: "write-poetry" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("Too many AI requests — please try again in a while.");
  });
});

describe("health-ai review (PATCH /:id)", () => {
  it("401 anonymous, 403 non-reviewer roles", async () => {
    const anon = await request(app).patch("/api/health-ai/whatever").send({ status: "APPROVED" });
    expect(anon.status).toBe(401);

    const nurse = await request(app)
      .patch("/api/health-ai/whatever")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ status: "APPROVED" });
    expect(nurse.status).toBe(403);
  });

  it("400 invalid status, 404 unknown interaction", async () => {
    const bad = await request(app)
      .patch(`/api/health-ai/some-id`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "MAYBE" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("status must be one of: APPROVED, REJECTED, PENDING");

    const missing = await request(app)
      .patch("/api/health-ai/no-such-interaction")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "APPROVED" });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("AI interaction not found");
  });

  it("human review PENDING → APPROVED stamps reviewedByName; second decision 409", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const row = await db.aIInteraction.create({
      data: { action: "CONSULT_DRAFT", entityType: "BENEFICIARY", entityId: beneficiaryId, status: "PENDING" },
    });
    interactionId = row.id;

    const approve = await request(app)
      .patch(`/api/health-ai/${interactionId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "APPROVED" });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("APPROVED");
    expect(approve.body.reviewedByName).toBe(`${PREFIX} admin`);

    const again = await request(app)
      .patch(`/api/health-ai/${interactionId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "REJECTED" });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("Cannot move AI interaction from APPROVED to REJECTED. Allowed: none");
  });
});
