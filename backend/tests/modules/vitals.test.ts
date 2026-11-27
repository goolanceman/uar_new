/**
 * Vitals integration tests — /api/vitals (thin routes over src/modules/vitals).
 * Role gates, physiological range validation, BMI computation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `vit-${Date.now()}`;
const PASSWORD = "vit-test-pass";

let app: express.Express;
let adminToken = "";
let nurseToken = "";
let benToken = "";

const userIds: string[] = [];
let beneficiaryId = "";
let campId = "";
let encounterId = "";

async function buildApp() {
  const { router } = await import("@/routes/vitals");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/vitals", router);
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
    await db.vitalObservation.deleteMany({ where: { beneficiaryId: { in: benIds } } });
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
  const nurse = await mk(`${PREFIX}-nurse@test.local`, `${PREFIX} nurse`, "NURSE");
  const ben = await mk(`${PREFIX}-ben@test.local`, `${PREFIX} ben`, "BENEFICIARY");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
  benToken = issueToken({ userId: ben.id, role: "BENEFICIARY", name: ben.name, email: ben.email });

  const professional = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr vit`, kind: "DOCTOR" },
  });
  const beneficiary = await db.beneficiary.create({
    data: { code: `UAR-BEN-${PREFIX.slice(4, 11)}`, name: `${PREFIX} patient` },
  });
  beneficiaryId = beneficiary.id;
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

describe("vitals list", () => {
  it("401 anonymous; 403 BENEFICIARY (staff roles only)", async () => {
    const anon = await request(app).get("/api/vitals");
    expect(anon.status).toBe(401);

    const ben = await request(app).get("/api/vitals").set("Authorization", `Bearer ${benToken}`);
    expect(ben.status).toBe(403);
  });

  it("ADMIN list envelope with beneficiaryId filter", async () => {
    const res = await request(app)
      .get("/api/vitals")
      .query({ beneficiaryId })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe("number");
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describe("vitals create", () => {
  it("400 schema-level: missing beneficiaryId, out-of-range bpSystolic, non-numeric tempC", async () => {
    const noBen = await request(app).post("/api/vitals").set("Authorization", `Bearer ${nurseToken}`).send({});
    expect(noBen.status).toBe(400);
    expect(noBen.body.error).toContain("beneficiaryId is required");

    const badBp = await request(app)
      .post("/api/vitals")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId, bpSystolic: 999 });
    expect(badBp.status).toBe(400);
    expect(badBp.body.error).toContain("bpSystolic must be between 50 and 300");

    const badTemp = await request(app)
      .post("/api/vitals")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId, tempC: "warm" });
    expect(badTemp.status).toBe(400);
    expect(badTemp.body.error).toContain("tempC must be a number");
  });

  it("404 unknown beneficiary/camp/encounter", async () => {
    const ghostBen = await request(app)
      .post("/api/vitals")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId: "ghost", pulse: 70 });
    expect(ghostBen.status).toBe(404);
    expect(ghostBen.body.error).toBe("Beneficiary not found");

    const ghostCamp = await request(app)
      .post("/api/vitals")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId, pulse: 70, campId: "ghost" });
    expect(ghostCamp.status).toBe(404);
    expect(ghostCamp.body.error).toBe("Camp not found");

    const ghostEnc = await request(app)
      .post("/api/vitals")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId, pulse: 70, encounterId: "ghost" });
    expect(ghostEnc.status).toBe(404);
    expect(ghostEnc.body.error).toBe("Encounter not found");
  });

  it("NURSE records vitals; BMI computed from height + weight (kg/m², 1 decimal)", async () => {
    const res = await request(app)
      .post("/api/vitals")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({
        beneficiaryId,
        campId,
        encounterId,
        bpSystolic: 120.4, // rounded to int
        bpDiastolic: 80,
        pulse: 72,
        tempC: 37.2,
        spo2: 98,
        heightCm: 170,
        weightKg: 65.5,
        glucose: 92,
      });
    expect(res.status).toBe(201);
    expect(res.body.bpSystolic).toBe(120);
    expect(res.body.bpDiastolic).toBe(80);
    expect(res.body.heightCm).toBe(170);
    // 65.5 / 1.7² = 22.66 → 22.7
    expect(res.body.bmi).toBeCloseTo(22.7, 1);
    expect(res.body.recordedByName).toBe(`${PREFIX} nurse`);

    const list = await request(app)
      .get("/api/vitals")
      .query({ beneficiaryId })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
  });
});
