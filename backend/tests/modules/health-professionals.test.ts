/**
 * Health-professionals integration tests — /api/health-professionals
 * (thin routes over src/modules/health-professionals). Runs against the TEST
 * database; only touches rows created here (unique name/email prefix).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `hp-${Date.now()}`;
const PASSWORD = "hp-test-pass";

let app: express.Express;
let adminToken = "";
let ownerToken = "";
let otherToken = "";

const userIds: string[] = [];
let ownedOrgId = "";
let foreignOrgId = "";

async function buildApp() {
  const { router } = await import("@/routes/health-professionals");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/health-professionals", router);
  a.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.healthProfessional.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await db.healthcareOrg.deleteMany({ where: { name: { startsWith: PREFIX } } });
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
  const owner = await mk(`${PREFIX}-owner@test.local`, `${PREFIX} owner`, "HOSPITAL");
  const other = await mk(`${PREFIX}-other@test.local`, `${PREFIX} other`, "HOSPITAL");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  ownerToken = issueToken({ userId: owner.id, role: "HOSPITAL", name: owner.name, email: owner.email });
  otherToken = issueToken({ userId: other.id, role: "HOSPITAL", name: other.name, email: other.email });

  const ownedOrg = await db.healthcareOrg.create({
    data: { name: `${PREFIX} owned org`, type: "HOSPITAL", ownerUserId: owner.id },
  });
  ownedOrgId = ownedOrg.id;
  const foreignOrg = await db.healthcareOrg.create({ data: { name: `${PREFIX} foreign org` } });
  foreignOrgId = foreignOrg.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("health-professionals create", () => {
  it("401 anonymous / 403 non-staff roles stay out via route gate", async () => {
    const anon = await request(app).get("/api/health-professionals");
    expect(anon.status).toBe(401);
  });

  it("requires a name (400)", async () => {
    const res = await request(app).post("/api/health-professionals").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("name is required");
  });

  it("rejects an invalid kind (400)", async () => {
    const res = await request(app)
      .post("/api/health-professionals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} pro`, kind: "WIZARD" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid kind");
  });

  it("rejects an unknown orgId with 404", async () => {
    const res = await request(app)
      .post("/api/health-professionals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} pro`, orgId: "nope" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Organisation not found");
  });

  it("rejects an invalid email (400)", async () => {
    const res = await request(app)
      .post("/api/health-professionals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} pro`, email: "bogus" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("email is not a valid address");
  });

  it("rejects a negative experienceYears (400)", async () => {
    const res = await request(app)
      .post("/api/health-professionals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} pro`, experienceYears: -3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("experienceYears must be 0 or more");
  });

  it("ADMIN creates a professional — starts PENDING (201)", async () => {
    const res = await request(app)
      .post("/api/health-professionals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} dr alice`, kind: "DOCTOR", orgId: ownedOrgId, speciality: "Cardiology", experienceYears: 7 });
    expect(res.status).toBe(201);
    expect(res.body.verificationStatus).toBe("PENDING");
    expect(res.body.orgId).toBe(ownedOrgId);
    expect(res.body.experienceYears).toBe(7);
  });

  it("HOSPITAL creates within its own org (orgId forced) and 403 without an org", async () => {
    const own = await request(app)
      .post("/api/health-professionals")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `${PREFIX} nurse own`, kind: "NURSE", orgId: foreignOrgId });
    expect(own.status).toBe(201);
    expect(own.body.orgId).toBe(ownedOrgId); // forced to the owner's org

    const noOrg = await request(app)
      .post("/api/health-professionals")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ name: `${PREFIX} nurse x` });
    expect(noOrg.status).toBe(403);
    expect(noOrg.body.error).toBe("Your account is not linked to an organisation");
  });
});

describe("health-professionals list + detail", () => {
  it("ADMIN lists all and filters by verificationStatus", async () => {
    const all = await request(app).get("/api/health-professionals").set("Authorization", `Bearer ${adminToken}`);
    expect(all.status).toBe(200);
    const names = all.body.items.map((p: { name: string }) => p.name);
    expect(names).toContain(`${PREFIX} dr alice`);
    expect(all.body.total).toBeGreaterThanOrEqual(2);

    const pending = await request(app)
      .get("/api/health-professionals")
      .query({ verificationStatus: "PENDING" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(pending.body.items.every((p: { verificationStatus: string }) => p.verificationStatus === "PENDING")).toBe(true);
  });

  it("HOSPITAL is scoped to its own org only", async () => {
    const res = await request(app).get("/api/health-professionals").set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.every((p: { orgId: string | null }) => p.orgId === ownedOrgId)).toBe(true);
  });

  it("GET /:id — 404 unknown, 403 non-owner HOSPITAL, 200 owner", async () => {
    const missing = await request(app)
      .get("/api/health-professionals/does-not-exist")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Professional not found");

    const list = await request(app)
      .get("/api/health-professionals")
      .query({ q: `${PREFIX} dr alice` })
      .set("Authorization", `Bearer ${adminToken}`);
    const proId = list.body.items[0].id;

    const foreign = await request(app)
      .get(`/api/health-professionals/${proId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("You do not have permission for this action");

    const own = await request(app)
      .get(`/api/health-professionals/${proId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(own.status).toBe(200);
    expect(own.body.id).toBe(proId);
  });
});

describe("health-professionals verification (ADMIN gate)", () => {
  it("ADMIN verifies PENDING → VERIFIED, stamps reviewer; VERIFIED → REJECTED is 409", async () => {
    const created = await request(app)
      .post("/api/health-professionals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} verify me`, kind: "DOCTOR" });
    const proId = created.body.id;

    const verify = await request(app)
      .patch(`/api/health-professionals/${proId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ verificationStatus: "VERIFIED" });
    expect(verify.status).toBe(200);
    expect(verify.body.verificationStatus).toBe("VERIFIED");
    expect(verify.body.verifiedByName).toBe(`${PREFIX} admin`);
    expect(verify.body.verifiedAt).toBeTruthy();

    const again = await request(app)
      .patch(`/api/health-professionals/${proId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ verificationStatus: "REJECTED" });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("Cannot move professional verification from VERIFIED to REJECTED");
  });

  it("rejects an unknown verificationStatus value (400)", async () => {
    const created = await request(app)
      .post("/api/health-professionals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} bogus status` });
    const res = await request(app)
      .patch(`/api/health-professionals/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ verificationStatus: "GOLD" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid verificationStatus");
  });

  it("HOSPITAL owner can edit profile fields but cannot verify (403)", async () => {
    const created = await request(app)
      .post("/api/health-professionals")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `${PREFIX} org nurse` });
    const proId = created.body.id;

    const edit = await request(app)
      .patch(`/api/health-professionals/${proId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ speciality: "Elderly care", active: false });
    expect(edit.status).toBe(200);
    expect(edit.body.speciality).toBe("Elderly care");
    expect(edit.body.active).toBe(false);

    const verify = await request(app)
      .patch(`/api/health-professionals/${proId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ verificationStatus: "VERIFIED" });
    expect(verify.status).toBe(403);
    expect(verify.body.error).toBe("Only an administrator can verify a professional");
  });

  it("non-owner HOSPITAL gets 403; unknown id 404; unknown orgId on PATCH 404", async () => {
    const created = await request(app)
      .post("/api/health-professionals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} guarded pro`, orgId: ownedOrgId });
    const proId = created.body.id;

    const foreign = await request(app)
      .patch(`/api/health-professionals/${proId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ name: "hijack" });
    expect(foreign.status).toBe(403);

    const missing = await request(app)
      .patch("/api/health-professionals/no-such-pro")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "x" });
    expect(missing.status).toBe(404);

    const badOrg = await request(app)
      .patch(`/api/health-professionals/${proId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orgId: "ghost-org" });
    expect(badOrg.status).toBe(404);
    expect(badOrg.body.error).toBe("Organisation not found");
  });
});
