/**
 * Appointments integration tests — /api/appointments (thin routes over
 * src/modules/appointments). Booking validation, DOCTOR auto-link,
 * BENEFICIARY scoping, visit workflow transitions, delete guard.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `apt-${Date.now()}`;
const PASSWORD = "apt-test-pass";

let app: express.Express;
let adminToken = "";
let doctorToken = "";
let volunteerToken = "";
let nurseToken = "";
let benToken = "";

const userIds: string[] = [];
let professionalId = "";
let beneficiaryId = "";
let otherBeneficiaryId = "";
let campId = "";

async function buildApp() {
  const { router } = await import("@/routes/appointments");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/appointments", router);
  a.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const bens = await db.beneficiary.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const benIds = bens.map((b) => b.id);
  await db.appointment.deleteMany({ where: { OR: [{ beneficiaryId: { in: benIds } }, { professionalId }] } });
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
  const volunteer = await mk(`${PREFIX}-vol@test.local`, `${PREFIX} vol`, "VOLUNTEER");
  const nurse = await mk(`${PREFIX}-nurse@test.local`, `${PREFIX} nurse`, "NURSE");
  const ben = await mk(`${PREFIX}-ben@test.local`, `${PREFIX} ben`, "BENEFICIARY");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  doctorToken = issueToken({ userId: doctor.id, role: "DOCTOR", name: doctor.name, email: doctor.email });
  volunteerToken = issueToken({ userId: volunteer.id, role: "VOLUNTEER", name: volunteer.name, email: volunteer.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
  benToken = issueToken({ userId: ben.id, role: "BENEFICIARY", name: ben.name, email: ben.email });

  const professional = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr apt`, kind: "DOCTOR", userId: doctor.id },
  });
  professionalId = professional.id;

  const beneficiary = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 11)}`, name: `${PREFIX} patient`, userId: ben.id },
  });
  beneficiaryId = beneficiary.id;
  const other = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 10)}x`, name: `${PREFIX} other patient` },
  });
  otherBeneficiaryId = other.id;

  const camp = await db.medicalCamp.create({
    data: { code: `UAR-CAMP-${PREFIX.slice(4, 11)}`, title: `${PREFIX} camp`, campDate: new Date(), venue: `${PREFIX} venue` },
  });
  campId = camp.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("appointments create", () => {
  it("401 anonymous; 403 BENEFICIARY/NURSE cannot book", async () => {
    const anon = await request(app).post("/api/appointments").send({});
    expect(anon.status).toBe(401);
    const ben = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${benToken}`)
      .send({ beneficiaryId });
    expect(ben.status).toBe(403);
    const nurse = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId });
    expect(nurse.status).toBe(403);
  });

  it("400 missing beneficiaryId; 404 unknown beneficiary/camp/professional", async () => {
    const noBen = await request(app).post("/api/appointments").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(noBen.status).toBe(400);
    expect(noBen.body.error).toBe("beneficiaryId is required");

    const ghostBen = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId: "ghost" });
    expect(ghostBen.status).toBe(404);
    expect(ghostBen.body.error).toBe("Beneficiary not found");

    const ghostCamp = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, campId: "ghost" });
    expect(ghostCamp.status).toBe(404);
    expect(ghostCamp.body.error).toBe("Camp not found");

    const ghostPro = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, professionalId: "ghost" });
    expect(ghostPro.status).toBe(404);
    expect(ghostPro.body.error).toBe("Professional not found");
  });

  it("400 invalid type, missing / invalid scheduledAt", async () => {
    const badType = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, type: "TELEPORT" });
    expect(badType.status).toBe(400);
    expect(badType.body.error).toBe("Invalid type");

    const noDate = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, type: "CONSULTATION" });
    expect(noDate.status).toBe(400);
    expect(noDate.body.error).toBe("scheduledAt is required");

    const badDate = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, type: "CONSULTATION", scheduledAt: "yesterday-ish" });
    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toBe("scheduledAt is not a valid date");
  });

  it("DOCTOR booking auto-links its own professional record; VOLUNTEER books with explicit professionalId", async () => {
    const byDoctor = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ beneficiaryId, campId, type: "CONSULTATION", scheduledAt: new Date().toISOString() });
    expect(byDoctor.status).toBe(201);
    expect(byDoctor.body.status).toBe("SCHEDULED");
    expect(byDoctor.body.professionalId).toBe(professionalId);
    expect(byDoctor.body.createdByName).toBe(`${PREFIX} doctor`);

    const byVol = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${volunteerToken}`)
      .send({ beneficiaryId, professionalId, type: "SCREENING", scheduledAt: new Date().toISOString() });
    expect(byVol.status).toBe(201);
    expect(byVol.body.type).toBe("SCREENING");
  });
});

describe("appointments list + detail", () => {
  it("filters and scopes BENEFICIARY to its own patient record", async () => {
    const mine = await request(app).get("/api/appointments").set("Authorization", `Bearer ${benToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.items.length).toBeGreaterThan(0);
    expect(mine.body.items.every((a: { beneficiaryId: string }) => a.beneficiaryId === beneficiaryId)).toBe(true);

    const byCamp = await request(app)
      .get("/api/appointments")
      .query({ campId })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byCamp.status).toBe(200);
    expect(byCamp.body.items.every((a: { campId: string | null }) => a.campId === campId)).toBe(true);

    const byType = await request(app)
      .get("/api/appointments")
      .query({ type: "SCREENING" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byType.body.items.every((a: { type: string }) => a.type === "SCREENING")).toBe(true);
  });

  it("GET /:id — 200, 404 unknown, 403 NURSE on detail", async () => {
    const list = await request(app).get("/api/appointments").set("Authorization", `Bearer ${adminToken}`);
    const id = list.body.items[0].id;

    const one = await request(app).get(`/api/appointments/${id}`).set("Authorization", `Bearer ${volunteerToken}`);
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(id);

    const missing = await request(app).get("/api/appointments/ghost").set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Appointment not found");

    const nurse = await request(app).get(`/api/appointments/${id}`).set("Authorization", `Bearer ${nurseToken}`);
    expect(nurse.status).toBe(403);
  });
});

describe("appointments update transitions", () => {
  it("SCHEDULED → CONFIRMED → COMPLETED legal; invalid status 400", async () => {
    const created = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, type: "LAB", scheduledAt: new Date().toISOString() });
    const id = created.body.id;

    const confirm = await request(app)
      .patch(`/api/appointments/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONFIRMED" });
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe("CONFIRMED");

    const complete = await request(app)
      .patch(`/api/appointments/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "COMPLETED" });
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe("COMPLETED");

    const bad = await request(app)
      .patch(`/api/appointments/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "RESCHEDULED" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("Invalid status");
  });

  it("409 illegal move from a terminal state; NO_SHOW requires a reason", async () => {
    const created = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, type: "PHARMACY", scheduledAt: new Date().toISOString() });
    const id = created.body.id;

    const noReason = await request(app)
      .patch(`/api/appointments/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "NO_SHOW" });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe("noShowReason is required when marking a no-show");

    const noShow = await request(app)
      .patch(`/api/appointments/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "NO_SHOW", noShowReason: "Did not arrive" });
    expect(noShow.status).toBe(200);
    expect(noShow.body.noShowReason).toBe("Did not arrive");

    const reopen = await request(app)
      .patch(`/api/appointments/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONFIRMED" });
    expect(reopen.status).toBe(409);
    expect(reopen.body.error).toBe("Cannot move appointment from NO_SHOW to CONFIRMED. Allowed: none");
  });

  it("404 unknown appointment; 404 unknown professionalId in PATCH", async () => {
    const missing = await request(app)
      .patch("/api/appointments/ghost")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONFIRMED" });
    expect(missing.status).toBe(404);

    const created = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId, type: "FOLLOW_UP", scheduledAt: new Date().toISOString() });
    const badPro = await request(app)
      .patch(`/api/appointments/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ professionalId: "ghost-pro" });
    expect(badPro.status).toBe(404);
    expect(badPro.body.error).toBe("Professional not found");
  });
});

describe("appointments delete", () => {
  it("ADMIN deletes a SCHEDULED appointment; 409 once CONFIRMED; 403 DOCTOR; 404 unknown", async () => {
    const a = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId: otherBeneficiaryId, type: "CONSULTATION", scheduledAt: new Date().toISOString() });
    const deletableId = a.body.id;

    const b = await request(app)
      .post("/api/appointments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ beneficiaryId: otherBeneficiaryId, type: "CONSULTATION", scheduledAt: new Date().toISOString() });
    const confirmedId = b.body.id;
    await request(app).patch(`/api/appointments/${confirmedId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "CONFIRMED" });

    const doctor = await request(app)
      .delete(`/api/appointments/${deletableId}`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(doctor.status).toBe(403);

    const confirmed = await request(app)
      .delete(`/api/appointments/${confirmedId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(confirmed.status).toBe(409);
    expect(confirmed.body.error).toBe("Only appointments in SCHEDULED status can be deleted");

    const ok = await request(app).delete(`/api/appointments/${deletableId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);

    const gone = await request(app).delete(`/api/appointments/${deletableId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(gone.status).toBe(404);
  });
});
