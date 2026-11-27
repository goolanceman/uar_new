/**
 * Follow-ups integration tests — /api/follow-ups (thin routes over
 * src/modules/follow-ups). Creation validation, overdue filter, terminal
 * status machine (DONE/MISSED/CANCELLED).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `fup-${Date.now()}`;
const PASSWORD = "fup-test-pass";

let app: express.Express;
let adminToken = "";
let doctorToken = "";
let nurseToken = "";
let volunteerToken = "";
let benToken = "";

const userIds: string[] = [];
let beneficiaryId = "";
let otherBeneficiaryId = "";
let campId = "";
let referralId = "";

async function buildApp() {
  const { router } = await import("@/routes/follow-ups");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/follow-ups", router);
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
    await db.followUp.deleteMany({ where: { beneficiaryId: { in: benIds } } });
    await db.medicalReferral.deleteMany({ where: { beneficiaryId: { in: benIds } } });
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
  const volunteer = await mk(`${PREFIX}-vol@test.local`, `${PREFIX} vol`, "VOLUNTEER");
  const ben = await mk(`${PREFIX}-ben@test.local`, `${PREFIX} ben`, "BENEFICIARY");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  doctorToken = issueToken({ userId: doctor.id, role: "DOCTOR", name: doctor.name, email: doctor.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
  volunteerToken = issueToken({ userId: volunteer.id, role: "VOLUNTEER", name: volunteer.name, email: volunteer.email });
  benToken = issueToken({ userId: ben.id, role: "BENEFICIARY", name: ben.name, email: ben.email });

  const professional = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr fup`, kind: "DOCTOR", userId: doctor.id },
  });
  const beneficiary = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 11)}`, name: `${PREFIX} patient`, userId: ben.id },
  });
  beneficiaryId = beneficiary.id;
  const otherBen = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 10)}v`, name: `${PREFIX} other patient` },
  });
  otherBeneficiaryId = otherBen.id;
  const camp = await db.medicalCamp.create({
    data: { code: `UAR-CAMP-${PREFIX.slice(4, 11)}`, title: `${PREFIX} camp`, campDate: new Date(), venue: `${PREFIX} venue` },
  });
  campId = camp.id;
  const referral = await db.medicalReferral.create({
    data: { code: `UAR-REF-${PREFIX.slice(4, 11)}`, beneficiaryId, reason: `${PREFIX} reason`, priority: "MEDIUM" },
  });
  referralId = referral.id;
  void professional;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("follow-ups create", () => {
  it("401 anonymous; 403 BENEFICIARY (create is DOCTOR|ADMIN|NURSE)", async () => {
    const anon = await request(app).post("/api/follow-ups").send({});
    expect(anon.status).toBe(401);

    const ben = await request(app)
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${benToken}`)
      .send({ beneficiaryId });
    expect(ben.status).toBe(403);
  });

  it("400 missing beneficiaryId; 404 unknown beneficiary/camp/referral", async () => {
    const noBen = await request(app).post("/api/follow-ups").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(noBen.status).toBe(400);
    expect(noBen.body.error).toBe("beneficiaryId is required");

    const ghostBen = await request(app)
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId: "ghost" });
    expect(ghostBen.status).toBe(404);
    expect(ghostBen.body.error).toBe("Beneficiary not found");

    const noDue = await request(app)
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId });
    expect(noDue.status).toBe(400);
    expect(noDue.body.error).toBe("A valid dueDate is required");

    const badDue = await request(app)
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, dueDate: "someday" });
    expect(badDue.status).toBe(400);
    expect(badDue.body.error).toBe("A valid dueDate is required");

    const ghostCamp = await request(app)
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, dueDate: new Date(), campId: "ghost" });
    expect(ghostCamp.status).toBe(404);
    expect(ghostCamp.body.error).toBe("Camp not found");

    const ghostRef = await request(app)
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, dueDate: new Date(), referralId: "ghost" });
    expect(ghostRef.status).toBe(404);
    expect(ghostRef.body.error).toBe("Referral not found");
  });

  it("NURSE creates a PENDING follow-up with camp + referral links (201)", async () => {
    const res = await request(app)
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({
        beneficiaryId,
        campId,
        referralId,
        dueDate: new Date().toISOString(),
        instructions: "Bring previous reports",
        ownerName: `${PREFIX} owner`,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.instructions).toBe("Bring previous reports");
    expect(res.body.ownerName).toBe(`${PREFIX} owner`);
    expect(res.body.referralId).toBe(referralId);
  });
});

describe("follow-ups list", () => {
  it("status filter; overdue=1 pins PENDING + past due date; BENEFICIARY own-only", async () => {
    const past = await request(app)
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, dueDate: new Date(Date.now() - 7 * 86400_000).toISOString() });
    expect(past.status).toBe(201);

    const overdue = await request(app)
      .get("/api/follow-ups")
      .query({ overdue: "1", beneficiaryId })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(overdue.status).toBe(200);
    expect(overdue.body.items.every((f: { status: string }) => f.status === "PENDING")).toBe(true);
    expect(overdue.body.items.map((f: { beneficiaryId: string }) => f.beneficiaryId)).toContain(beneficiaryId);

    const pending = await request(app)
      .get("/api/follow-ups")
      .query({ status: "PENDING" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(pending.body.items.every((f: { status: string }) => f.status === "PENDING")).toBe(true);

    const own = await request(app).get("/api/follow-ups").set("Authorization", `Bearer ${benToken}`);
    expect(own.status).toBe(200);
    expect(own.body.items.every((f: { beneficiaryId: string }) => f.beneficiaryId === beneficiaryId)).toBe(true);
  });
});

describe("follow-ups detail + transitions", () => {
  let followUpId = "";

  beforeAll(async () => {
    const created = await request(app)
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId: otherBeneficiaryId, dueDate: new Date().toISOString() });
    followUpId = created.body.id;
  });

  it("GET /:id — VOLUNTEER 200, 404 unknown", async () => {
    const one = await request(app)
      .get(`/api/follow-ups/${followUpId}`)
      .set("Authorization", `Bearer ${volunteerToken}`);
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(followUpId);

    const missing = await request(app)
      .get("/api/follow-ups/ghost-fup")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Follow-up not found");
  });

  it("PENDING → DONE stamps doneAt with the outcome; empty patch 400", async () => {
    const done = await request(app)
      .patch(`/api/follow-ups/${followUpId}`)
      .set("Authorization", `Bearer ${volunteerToken}`)
      .send({ status: "DONE", outcome: "Patient recovering well" });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("DONE");
    expect(done.body.doneAt).toBeTruthy();
    expect(done.body.outcome).toBe("Patient recovering well");

    const empty = await request(app)
      .patch(`/api/follow-ups/${followUpId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    const missing = await request(app)
      .patch("/api/follow-ups/ghost-fup")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "DONE" });
    expect(missing.status).toBe(404);
  });

  it("400 invalid status value; 409 relabeling a terminal follow-up", async () => {
    const created = await request(app)
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId: otherBeneficiaryId, dueDate: new Date().toISOString() });
    const id = created.body.id;

    const bad = await request(app)
      .patch(`/api/follow-ups/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "LATER" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("status must be one of: DONE, MISSED, CANCELLED");

    const done = await request(app)
      .patch(`/api/follow-ups/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "MISSED" });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("MISSED");
    expect(done.body.doneAt).toBeNull();

    const relabel = await request(app)
      .patch(`/api/follow-ups/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CANCELLED" });
    expect(relabel.status).toBe(409);
    expect(relabel.body.error).toBe("Cannot move follow-up from MISSED to CANCELLED. Allowed: none");
  });

  it("PENDING → CANCELLED is a legal exit", async () => {
    const created = await request(app)
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId: otherBeneficiaryId, dueDate: new Date().toISOString() });
    const res = await request(app)
      .patch(`/api/follow-ups/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CANCELLED", outcome: "family moved away" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
    expect(res.body.outcome).toBe("family moved away");
  });
});
