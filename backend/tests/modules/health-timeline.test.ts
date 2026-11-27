/**
 * Health-timeline integration tests — GET /api/health-timeline (thin route
 * over src/modules/health-timeline). Seeds the full entity chain via db and
 * asserts the merged, descending chronology + role scoping.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `htl-${Date.now()}`;
const PASSWORD = "htl-test-pass";

let app: express.Express;
let adminToken = "";
let doctorToken = "";
let nurseToken = "";
let benToken = "";
let volunteerToken = "";
let noRecordBenToken = "";

const userIds: string[] = [];
let beneficiaryId = "";
let encounterId = "";
let vitalId = "";
let screeningId = "";
let prescriptionId = "";
let labOrderId = "";
let referralId = "";
let followUpId = "";
let documentId = "";

async function buildApp() {
  const { router } = await import("@/routes/health-timeline");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/health-timeline", router);
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
    await db.medicationDispense.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.prescription.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.diagnosticOrder.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.followUp.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.medicalReferral.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.medicalDocument.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.vitalObservation.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.screeningRecord.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.encounter.deleteMany({ where: { beneficiaryId: { in: benIds } } });
  }
  await db.healthProfessional.deleteMany({ where: { name: { startsWith: PREFIX } } });
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
  const volunteer = await mk(`${PREFIX}-vol@test.local`, `${PREFIX} vol`, "VOLUNTEER");
  const noRec = await mk(`${PREFIX}-norec@test.local`, `${PREFIX} norec`, "BENEFICIARY");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  doctorToken = issueToken({ userId: doctor.id, role: "DOCTOR", name: doctor.name, email: doctor.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
  benToken = issueToken({ userId: ben.id, role: "BENEFICIARY", name: ben.name, email: ben.email });
  volunteerToken = issueToken({ userId: volunteer.id, role: "VOLUNTEER", name: volunteer.name, email: volunteer.email });
  noRecordBenToken = issueToken({ userId: noRec.id, role: "BENEFICIARY", name: noRec.name, email: noRec.email });

  const professional = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr time`, kind: "DOCTOR", userId: doctor.id },
  });

  const beneficiary = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 11)}`, name: `${PREFIX} patient`, userId: ben.id },
  });
  beneficiaryId = beneficiary.id;

  const encounter = await db.encounter.create({
    data: { beneficiaryId: beneficiary.id, doctorId: professional.id, status: "SIGNED", diagnosis: "Fever" },
  });
  encounterId = encounter.id;
  const vital = await db.vitalObservation.create({
    data: { beneficiaryId: beneficiary.id, bpSystolic: 120, bpDiastolic: 80, pulse: 72 },
  });
  vitalId = vital.id;
  const screening = await db.screeningRecord.create({
    data: { beneficiaryId: beneficiary.id, type: "EYE", result: "Reduced vision", abnormal: true },
  });
  screeningId = screening.id;
  const rx = await db.prescription.create({
    data: {
      code: `UAR-RX-${PREFIX.slice(4, 11)}`,
      beneficiaryId: beneficiary.id,
      doctorId: professional.id,
      status: "DRAFT",
    },
  });
  prescriptionId = rx.id;
  const lab = await db.diagnosticOrder.create({
    data: { code: `UAR-LAB-${PREFIX.slice(4, 11)}`, beneficiaryId: beneficiary.id, testName: "CBC", critical: true },
  });
  labOrderId = lab.id;
  const referral = await db.medicalReferral.create({
    data: { code: `UAR-REF-${PREFIX.slice(4, 11)}`, beneficiaryId: beneficiary.id, reason: "Specialist review", priority: "HIGH" },
  });
  referralId = referral.id;
  const followUp = await db.followUp.create({
    data: { beneficiaryId: beneficiary.id, dueDate: new Date(), status: "PENDING" },
  });
  followUpId = followUp.id;
  const document = await db.medicalDocument.create({
    data: { beneficiaryId: beneficiary.id, name: `${PREFIX} scan`, kind: "LAB_REPORT", url: "https://example.com/x.pdf" },
  });
  documentId = document.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("health-timeline authz", () => {
  it("401 anonymous", async () => {
    const res = await request(app).get("/api/health-timeline").query({ beneficiaryId });
    expect(res.status).toBe(401);
  });

  it("403 for roles outside ADMIN|DOCTOR|NURSE|BENEFICIARY", async () => {
    const res = await request(app)
      .get("/api/health-timeline")
      .query({ beneficiaryId })
      .set("Authorization", `Bearer ${volunteerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("health-timeline staff view", () => {
  it("400 without beneficiaryId, 404 for an unknown beneficiary", async () => {
    const missing = await request(app).get("/api/health-timeline").set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("beneficiaryId is required");

    const ghost = await request(app)
      .get("/api/health-timeline")
      .query({ beneficiaryId: "ghost-beneficiary" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("Beneficiary not found");
  });

  it("merges every record kind into one descending list with generatedBy system", async () => {
    const res = await request(app)
      .get("/api/health-timeline")
      .query({ beneficiaryId })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.generatedBy).toBe("system");
    expect(res.body.beneficiary.id).toBe(beneficiaryId);
    expect(res.body.beneficiary.code).toContain("UAR-BEN");

    const kinds = res.body.items.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain("encounter");
    expect(kinds).toContain("vitals");
    expect(kinds).toContain("screening");
    expect(kinds).toContain("prescription");
    expect(kinds).toContain("lab");
    expect(kinds).toContain("referral");
    expect(kinds).toContain("followup");
    expect(kinds).toContain("document");
    expect(res.body.total).toBe(res.body.items.length);

    const lab = res.body.items.find((e: { kind: string }) => e.kind === "lab");
    expect(lab.data.id).toBe(labOrderId);
    expect(lab.summary).toContain("CRITICAL");
    const enc = res.body.items.find((e: { kind: string }) => e.kind === "encounter");
    expect(enc.data.id).toBe(encounterId);
    const rx = res.body.items.find((e: { kind: string }) => e.kind === "prescription");
    expect(rx.data.id).toBe(prescriptionId);
    const scr = res.body.items.find((e: { kind: string }) => e.kind === "screening");
    expect(scr.summary).toContain("abnormal");

    // descending by at
    const ats = res.body.items.map((e: { at: string }) => new Date(e.at).getTime());
    const sorted = [...ats].sort((a, b) => b - a);
    expect(ats).toEqual(sorted);
  });

  it("NURSE can read the same timeline", async () => {
    const res = await request(app)
      .get("/api/health-timeline")
      .query({ beneficiaryId })
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
  });
});

describe("health-timeline beneficiary self-view", () => {
  it("BENEFICIARY sees its own chronology without passing beneficiaryId", async () => {
    const res = await request(app).get("/api/health-timeline").set("Authorization", `Bearer ${benToken}`);
    expect(res.status).toBe(200);
    expect(res.body.beneficiary.id).toBe(beneficiaryId);
    const kinds = res.body.items.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain("vitals");
    expect(kinds).toContain("encounter");
  });

  it("BENEFICIARY without a linked patient record gets an empty page", async () => {
    const res = await request(app).get("/api/health-timeline").set("Authorization", `Bearer ${noRecordBenToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.beneficiary).toBeNull();
  });
});

// keep referenced ids used above from being flagged unused in strict builds
void vitalId;
void screeningId;
void referralId;
void followUpId;
void documentId;
