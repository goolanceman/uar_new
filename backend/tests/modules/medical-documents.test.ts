/**
 * Medical-documents integration tests — /api/medical-documents (thin routes
 * over src/modules/medical-documents). Role scoping, url validation, kind
 * enum, BENEFICIARY self-service, ADMIN delete.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `mdoc-${Date.now()}`;
const PASSWORD = "mdoc-test-pass";

let app: express.Express;
let adminToken = "";
let doctorToken = "";
let nurseToken = "";
let benToken = "";
let noRecordBenToken = "";

const userIds: string[] = [];
let beneficiaryId = "";
let campId = "";

async function buildApp() {
  const { router } = await import("@/routes/medical-documents");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/medical-documents", router);
  a.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const bens = await db.beneficiary.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const benIds = bens.map((b) => b.id);
  if (benIds.length) {
    await db.medicalDocument.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.encounter.deleteMany({ where: { beneficiaryId: { in: benIds } } });
  }
  await db.medicalCamp.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await db.beneficiary.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.healthProfessional.deleteMany({ where: { name: { startsWith: PREFIX } } });
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
  const noRec = await mk(`${PREFIX}-norec@test.local`, `${PREFIX} norec`, "BENEFICIARY");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  doctorToken = issueToken({ userId: doctor.id, role: "DOCTOR", name: doctor.name, email: doctor.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
  benToken = issueToken({ userId: ben.id, role: "BENEFICIARY", name: ben.name, email: ben.email });
  noRecordBenToken = issueToken({ userId: noRec.id, role: "BENEFICIARY", name: noRec.name, email: noRec.email });

  const professional = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr doc`, kind: "DOCTOR", userId: doctor.id },
  });
  void professional;
  const beneficiary = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(5, 12)}`, name: `${PREFIX} patient`, userId: ben.id },
  });
  beneficiaryId = beneficiary.id;
  const camp = await db.medicalCamp.create({
    data: { code: `UAR-CAMP-${PREFIX.slice(5, 12)}`, title: `${PREFIX} camp`, campDate: new Date(), venue: `${PREFIX} venue` },
  });
  campId = camp.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("medical-documents create", () => {
  it("401 anonymous; 403 BENEFICIARY without a linked patient record", async () => {
    const anon = await request(app).post("/api/medical-documents").send({});
    expect(anon.status).toBe(401);

    const noRecord = await request(app)
      .post("/api/medical-documents")
      .set("Authorization", `Bearer ${noRecordBenToken}`)
      .send({ beneficiaryId, name: "x", url: "https://example.com/a.pdf" });
    expect(noRecord.status).toBe(403);
    expect(noRecord.body.error).toBe("No patient record is linked to your account yet");
  });

  it("400 missing beneficiaryId; 404 unknown beneficiary/camp", async () => {
    const noBen = await request(app)
      .post("/api/medical-documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(noBen.status).toBe(400);
    expect(noBen.body.error).toBe("beneficiaryId is required");

    const ghostBen = await request(app)
      .post("/api/medical-documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId: "ghost" });
    expect(ghostBen.status).toBe(404);
    expect(ghostBen.body.error).toBe("Beneficiary not found");

    const noName = await request(app)
      .post("/api/medical-documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId });
    expect(noName.status).toBe(400);
    expect(noName.body.error).toBe("name is required");

    const noUrl = await request(app)
      .post("/api/medical-documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, name: "report" });
    expect(noUrl.status).toBe(400);
    expect(noUrl.body.error).toBe("url is required");

    const badUrl = await request(app)
      .post("/api/medical-documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, name: "report", url: "javascript:alert(1)" });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.error).toBe("url must be a /api/files/:id/file URL or an http(s) URL");

    const badKind = await request(app)
      .post("/api/medical-documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, name: "report", url: "https://example.com/a.pdf", kind: "SELFIE" });
    expect(badKind.status).toBe(400);
    expect(badKind.body.error).toBe("kind must be one of: PRESCRIPTION, LAB_REPORT, DISCHARGE_SUMMARY, REFERRAL, OTHER");

    const ghostCamp = await request(app)
      .post("/api/medical-documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, name: "report", url: "https://example.com/a.pdf", campId: "ghost" });
    expect(ghostCamp.status).toBe(404);
    expect(ghostCamp.body.error).toBe("Camp not found");
  });

  it("staff uploads; BENEFICIARY attaches to its own record (beneficiaryId forced)", async () => {
    const byNurse = await request(app)
      .post("/api/medical-documents")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId, campId, name: `${PREFIX} x-ray`, kind: "LAB_REPORT", url: "/api/files/abc123/file" });
    expect(byNurse.status).toBe(201);
    expect(byNurse.body.kind).toBe("LAB_REPORT");
    expect(byNurse.body.uploadedByName).toBe(`${PREFIX} nurse`);

    const byBen = await request(app)
      .post("/api/medical-documents")
      .set("Authorization", `Bearer ${benToken}`)
      .send({ beneficiaryId: "someone-else", name: `${PREFIX} self upload`, url: "https://example.com/b.pdf" });
    expect(byBen.status).toBe(201);
    expect(byBen.body.beneficiaryId).toBe(beneficiaryId); // forced to own record
    expect(byBen.body.kind).toBe("OTHER");
  });
});

describe("medical-documents list + detail", () => {
  it("list: staff with beneficiaryId filter; BENEFICIARY own-only", async () => {
    const filtered = await request(app)
      .get("/api/medical-documents")
      .query({ beneficiaryId })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBeGreaterThanOrEqual(2);
    expect(filtered.body.items.every((d: { beneficiaryId: string }) => d.beneficiaryId === beneficiaryId)).toBe(true);

    const own = await request(app)
      .get("/api/medical-documents")
      .set("Authorization", `Bearer ${benToken}`);
    expect(own.status).toBe(200);
    expect(own.body.items.every((d: { beneficiaryId: string }) => d.beneficiaryId === beneficiaryId)).toBe(true);

    const empty = await request(app)
      .get("/api/medical-documents")
      .set("Authorization", `Bearer ${noRecordBenToken}`);
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);
  });

  it("GET /:id — 200, 404 unknown, foreign BENEFICIARY 403", async () => {
    const list = await request(app)
      .get("/api/medical-documents")
      .query({ beneficiaryId })
      .set("Authorization", `Bearer ${doctorToken}`);
    const docId = list.body.items[0].id;

    const one = await request(app)
      .get(`/api/medical-documents/${docId}`)
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(docId);

    const missing = await request(app)
      .get("/api/medical-documents/ghost-doc")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Document not found");

    const foreign = await request(app)
      .get(`/api/medical-documents/${docId}`)
      .set("Authorization", `Bearer ${noRecordBenToken}`);
    expect(foreign.status).toBe(403);
  });
});

describe("medical-documents delete", () => {
  it("DOCTOR 403; ADMIN deletes; 404 afterwards", async () => {
    const created = await request(app)
      .post("/api/medical-documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, name: `${PREFIX} doomed doc`, url: "https://example.com/c.pdf" });

    const doctor = await request(app)
      .delete(`/api/medical-documents/${created.body.id}`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(doctor.status).toBe(403);

    const ok = await request(app)
      .delete(`/api/medical-documents/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);

    const gone = await request(app)
      .delete(`/api/medical-documents/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(gone.status).toBe(404);
    expect(gone.body.error).toBe("Document not found");
  });
});
