/**
 * Realtime module — /api/realtime (real router via @/routes/realtime).
 * POST /auth signs Pusher private-channel authorizations with per-type
 * authorization (member vs outsider 403); POST /agora-token mints Agora RTC
 * tokens — AGORA_APP_ID is unset in the test env, so the documented failure
 * shape ({error: "Agora is not configured"}, 500) is asserted instead of a
 * token. Only touches rows it creates (unique email PREFIX).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `realtime-${Date.now()}`;

let app: express.Express;
let aToken = ""; // conversation member + space participant
let bToken = ""; // second space participant
let outsiderToken = "";
let aId = "";
let bId = "";
let convId = "";
let spaceId = ""; // space where a IS a participant

async function buildApp() {
  const { router } = await import("@/routes/realtime");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  // form-urlencoded bodies from the Flutter PusherChannelAuthorizer are
  // parsed app-wide — the bare harness needs the parser explicitly.
  a.use(express.urlencoded({ extended: true }));
  a.use("/api/realtime", router);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.audioSpace.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  // conversations cascade with their users (user1/user2 + participants)
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");

  const mk = (email: string, name: string) =>
    db.user.create({
      data: {
        email,
        name,
        role: "DONOR",
        password: hashPassword("[redacted]]]"),
        status: "ACTIVE",
        isActive: true,
      },
    });

  const a = await mk(`${PREFIX}-a@test.local`, `${PREFIX} a`);
  const b = await mk(`${PREFIX}-b@test.local`, `${PREFIX} b`);
  const o = await mk(`${PREFIX}-o@test.local`, `${PREFIX} outsider`);
  aId = a.id;
  bId = b.id;

  const tok = (u: { id: string; role: string; name: string | null; email: string }) =>
    issueToken({ userId: u.id, role: u.role, name: u.name ?? "", email: u.email });
  aToken = tok(a);
  bToken = tok(b);
  outsiderToken = tok(o);

  // 1:1 conversation a ↔ b (direct type 1 — access = being one of the pair)
  const conv = await db.conversation.create({
    data: { type: 1, user1Id: aId, user2Id: bId },
  });
  convId = conv.id;

  // audio space where a and b are participants
  spaceId = `${PREFIX}-space`;
  const space = await db.audioSpace.create({ data: { id: spaceId, title: `${PREFIX} space`, type: "private" } });
  await db.audioSpaceParticipant.create({ data: { audioSpaceId: space.id, userId: aId, type: "host" } });
  await db.audioSpaceParticipant.create({ data: { audioSpaceId: space.id, userId: bId, type: "listener" } });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/realtime/auth (Pusher channel authorization)", () => {
  it("401s missing fields and a bad session with the exact Pusher-contract bodies", async () => {
    const noFields = await request(app).post("/api/realtime/auth").send({});
    expect(noFields.status).toBe(401);
    expect(noFields.body.error).toBe("Invalid auth request");

    const badToken = await request(app)
      .post("/api/realtime/auth")
      .set("Authorization", "Bearer garbage")
      .send({ socket_id: "1.1", channel_name: "private-user.abc" });
    expect(badToken.status).toBe(401);
    expect(badToken.body.error).toBe("Invalid or expired token");
  });

  it("signs a member's conversation channel but 403s an outsider", async () => {
    const member = await request(app)
      .post("/api/realtime/auth")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ socket_id: "100.abc", channel_name: `private-conversation.${convId}` });
    expect(member.status).toBe(200);
    expect(member.body.auth).toBeTruthy();
    expect(String(member.body.auth)).toContain(":"); // "<appKey>:<hmac>"

    const stranger = await request(app)
      .post("/api/realtime/auth")
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ socket_id: "100.abc", channel_name: `private-conversation.${convId}` });
    expect(stranger.status).toBe(403);
    expect(stranger.body.error).toBe("Channel access denied");
  });

  it("signs only a user's OWN user-scoped channel", async () => {
    const own = await request(app)
      .post("/api/realtime/auth")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ socket_id: "100.abc", channel_name: `private-user.${aId}` });
    expect(own.status).toBe(200);

    const foreign = await request(app)
      .post("/api/realtime/auth")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ socket_id: "100.abc", channel_name: `private-user.${bId}` });
    expect(foreign.status).toBe(403);
  });

  it("accepts urlencoded bodies and denies unknown private patterns", async () => {
    const form = await request(app)
      .post("/api/realtime/auth")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send(`socket_id=100.abc&channel_name=private-audio-space.${spaceId}`);
    expect(form.status).toBe(200); // a is a participant of the private space
    expect(form.body.auth).toBeTruthy();

    const unknown = await request(app)
      .post("/api/realtime/auth")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ socket_id: "100.abc", channel_name: "private-somethingelse.42" });
    expect(unknown.status).toBe(403);
  });
});

describe("POST /api/realtime/agora-token", () => {
  it("401 without a session, 400 without a channelName", async () => {
    const noAuth = await request(app).post("/api/realtime/agora-token").send({ channelName: "x" });
    expect(noAuth.status).toBe(401);

    const noChannel = await request(app)
      .post("/api/realtime/agora-token")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ channelName: "" });
    expect(noChannel.status).toBe(400);
    expect(noChannel.body.error).toContain("The channel name field is required");
  });

  it("403s a non-participant of a channel mapped to an audio space", async () => {
    const res = await request(app)
      .post("/api/realtime/agora-token")
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ channelName: spaceId });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You are not a participant of this audio space");
  });

  it("reports the documented failure shape for a participant (Agora unconfigured)", async () => {
    const res = await request(app)
      .post("/api/realtime/agora-token")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ channelName: spaceId });
    if (process.env.AGORA_APP_ID && process.env.AGORA_APP_CERT) {
      expect(res.status).toBe(200);
      expect(typeof res.body.token).toBe("string");
    } else {
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Agora is not configured");
    }
  });
});
