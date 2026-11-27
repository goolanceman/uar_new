/**
 * Screenings integration tests — /api/screenings (thin routes over
 * src/modules/screenings). Role gates, schema validation, 404 lookups.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `scr-${Date.now()}`;
const PASSWORD = "scr-test-pass";

let app: express.Express;
let adminToken = "";
let nurseToken = "";
let benToken = "";
let volunteerToken = "";

const userIds: string[] = [];
let beneficiaryId = "";
let campId = "";
let encounterId = "";

async function buildApp() {
  const { router } = await import("@/routes/screenings");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/screenings", router);
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
    await db.screeningRecord.deleteMany({ where: { beneficiaryId: { in: benIds } } });
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
  const volunteer = await mk(`${PREFIX}-vol@test.local`, `${PREFIX} vol`, "VOLUNTEER");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  nurseToken = issueToken({ userId: nurse.id, role: "NURSE", name: nurse.name, email: nurse.email });
  benToken = issueToken({ userId: ben.id, role: "BENEFICIARY", name: ben.name, email: ben.email });
  volunteerToken = issueToken({ userId: volunteer.id, role: "VOLUNTEER", name: volunteer.name, email: volunteer.email });

  const professional = await db.healthProfessional.create({
    data: { name: `${PREFIX} dr scr`, kind: "DOCTOR" },
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

describe("screenings list", () => {
  it("401 anonymous; 403 VOLUNTEER/BENEFICIARY", async () => {
    const anon = await request(app).get("/api/screenings");
    expect(anon.status).toBe(401);

    const vol = await request(app).get("/api/screenings").set("Authorization", `Bearer ${volunteerToken}`);
    expect(vol.status).toBe(403);

    const ben = await request(app).get("/api/screenings").set("Authorization", `Bearer ${benToken}`);
    expect(ben.status).toBe(403);
  });

  it("ADMIN list envelope + filters", async () => {
    const all = await request(app).get("/api/screenings").set("Authorization", `Bearer ${adminToken}`);
    expect(all.status).toBe(200);
    expect(typeof all.body.total).toBe("number");
    expect(Array.isArray(all.body.items)).toBe(true);
  });
});

describe("screenings create", () => {
  it("400 schema-level: missing beneficiaryId, missing result, unknown type", async () => {
    const noBen = await request(app).post("/api/screenings").set("Authorization", `Bearer ${nurseToken}`).send({});
    expect(noBen.status).toBe(400);
    expect(noBen.body.error).toContain("beneficiaryId is required");

    const noResult = await request(app)
      .post("/api/screenings")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId });
    expect(noResult.status).toBe(400);
    expect(noResult.body.error).toContain("result:"); // absent result is rejected at the schema layer

    const badType = await request(app)
      .post("/api/screenings")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId, result: "ok", type: "TELEPATHY" });
    expect(badType.status).toBe(400);
    expect(badType.body.error).toContain("type must be one of:");
  });

  it("404 unknown beneficiary/camp/encounter", async () => {
    const ghostBen = await request(app)
      .post("/api/screenings")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId: "ghost", result: "clear" });
    expect(ghostBen.status).toBe(404);
    expect(ghostBen.body.error).toBe("Beneficiary not found");

    const ghostCamp = await request(app)
      .post("/api/screenings")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId, result: "clear", campId: "ghost" });
    expect(ghostCamp.status).toBe(404);
    expect(ghostCamp.body.error).toBe("Camp not found");

    const ghostEnc = await request(app)
      .post("/api/screenings")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId, result: "clear", encounterId: "ghost" });
    expect(ghostEnc.status).toBe(404);
    expect(ghostEnc.body.error).toBe("Encounter not found");
  });

  it("NURSE records a screening with type + abnormal flag (201)", async () => {
    const res = await request(app)
      .post("/api/screenings")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ beneficiaryId, campId, encounterId, type: "EYE", result: "Reduced vision", abnormal: true });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("EYE");
    expect(res.body.abnormal).toBe(true);
    expect(res.body.recordedByName).toBe(`${PREFIX} nurse`);
    expect(res.body.beneficiaryId).toBe(beneficiaryId);
  });

  it("filters: ?beneficiaryId + ?abnormal=1 narrow the list", async () => {
    const filtered = await request(app)
      .get("/api/screenings")
      .query({ beneficiaryId, abnormal: "1" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBeGreaterThanOrEqual(1);
    expect(filtered.body.items.every((s: { abnormal: boolean }) => s.abnormal === true)).toBe(true);
  });
});
