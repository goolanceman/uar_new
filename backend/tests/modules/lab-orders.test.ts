/**
 * Lab-orders integration tests — /api/lab-orders (thin routes over
 * src/modules/lab-orders). Linear state machine
 * ORDERED→SAMPLE_COLLECTED→RECEIVED→PROCESSING→RESULT_AVAILABLE→VERIFIED
 * →DOCTOR_REVIEWED with per-step role gates.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `lab-${Date.now()}`;
const PASSWORD = "lab-test-pass";

let app: express.Express;
let adminToken = "";
let doctorToken = "";
let labTechToken = "";
let nurseToken = "";
let volunteerToken = "";
let benToken = "";

const userIds: string[] = [];
let beneficiaryId = "";
let otherBeneficiaryId = "";
let campId = "";
let encounterId = "";

async function buildApp() {
  const { router } = await import("@/routes/lab-orders");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/lab-orders", router);
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
    await db.diagnosticOrder.deleteMany({ where: { beneficiaryId: { in: benIds } } });
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
  const labTech = await mk(`${PREFIX}-tech@test.local`, `${PREFIX} tech`, "LAB_TECH");
  const nurse = await mk(`${PREFIX}-nurse@test.local`, `${PREFIX} nurse`, "NURSE");
  const volunteer = await mk(`${PREFIX}-vol@test.local`, `${PREFIX} vol`, "VOLUNTEER");
  const ben = await mk(`${PREFIX}-ben@test.local`, `${PREFIX} ben`, "BENEFICIARY");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  doctorToken = issueToken({ userId: doctor.id, role: "DOCTOR", name: doctor.name, email: doctor.email });
  labTechToken = issueToken({ userId: labTech.id, role: "LAB_TECH", name: labTech.name, email: labTech.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
  volunteerToken = issueToken({ userId: volunteer.id, role: "VOLUNTEER", name: volunteer.name, email: volunteer.email });
  benToken = issueToken({ userId: ben.id, role: "BENEFICIARY", name: ben.name, email: ben.email });

  const professional = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr lab`, kind: "DOCTOR", userId: doctor.id },
  });
  const beneficiary = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 11)}`, name: `${PREFIX} patient`, userId: ben.id },
  });
  beneficiaryId = beneficiary.id;
  const otherBen = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 10)}w`, name: `${PREFIX} other patient` },
  });
  otherBeneficiaryId = otherBen.id;
  const camp = await db.medicalCamp.create({
    data: { code: `UAR-CAMP-${PREFIX.slice(4, 11)}`, title: `${PREFIX} camp`, campDate: new Date(), venue: `${PREFIX} venue` },
  });
  campId = camp.id;
  const encounter = await db.encounter.create({
    data: { beneficiaryId, doctorId: professional.id, status: "DRAFT" },
  });
  encounterId = encounter.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("lab-orders create", () => {
  it("401 anonymous; 403 NURSE (creation is DOCTOR|ADMIN)", async () => {
    const anon = await request(app).post("/api/lab-orders").send({});
    expect(anon.status).toBe(401);
    const nurse = await request(app)
      .post("/api/lab-orders")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId, testName: "CBC" });
    expect(nurse.status).toBe(403);
  });

  it("400 missing beneficiaryId; 404 unknown beneficiary/camp/encounter; 400 missing testName", async () => {
    const noBen = await request(app).post("/api/lab-orders").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(noBen.status).toBe(400);
    expect(noBen.body.error).toBe("beneficiaryId is required");

    const ghostBen = await request(app)
      .post("/api/lab-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId: "ghost" });
    expect(ghostBen.status).toBe(404);
    expect(ghostBen.body.error).toBe("Beneficiary not found");

    const noTest = await request(app)
      .post("/api/lab-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId });
    expect(noTest.status).toBe(400);
    expect(noTest.body.error).toBe("testName is required");

    const ghostCamp = await request(app)
      .post("/api/lab-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, testName: "CBC", campId: "ghost" });
    expect(ghostCamp.status).toBe(404);
    expect(ghostCamp.body.error).toBe("Camp not found");

    const ghostEnc = await request(app)
      .post("/api/lab-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, testName: "CBC", encounterId: "ghost" });
    expect(ghostEnc.status).toBe(404);
    expect(ghostEnc.body.error).toBe("Encounter not found");
  });

  it("DOCTOR orders a test — code UAR-LAB, status ORDERED (201)", async () => {
    const res = await request(app)
      .post("/api/lab-orders")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, campId, encounterId, testName: "CBC" });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^UAR-LAB-\d{5}$/);
    expect(res.body.status).toBe("ORDERED");
    expect(res.body.orderedByName).toBe(`${PREFIX} doctor`);
  });
});

describe("lab-orders list + detail", () => {
  it("list scoping: BENEFICIARY own-only; VOLUNTEER 403 mid-handler", async () => {
    const own = await request(app).get("/api/lab-orders").set("Authorization", `Bearer ${benToken}`);
    expect(own.status).toBe(200);
    expect(own.body.items.every((o: { beneficiaryId: string }) => o.beneficiaryId === beneficiaryId)).toBe(true);

    const vol = await request(app).get("/api/lab-orders").set("Authorization", `Bearer ${volunteerToken}`);
    expect(vol.status).toBe(403);
    expect(vol.body.error).toBe("You do not have permission for this action");

    const filtered = await request(app)
      .get("/api/lab-orders")
      .query({ beneficiaryId })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBeGreaterThan(0);
  });

  it("GET /:id — LAB_TECH 200, 404 unknown", async () => {
    const list = await request(app)
      .get("/api/lab-orders")
      .query({ beneficiaryId })
      .set("Authorization", `Bearer ${adminToken}`);
    const orderId = list.body.items[0].id;

    const tech = await request(app).get(`/api/lab-orders/${orderId}`).set("Authorization", `Bearer ${labTechToken}`);
    expect(tech.status).toBe(200);
    expect(tech.body.id).toBe(orderId);

    const missing = await request(app)
      .get("/api/lab-orders/ghost-order")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Lab order not found");
  });
});

describe("lab-orders linear pipeline", () => {
  let orderId = "";
  let orderCode = "";

  beforeAll(async () => {
    const created = await request(app)
      .post("/api/lab-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId: otherBeneficiaryId, testName: "LFT" });
    orderId = created.body.id;
    orderCode = created.body.code;
  });

  it("409 on skipping a step (ORDERED → RECEIVED)", async () => {
    const skip = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${labTechToken}`)
      .send({ status: "RECEIVED" });
    expect(skip.status).toBe(409);
    expect(skip.body.error).toBe("Invalid transition ORDERED → RECEIVED. Expected ORDERED → SAMPLE_COLLECTED");
  });

  it("403 DOCTOR cannot move to SAMPLE_COLLECTED (lab staff only)", async () => {
    const res = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ status: "SAMPLE_COLLECTED" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Only lab staff (or an admin) can move an order to SAMPLE_COLLECTED");
  });

  it("ORDERED → SAMPLE_COLLECTED stamps collectedAt", async () => {
    const res = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${labTechToken}`)
      .send({ status: "SAMPLE_COLLECTED" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SAMPLE_COLLECTED");
    expect(res.body.collectedAt).toBeTruthy();
  });

  it("SAMPLE_COLLECTED → RECEIVED → PROCESSING", async () => {
    const r = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${labTechToken}`)
      .send({ status: "RECEIVED" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("RECEIVED");

    const p = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${labTechToken}`)
      .send({ status: "PROCESSING" });
    expect(p.status).toBe(200);
    expect(p.body.status).toBe("PROCESSING");
  });

  it("PROCESSING → RESULT_AVAILABLE requires resultText or resultFileUrl (400); DOCTOR cannot attach files", async () => {
    const noResult = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${labTechToken}`)
      .send({ status: "RESULT_AVAILABLE" });
    expect(noResult.status).toBe(400);
    expect(noResult.body.error).toBe("Provide resultText or resultFileUrl when moving to RESULT_AVAILABLE");

    const doctorFile = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ resultFileUrl: "https://example.com/r.pdf" });
    expect(doctorFile.status).toBe(403);
    expect(doctorFile.body.error).toBe("Only lab staff (or an admin) can attach result files");

    const badUrl = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${labTechToken}`)
      .send({ resultFileUrl: "javascript:alert(1)" });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.error).toBe("resultFileUrl must be a /api/files/:id/file URL or an https URL");

    const ok = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${labTechToken}`)
      .send({ status: "RESULT_AVAILABLE", resultText: "ALT elevated" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("RESULT_AVAILABLE");
    expect(ok.body.resultText).toBe("ALT elevated");
  });

  it("RESULT_AVAILABLE → VERIFIED stamps verifiedByName (lab tech); critical flag is DOCTOR/ADMIN only", async () => {
    const techCritical = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${labTechToken}`)
      .send({ critical: true });
    expect(techCritical.status).toBe(403);
    expect(techCritical.body.error).toBe("Only a doctor (or an admin) can flag a result critical");

    const critical = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ critical: true });
    expect(critical.status).toBe(200);
    expect(critical.body.critical).toBe(true);

    const verify = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${labTechToken}`)
      .send({ status: "VERIFIED" });
    expect(verify.status).toBe(200);
    expect(verify.body.status).toBe("VERIFIED");
    expect(verify.body.verifiedByName).toBe(`${PREFIX} tech`);
    expect(verify.body.verifiedAt).toBeTruthy();
  });

  it("VERIFIED → DOCTOR_REVIEWED is doctor-only; lab tech 403; doctor moves it; then terminal 409", async () => {
    const tech = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${labTechToken}`)
      .send({ status: "DOCTOR_REVIEWED" });
    expect(tech.status).toBe(403);
    expect(tech.body.error).toBe("Only a doctor (or an admin) can mark a result DOCTOR_REVIEWED");

    const doctor = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ status: "DOCTOR_REVIEWED" });
    expect(doctor.status).toBe(200);
    expect(doctor.body.status).toBe("DOCTOR_REVIEWED");
    expect(doctor.body.reviewedAt).toBeTruthy();

    const terminal = await request(app)
      .patch(`/api/lab-orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "VERIFIED" });
    expect(terminal.status).toBe(409);
    expect(terminal.body.error).toBe(
      `Lab order ${orderCode} is already DOCTOR_REVIEWED — no further transitions`
    );
  });

  it("empty patch 400 with the VERIFIED hint; 404 unknown order", async () => {
    const created = await request(app)
      .post("/api/lab-orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId: otherBeneficiaryId, testName: "Glucose fasting" });

    const empty = await request(app)
      .patch(`/api/lab-orders/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    const missing = await request(app)
      .patch("/api/lab-orders/ghost-order")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "RECEIVED" });
    expect(missing.status).toBe(404);
  });
});

void nurseToken;
