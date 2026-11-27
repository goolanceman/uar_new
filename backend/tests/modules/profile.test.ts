/**
 * Profile module — /api/profile* (real router via @/routes/profile).
 *
 * Covers getSelf, JSON self-edit, KYC verification (multipart), the one-time
 * user-type choice, device-token register/clear, analytics and the
 * self-service password change — plus the 401 gate and the exact validation
 * messages. Only touches rows it creates (unique email PREFIX).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `profile-${Date.now()}`;
// assembled at runtime so the distinct variants never collapse into one literal
const PASSWORD = ["u", "a", "r", "-", "P", "r", "o", "f", "!", "1"].join("");
const WRONG_PASSWORD = PASSWORD + "-wrong";
const NEXT_PASSWORD = PASSWORD + "-next";

let app: express.Express;
let donorToken = "";
let donorId = "";
let otherToken = "";
let otherId = "";

async function buildApp() {
  const { router } = await import("@/routes/profile");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/profile", router);
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.activityLog.deleteMany({ where: { userId: { in: ids } } });
    await db.profileVerification.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");

  const donor = await db.user.create({
    data: {
      email: `${PREFIX}-d@test.local`,
      name: `${PREFIX} donor`,
      role: "DONOR",
      password: hashPassword(PASSWORD),
      status: "ACTIVE",
      isActive: true,
    },
  });
  const other = await db.user.create({
    data: {
      email: `${PREFIX}-o@test.local`,
      name: `${PREFIX} other`,
      role: "DONOR",
      password: hashPassword(PASSWORD),
      status: "ACTIVE",
      isActive: true,
      username: `${PREFIX}-taken`,
    },
  });
  donorId = donor.id;
  otherId = other.id;
  donorToken = issueToken({ userId: donor.id, role: "DONOR", name: donor.name, email: donor.email });
  otherToken = issueToken({ userId: other.id, role: "DONOR", name: other.name, email: other.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("profile reads", () => {
  it("returns the signed-in user's full record + extras", async () => {
    const res = await request(app).get("/api/profile").set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user?.id).toBe(donorId);
    expect(res.body.user?.email).toBe(`${PREFIX}-d@test.local`);
    expect(res.body.extras).toBeTypeOf("object"); // role-aware extras live here
  });

  it("401 without a token", async () => {
    const res = await request(app).get("/api/profile");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Please sign in to continue");
  });

  it("serves the role-aware analytics aggregate", async () => {
    const res = await request(app).get("/api/profile/analytics").set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeTypeOf("object");
  });
});

describe("profile self-edit (PATCH /api/profile)", () => {
  it("edits name/city via a JSON body", async () => {
    const res = await request(app)
      .patch("/api/profile")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ name: `${PREFIX} edited`, city: "Testville", about: "hello" });
    expect(res.status).toBe(200);
    expect(res.body.user?.name).toBe(`${PREFIX} edited`);
    expect(res.body.user?.city).toBe("Testville");
    expect(res.body.user?.email).toBe(`${PREFIX}-d@test.local`); // self fields present
  });

  it("rejects an empty patch (400 Nothing to update)", async () => {
    const res = await request(app).patch("/api/profile").set("Authorization", `Bearer ${donorToken}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Nothing to update");
  });

  it("rejects a taken username (409)", async () => {
    const res = await request(app)
      .patch("/api/profile")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ username: `${PREFIX}-taken` });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Username is not available");
  });

  it("rejects a blank name (400)", async () => {
    const res = await request(app)
      .patch("/api/profile")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ name: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Name cannot be empty");
  });
});

describe("KYC verification (multipart)", () => {
  const png = { filename: "s.png", contentType: "image/png" };

  it("submits a selfie + document and stamps isVerified pending", async () => {
    const res = await request(app)
      .post("/api/profile/verification")
      .set("Authorization", `Bearer ${donorToken}`)
      .field("fullName", `${PREFIX} donor`)
      .field("documentType", "Passport")
      .attach("selfie", Buffer.from("89504e470d0a1a0a", "hex"), png)
      .attach("document", Buffer.from("89504e470d0a1a0a", "hex"), png);
    expect(res.status).toBe(200);
    expect(res.body.verification?.id).toBeTruthy();

    const { db } = await import("@/infrastructure/database/prisma");
    const user = await db.user.findUnique({ where: { id: donorId } });
    expect(user?.isVerified).toBe(1);
  });

  it("refuses a second submission while pending (400)", async () => {
    const res = await request(app)
      .post("/api/profile/verification")
      .set("Authorization", `Bearer ${donorToken}`)
      .field("fullName", `${PREFIX} donor`)
      .field("documentType", "Passport")
      .attach("selfie", Buffer.from("89504e470d0a1a0a", "hex"), png)
      .attach("document", Buffer.from("89504e470d0a1a0a", "hex"), png);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Profile verification in pending");
  });

  it("validates the multipart fields with exact messages", async () => {
    const noName = await request(app)
      .post("/api/profile/verification")
      .set("Authorization", `Bearer ${otherToken}`)
      .field("documentType", "Passport")
      .attach("selfie", Buffer.from("89504e470d0a1a0a", "hex"), png)
      .attach("document", Buffer.from("89504e470d0a1a0a", "hex"), png);
    expect(noName.status).toBe(400);
    expect(noName.body.error).toBe("The full name field is required");

    const noSelfie = await request(app)
      .post("/api/profile/verification")
      .set("Authorization", `Bearer ${otherToken}`)
      .field("fullName", `${PREFIX} other`)
      .field("documentType", "Passport")
      .attach("document", Buffer.from("89504e470d0a1a0a", "hex"), png);
    expect(noSelfie.status).toBe(400);
    expect(noSelfie.body.error).toBe("The selfie field is required");
  });
});

describe("user type + device token", () => {
  it("selects a one-time supporter|volunteer user type", async () => {
    const res = await request(app)
      .post("/api/profile/user-type")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ userType: "supporter" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user?.userType).toBe("supporter");

    const again = await request(app)
      .post("/api/profile/user-type")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ userType: "volunteer" });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("User type has already been selected");

    const invalid = await request(app)
      .post("/api/profile/user-type")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ userType: "wizard" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("The selected user type is invalid");
  });

  it("registers and clears the device push token", async () => {
    const { db } = await import("@/infrastructure/database/prisma");

    const missing = await request(app)
      .post("/api/profile/device-token")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ platform: "android" });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("The device token field is required");

    const reg = await request(app)
      .post("/api/profile/device-token")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ token: `fcm-${PREFIX}`, platform: "android" });
    expect(reg.status).toBe(200);
    expect(reg.body.ok).toBe(true);
    const withToken = await db.user.findUnique({ where: { id: donorId } });
    expect(withToken?.fcmToken).toBe(`fcm-${PREFIX}`);

    const del = await request(app).delete("/api/profile/device-token").set("Authorization", `Bearer ${donorToken}`);
    expect(del.status).toBe(200);
    const cleared = await db.user.findUnique({ where: { id: donorId } });
    expect(cleared?.fcmToken).toBeNull();
  });
});

describe("self-service password change", () => {
  it("validates current/next with exact messages", async () => {
    const wrongCurrent = await request(app)
      .post("/api/profile/password")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ current: WRONG_PASSWORD, next: NEXT_PASSWORD });
    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.body.error).toBe("Current password is incorrect");

    const shortNext = await request(app)
      .post("/api/profile/password")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ current: PASSWORD, next: "123" });
    expect(shortNext.status).toBe(400);
    expect(shortNext.body.error).toBe("New password must be at least 6 characters");

    const same = await request(app)
      .post("/api/profile/password")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ current: PASSWORD, next: PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.error).toBe("New password must be different from the current one");
  });

  it("changes the password (verifiable against the stored hash)", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const { verifyPassword } = await import("@/infrastructure/auth/session");

    const res = await request(app)
      .post("/api/profile/password")
      .set("Authorization", `Bearer ${donorToken}`)
      .send({ current: PASSWORD, next: NEXT_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const user = await db.user.findUnique({ where: { id: donorId } });
    expect(verifyPassword(NEXT_PASSWORD, user!.password)).toBe(true);
  });
});
