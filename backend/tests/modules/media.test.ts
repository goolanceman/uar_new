/**
 * Media module — /api/media (real router via @/routes/media). Route surface
 * of the presigned direct-upload pipeline: POST /uploads presign → PUT bytes
 * → POST /:id/complete → poll GET /:id (the transcoder worker is not running
 * here, so the asset settles at "uploaded" — shape asserted, never "ready"),
 * plus playback 404s for unknown ids. Only touches rows it creates (unique
 * email PREFIX).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { promises as fs } from "node:fs";
import path from "node:path";

const PREFIX = `media-mod-${Date.now()}`;

let app: express.Express;
let aToken = ""; // owner
let bToken = ""; // viewer
let aId = "";
let bId = "";
let storeDir = "";
const assetIds: string[] = [];

const VID = Buffer.from("00000018667479706d703432000002006d7034316d703432", "hex"); // fake mp4 bytes

async function buildApp() {
  const { router } = await import("@/routes/media");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/media", router);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.mediaAsset.deleteMany({ where: { ownerId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  // local-driver stored bytes for our assets
  for (const id of assetIds) {
    await fs.rm(path.join(storeDir, "media", id), { recursive: true, force: true }).catch(() => undefined);
  }
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { UPLOAD_DIR } = await import("@/domains/files");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");
  storeDir = path.join(UPLOAD_DIR, "media-store");

  const a = await db.user.create({
    data: {
      email: `${PREFIX}-a@test.local`,
      name: `${PREFIX} owner`,
      role: "DONOR",
      password: hashPassword("[redacted]]]"),
      status: "ACTIVE",
      isActive: true,
    },
  });
  const b = await db.user.create({
    data: {
      email: `${PREFIX}-b@test.local`,
      name: `${PREFIX} viewer`,
      role: "DONOR",
      password: hashPassword("[redacted]]]"),
      status: "ACTIVE",
      isActive: true,
    },
  });
  aId = a.id;
  bId = b.id;
  aToken = issueToken({ userId: a.id, role: a.role, name: a.name ?? "", email: a.email });
  bToken = issueToken({ userId: b.id, role: b.role, name: b.name ?? "", email: b.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/media/uploads (presign)", () => {
  it("401 without a session and rejects bad purpose/mime/size", async () => {
    const noAuth = await request(app).post("/api/media/uploads").send({ purpose: "reel", contentType: "video/mp4", size: 10 });
    expect(noAuth.status).toBe(401);

    const badPurpose = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "story", contentType: "video/mp4", size: 10 });
    expect(badPurpose.status).toBe(400);
    expect(badPurpose.body.error).toBe("purpose must be reel or post");

    const badMime = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/x-flv", size: 10 });
    expect(badMime.status).toBe(400);

    const badSize = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/mp4", size: 0 });
    expect(badSize.status).toBe(400);
  });

  it("returns a signed local PUT url with headers and expiry", async () => {
    const res = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "post", contentType: "video/mp4", size: VID.length });
    expect(res.status).toBe(201);
    expect(res.body.mediaId).toBeTruthy();
    expect(res.body.upload.method).toBe("PUT");
    expect(res.body.upload.url).toContain("/api/media/upload/");
    expect(res.body.upload.headers["Content-Type"]).toBe("video/mp4");
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    assetIds.push(res.body.mediaId);
  });
});

describe("PUT /api/media/upload/:token (local receiver)", () => {
  it("rejects a tampered token", async () => {
    const presign = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/mp4", size: VID.length });
    assetIds.push(presign.body.mediaId);

    const tampered = await request(app)
      .put(`${presign.body.upload.url}x`)
      .set("Content-Type", "video/mp4")
      .send(VID);
    expect(tampered.status).toBe(400);
  });

  it("accepts the exact bytes (200) and lands them in the store", async () => {
    const presign = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/mp4", size: VID.length });
    expect(presign.status).toBe(201);
    assetIds.push(presign.body.mediaId);

    const put = await request(app)
      .put(presign.body.upload.url)
      .set("Content-Type", "video/mp4")
      .send(VID);
    expect(put.status).toBe(200);

    const stored = await fs
      .readFile(path.join(storeDir, "media", presign.body.mediaId, "source.mp4"))
      .catch(() => null);
    expect(stored).toBeTruthy();
  });
});

describe("POST /api/media/:id/complete + GET /api/media/:id (poll)", () => {
  it("refuses completion before the bytes exist", async () => {
    const presign = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/mp4", size: VID.length });
    assetIds.push(presign.body.mediaId);

    const res = await request(app).post(`/api/media/${presign.body.mediaId}/complete`).set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Upload has not reached the storage yet");
  });

  it("completes an uploaded asset and keeps the worker-less status non-ready", async () => {
    const presign = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/mp4", size: VID.length });
    assetIds.push(presign.body.mediaId);
    await request(app).put(presign.body.upload.url).set("Content-Type", "video/mp4").send(VID);

    const complete = await request(app)
      .post(`/api/media/${presign.body.mediaId}/complete`)
      .set("Authorization", `Bearer ${aToken}`);
    expect(complete.status).toBe(200);
    expect(complete.body.id).toBe(presign.body.mediaId);
    expect(complete.body.status).toBe("uploaded"); // worker never runs in tests
    expect(complete.body.hlsUrl).toBeNull();

    const poll = await request(app).get(`/api/media/${presign.body.mediaId}`).set("Authorization", `Bearer ${aToken}`);
    expect(poll.status).toBe(200);
    expect(poll.body.id).toBe(presign.body.mediaId);
    expect(poll.body.status).not.toBe("ready");

    const again = await request(app)
      .post(`/api/media/${presign.body.mediaId}/complete`)
      .set("Authorization", `Bearer ${aToken}`);
    expect(again.status).toBe(200); // idempotent
  });

  it("403s a non-owner poll and 404s an unknown asset", async () => {
    const [asset] = await dbAssets();
    const foreign = await request(app).get(`/api/media/${asset.id}`).set("Authorization", `Bearer ${bToken}`);
    expect(foreign.status).toBe(403);

    const missing = await request(app).get("/api/media/does-not-exist").set("Authorization", `Bearer ${aToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Media asset not found");
  });
});

describe("GET /api/media/files/* (public playback)", () => {
  it("404s unknown ids, non-ready outputs and the raw source", async () => {
    const unknown = await request(app).get("/api/media/files/media/does-not-exist/hls/index.m3u8");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("Not found");

    const [asset] = await dbAssets();
    const notReady = await request(app).get(`/api/media/files/media/${asset.id}/hls/index.m3u8`);
    expect(notReady.status).toBe(404); // asset exists but is not ready

    const source = await request(app).get(`/api/media/files/media/${asset.id}/source.mp4`);
    expect(source.status).toBe(404); // never serve the raw source
  });
});

/** latest media asset owned by the test users */
async function dbAssets() {
  const { db } = await import("@/infrastructure/database/prisma");
  return db.mediaAsset.findMany({
    where: { owner: { email: { startsWith: PREFIX } } },
    orderBy: { createdAt: "desc" as const },
  });
}
