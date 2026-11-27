/**
 * Health-orgs integration tests — /api/health-orgs (thin routes over
 * src/modules/health-orgs). Runs against the TEST database; only touches
 * rows created here (unique email/name prefix + direct children).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "@/infrastructure/auth/session";

const PREFIX = `ho-${Date.now()}`;
const PASSWORD = "ho-test-pass";

let app: express.Express;
let adminToken = "";
let ownerToken = ""; // HOSPITAL user that owns an org
let otherToken = ""; // HOSPITAL user without an org
let doctorToken = "";
let benToken = "";

const userIds: string[] = [];
let ownedOrgId = "";
let otherOrgId = "";
let partnerOrgId = "";

async function buildApp() {
  const { router } = await import("@/routes/health-orgs");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/health-orgs", router);
  a.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.campPartner.deleteMany({ where: { org: { name: { startsWith: PREFIX } } } });
  await db.medicalCamp.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await db.healthProfessional.deleteMany({ where: { org: { name: { startsWith: PREFIX } } } });
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
  const doctor = await mk(`${PREFIX}-doctor@test.local`, `${PREFIX} doctor`, "DOCTOR");
  const ben = await mk(`${PREFIX}-ben@test.local`, `${PREFIX} ben`, "BENEFICIARY");

  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  ownerToken = issueToken({ userId: owner.id, role: "HOSPITAL", name: owner.name, email: owner.email });
  otherToken = issueToken({ userId: other.id, role: "HOSPITAL", name: other.name, email: other.email });
  doctorToken = issueToken({ userId: doctor.id, role: "DOCTOR", name: doctor.name, email: doctor.email });
  benToken = issueToken({ userId: ben.id, role: "BENEFICIARY", name: ben.name, email: ben.email });

  const ownedOrg = await db.healthcareOrg.create({
    data: { name: `${PREFIX} owned org`, type: "HOSPITAL", ownerUserId: owner.id },
  });
  ownedOrgId = ownedOrg.id;
  const otherOrg = await db.healthcareOrg.create({
    data: { name: `${PREFIX} other org`, type: "CLINIC" },
  });
  otherOrgId = otherOrg.id;
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("health-orgs authz", () => {
  it("rejects anonymous listing with 401", async () => {
    const res = await request(app).get("/api/health-orgs");
    expect(res.status).toBe(401);
  });

  it("forbids BENEFICIARY from listing (403)", async () => {
    const res = await request(app).get("/api/health-orgs").set("Authorization", `Bearer ${benToken}`);
    expect(res.status).toBe(403);
  });

  it("forbids HOSPITAL from creating orgs (403)", async () => {
    const res = await request(app)
      .post("/api/health-orgs")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `${PREFIX} nope` });
    expect(res.status).toBe(403);
  });
});

describe("health-orgs create validation", () => {
  it("requires a name (400)", async () => {
    const res = await request(app).post("/api/health-orgs").set("Authorization", `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("name is required");
  });

  it("rejects an invalid type (400)", async () => {
    const res = await request(app)
      .post("/api/health-orgs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, type: "SPA" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid org type");
  });

  it("rejects an invalid status (400)", async () => {
    const res = await request(app)
      .post("/api/health-orgs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, status: "GOLD" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid status");
  });

  it("rejects an invalid email (400)", async () => {
    const res = await request(app)
      .post("/api/health-orgs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} x`, email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("email is not a valid address");
  });

  it("creates an org as ADMIN — starts PENDING (201)", async () => {
    const res = await request(app)
      .post("/api/health-orgs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} partner org`, type: "LAB", services: ["CBC", "X-Ray"] });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.type).toBe("LAB");
    expect(JSON.parse(res.body.services)).toEqual(["CBC", "X-Ray"]);
    partnerOrgId = res.body.id;
  });
});

describe("health-orgs list + detail scoping", () => {
  it("ADMIN sees all orgs; status filter narrows", async () => {
    const all = await request(app).get("/api/health-orgs").set("Authorization", `Bearer ${adminToken}`);
    expect(all.status).toBe(200);
    const names = all.body.items.map((o: { name: string }) => o.name);
    expect(names).toContain(`${PREFIX} owned org`);
    expect(names).toContain(`${PREFIX} other org`);
    expect(names).toContain(`${PREFIX} partner org`);

    const pending = await request(app)
      .get("/api/health-orgs")
      .query({ status: "PENDING" })
      .set("Authorization", `Bearer ${adminToken}`);
    const pendingNames = pending.body.items.map((o: { name: string }) => o.name);
    expect(pendingNames).toContain(`${PREFIX} partner org`);
    expect(pendingNames).toContain(`${PREFIX} owned org`);
    expect(pending.body.items.every((o: { status: string }) => o.status === "PENDING")).toBe(true);

    const verified = await request(app)
      .get("/api/health-orgs")
      .query({ status: "VERIFIED" })
      .set("Authorization", `Bearer ${adminToken}`);
    const verifiedNames = verified.body.items.map((o: { name: string }) => o.name);
    expect(verifiedNames).not.toContain(`${PREFIX} owned org`);
    expect(verifiedNames).not.toContain(`${PREFIX} partner org`);
  });

  it("DOCTOR gets the verified directory only (PENDING hidden)", async () => {
    const res = await request(app).get("/api/health-orgs").set("Authorization", `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
    const names = res.body.items.map((o: { name: string }) => o.name);
    expect(names).not.toContain(`${PREFIX} owned org`); // PENDING
    expect(names).not.toContain(`${PREFIX} partner org`); // PENDING
  });

  it("HOSPITAL owner sees exactly its own org", async () => {
    const res = await request(app).get("/api/health-orgs").set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(ownedOrgId);
  });

  it("GET /:id — unknown id 404, non-owner HOSPITAL 403, owner 200", async () => {
    const missing = await request(app).get(`/api/health-orgs/${otherOrgId}zzz`).set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Organisation not found");

    const forbidden = await request(app).get(`/api/health-orgs/${otherOrgId}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("You do not have permission for this action");

    const own = await request(app).get(`/api/health-orgs/${ownedOrgId}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(own.status).toBe(200);
    expect(own.body.id).toBe(ownedOrgId);
  });
});

describe("health-orgs verification workflow", () => {
  it("ADMIN verifies PENDING → VERIFIED and stamps the reviewer", async () => {
    const res = await request(app)
      .patch(`/api/health-orgs/${partnerOrgId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "VERIFIED" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("VERIFIED");
    expect(res.body.verifiedByName).toBe(`${PREFIX} admin`);
    expect(res.body.verifiedAt).toBeTruthy();
  });

  it("VERIFIED → SUSPENDED is legal, then SUSPENDED → VERIFIED reinstates", async () => {
    const suspend = await request(app)
      .patch(`/api/health-orgs/${partnerOrgId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "SUSPENDED" });
    expect(suspend.status).toBe(200);
    expect(suspend.body.status).toBe("SUSPENDED");

    const reinstate = await request(app)
      .patch(`/api/health-orgs/${partnerOrgId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "VERIFIED" });
    expect(reinstate.status).toBe(200);
    expect(reinstate.body.status).toBe("VERIFIED");
  });

  it("rejects an illegal transition with the 409 state-machine message", async () => {
    // REJECTED is terminal — create one and try to verify it.
    const org = await request(app)
      .post("/api/health-orgs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: `${PREFIX} rejected org` });
    const reject = await request(app)
      .patch(`/api/health-orgs/${org.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "REJECTED" });
    expect(reject.status).toBe(200);

    const reopen = await request(app)
      .patch(`/api/health-orgs/${org.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "VERIFIED" });
    expect(reopen.status).toBe(409);
    expect(reopen.body.error).toBe("Cannot move health org from REJECTED to VERIFIED. Allowed: none");
  });

  it("rejects an unknown status value (400)", async () => {
    const res = await request(app)
      .patch(`/api/health-orgs/${partnerOrgId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "GOLD" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid status");
  });

  it("404 on PATCH of an unknown org", async () => {
    const res = await request(app)
      .patch(`/api/health-orgs/${otherOrgId}zzz`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "nope" });
    expect(res.status).toBe(404);
  });

  it("owning HOSPITAL can edit profile but not verify; non-owner gets 403", async () => {
    const own = await request(app)
      .patch(`/api/health-orgs/${ownedOrgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `${PREFIX} owned org renamed`, status: "VERIFIED", notes: "self-edit" });
    expect(own.status).toBe(200);
    expect(own.body.name).toBe(`${PREFIX} owned org renamed`);
    expect(own.body.status).toBe("PENDING"); // status stripped — admins verify
    expect(own.body.notes).toBeNull(); // notes stripped too

    const foreign = await request(app)
      .patch(`/api/health-orgs/${otherOrgId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "hijack" });
    expect(foreign.status).toBe(403);
  });
});

describe("health-orgs delete", () => {
  it("blocks deletion while camp partnerships exist (409)", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const camp = await db.medicalCamp.create({
      data: { code: `UAR-CAMP-${PREFIX.slice(3, 9)}`, title: `${PREFIX} camp`, campDate: new Date(), venue: `${PREFIX} venue` },
    });
    await db.campPartner.create({ data: { campId: camp.id, orgId: partnerOrgId } });
    try {
      const res = await request(app)
        .delete(`/api/health-orgs/${partnerOrgId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("This organisation has camp partnerships and cannot be deleted");
    } finally {
      await db.campPartner.deleteMany({ where: { orgId: partnerOrgId } });
      await db.medicalCamp.deleteMany({ where: { id: camp.id } });
    }
  });

  it("deletes a partnership-free org, 404 afterwards, 404 on unknown, 403 for DOCTOR", async () => {
    const del = await request(app).delete(`/api/health-orgs/${otherOrgId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const gone = await request(app).get(`/api/health-orgs/${otherOrgId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(gone.status).toBe(404);

    const missing = await request(app)
      .delete(`/api/health-orgs/${otherOrgId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);

    const forbidden = await request(app)
      .delete(`/api/health-orgs/${partnerOrgId}`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(forbidden.status).toBe(403);
  });
});
