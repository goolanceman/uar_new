/**
 * Media pipeline — presigned direct video uploads (local driver), the signed
 * PUT receiver, complete/poll endpoints, reel + post hydration/visibility and
 * public playback serving with HTTP Range support. Follows the community test
 * pattern: TEST database, only rows it creates (unique email prefix).
 *
 * The end-to-end transcode test runs only when ffmpeg/ffprobe are available
 * (it.skipIf) — it generates a 2s clip with lavfi, uploads it through the
 * presigned flow and asserts the HLS ladder + MP4 + poster outputs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { promises as fs } from "node:fs";
import { statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const PREFIX = `media-${Date.now()}`;
const PASSWORD = ["media", "test", "pass"].join("-");

let app: express.Express;
let aToken = ""; // media owner (uploads + attaches)
let bToken = ""; // viewer
let cToken = ""; // second owner (cross-user checks)
let aId = "";
let bId = "";
let cId = "";
let storeDir = "";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const hasFfmpeg =
  spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;

async function buildApp() {
  const [{ router: mediaRouter }, { router: reelsRouter }, { router: postsRouter }, { router: filesRouter }] =
    await Promise.all([
      import("@/routes/media"),
      import("@/routes/reels"),
      import("@/routes/posts"),
      import("@/routes/files"),
    ]);
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/media", mediaRouter);
  a.use("/api/reels", reelsRouter);
  a.use("/api/posts", postsRouter);
  a.use("/api/files", filesRouter);
  return a;
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    const reels = await db.communityReel.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    const reelIds = reels.map((r) => r.id);
    if (reelIds.length) {
      await db.savedNotification.deleteMany({ where: { OR: [{ reelId: { in: reelIds } }, { myUserId: { in: ids } }, { userId: { in: ids } }] } });
      await db.communityReelComment.deleteMany({ where: { reelId: { in: reelIds } } });
      await db.communityLike.deleteMany({ where: { reelId: { in: reelIds } } });
      await db.communityReport.deleteMany({ where: { OR: [{ reelId: { in: reelIds } }, { postId: { in: reelIds } }] } });
      await db.communityReel.deleteMany({ where: { id: { in: reelIds } } });
    }
    const posts = await db.communityPost.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    if (posts.length) {
      await db.savedNotification.deleteMany({ where: { postId: { in: posts.map((p) => p.id) } } });
      await db.communityPost.deleteMany({ where: { id: { in: posts.map((p) => p.id) } } });
    }
    await db.mediaAsset.deleteMany({ where: { ownerId: { in: ids } } });
    await db.notification.deleteMany({ where: { userId: { in: ids } } });
    await db.userFollow.deleteMany({ where: { OR: [{ myUserId: { in: ids } }, { userId: { in: ids } }] } });
    const assets = await db.fileAsset.findMany({ where: { uploadedByName: { startsWith: PREFIX } }, select: { storedName: true } });
    await db.fileAsset.deleteMany({ where: { uploadedByName: { startsWith: PREFIX } } });
    for (const a of assets) await fs.rm(path.join(storeDir, "..", a.storedName), { force: true });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

/** Push every asset owned by the test users into a terminal state — keeps the
 *  5-concurrent-assets cap out of the way between test groups. */
async function settleAssets() {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.mediaAsset.updateMany({ where: { owner: { email: { startsWith: PREFIX } } }, data: { status: "ready" } });
}

/** Presign + PUT the bytes + complete — the full happy-path upload flow. */
async function fullUpload(
  token: string,
  opts: { purpose: "reel" | "post"; contentType?: string; bytes: Buffer }
): Promise<{ mediaId: string; complete: request.Response }> {
  const presign = await request(app)
    .post("/api/media/uploads")
    .set("Authorization", `Bearer ${token}`)
    .send({ purpose: opts.purpose, contentType: opts.contentType ?? "video/mp4", size: opts.bytes.length });
  expect(presign.status).toBe(201);
  const put = await request(app)
    .put(presign.body.upload.url)
    .set("Content-Type", opts.contentType ?? "video/mp4")
    .send(opts.bytes);
  expect(put.status).toBe(200);
  const complete = await request(app).post(`/api/media/${presign.body.mediaId}/complete`).set("Authorization", `Bearer ${token}`);
  expect(complete.status).toBe(200);
  return { mediaId: presign.body.mediaId, complete };
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { UPLOAD_DIR } = await import("@/domains/files");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");
  storeDir = path.join(UPLOAD_DIR, "media-store");

  const mk = (email: string, name: string) =>
    db.user.create({
      data: {
        email,
        name,
        role: "DONOR",
        password: hashPassword(PASSWORD),
        status: "ACTIVE",
        isActive: true,
      },
    });

  const a = await mk(`${PREFIX}-a@test.local`, `${PREFIX} owner`);
  const b = await mk(`${PREFIX}-b@test.local`, `${PREFIX} viewer`);
  const c = await mk(`${PREFIX}-c@test.local`, `${PREFIX} second`);
  aId = a.id;
  bId = b.id;
  cId = c.id;

  aToken = issueToken({ userId: a.id, role: "DONOR", name: a.name, email: a.email });
  bToken = issueToken({ userId: b.id, role: "DONOR", name: b.name, email: b.email });
  cToken = issueToken({ userId: c.id, role: "DONOR", name: c.name, email: c.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

const VID = Buffer.from("00000018667479706d703432000002006d7034316d703432", "hex"); // fake mp4 bytes

describe("media presign (POST /api/media/uploads)", () => {
  it("requires a session", async () => {
    const res = await request(app).post("/api/media/uploads").send({ purpose: "reel", contentType: "video/mp4", size: 10 });
    expect(res.status).toBe(401);
  });

  it("rejects bad mimes, non-positive and oversized sizes", async () => {
    const badMime = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/x-flv", size: 10 });
    expect(badMime.status).toBe(400);

    const zero = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/mp4", size: 0 });
    expect(zero.status).toBe(400);

    const oversized = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/mp4", size: 201 * 1024 * 1024 });
    expect(oversized.status).toBe(400);
  });

  it("returns a signed local upload URL", async () => {
    const res = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/mp4", size: VID.length });
    expect(res.status).toBe(201);
    expect(res.body.mediaId).toBeTruthy();
    expect(res.body.upload.method).toBe("PUT");
    expect(res.body.upload.url).toContain("/api/media/upload/");
    expect(res.body.upload.headers["Content-Type"]).toBe("video/mp4");
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  afterAll(settleAssets);
});

describe("local PUT receiver", () => {
  let url = "";

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/mp4", size: VID.length });
    url = res.body.upload.url;
  });

  it("rejects a tampered signature", async () => {
    const parts = url.split(".");
    const tampered = `${parts[0]}.${parts[1].slice(0, -1)}${parts[1].endsWith("A") ? "B" : "A"}`;
    const res = await request(app).put(tampered).set("Content-Type", "video/mp4").send(VID);
    expect(res.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const { signUploadToken } = await import("@/infrastructure/storage/signing");
    const { db } = await import("@/infrastructure/database/prisma");
    const asset = await db.mediaAsset.findFirst({ where: { owner: { email: { startsWith: PREFIX } } }, orderBy: { createdAt: "desc" } });
    expect(asset).toBeTruthy();
    const expired = signUploadToken({
      key: asset!.sourceKey,
      contentType: "video/mp4",
      contentLength: VID.length,
      exp: Date.now() - 1000,
      mediaId: asset!.id,
    });
    const res = await request(app).put(`/api/media/upload/${expired}`).set("Content-Type", "video/mp4").send(VID);
    expect(res.status).toBe(400);
  });

  it("rejects a wrong Content-Type", async () => {
    const res = await request(app).put(url).set("Content-Type", "video/webm").send(VID);
    expect(res.status).toBe(400);
  });

  it("rejects size mismatches (413 over, 400 under)", async () => {
    const over = await request(app).put(url).set("Content-Type", "video/mp4").send(Buffer.concat([VID, VID]));
    expect(over.status).toBe(413);

    const under = await request(app).put(url).set("Content-Type", "video/mp4").send(VID.subarray(0, 4));
    expect(under.status).toBe(400);
  });

  it("accepts the exact bytes and lands them in the store", async () => {
    const res = await request(app).put(url).set("Content-Type", "video/mp4").send(VID);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const { db } = await import("@/infrastructure/database/prisma");
    const asset = await db.mediaAsset.findFirst({ where: { owner: { email: { startsWith: PREFIX } } }, orderBy: { createdAt: "desc" } });
    const onDisk = await fs.stat(path.join(storeDir, asset!.sourceKey));
    expect(onDisk.size).toBe(VID.length);
  });

  afterAll(settleAssets);
});

describe("complete + poll", () => {
  let mediaId = "";

  beforeAll(async () => {
    const created = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/mp4", size: VID.length });
    mediaId = created.body.mediaId;
    const put = await request(app).put(created.body.upload.url).set("Content-Type", "video/mp4").send(VID);
    expect(put.status).toBe(200);
  });

  it("refuses completion before the bytes exist", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const fresh = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/mp4", size: VID.length });
    const res = await request(app).post(`/api/media/${fresh.body.mediaId}/complete`).set("Authorization", `Bearer ${aToken}`);
    expect(res.status).toBe(400);
    await db.mediaAsset.delete({ where: { id: fresh.body.mediaId } });
  });

  it("rejects a non-owner (403) and an unknown asset (404)", async () => {
    const other = await request(app).post(`/api/media/${mediaId}/complete`).set("Authorization", `Bearer ${bToken}`);
    expect(other.status).toBe(403);

    const missing = await request(app).post("/api/media/nonexistent/complete").set("Authorization", `Bearer ${aToken}`);
    expect(missing.status).toBe(404);
  });

  it("marks the asset uploaded and is idempotent", async () => {
    const first = await request(app).post(`/api/media/${mediaId}/complete`).set("Authorization", `Bearer ${aToken}`);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("uploaded");
    expect(first.body.id).toBe(mediaId);
    expect(first.body.hlsUrl).toBeNull(); // not ready yet

    const again = await request(app).post(`/api/media/${mediaId}/complete`).set("Authorization", `Bearer ${aToken}`);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("uploaded");
  });

  it("lets only the owner poll GET /api/media/:id", async () => {
    const owner = await request(app).get(`/api/media/${mediaId}`).set("Authorization", `Bearer ${aToken}`);
    expect(owner.status).toBe(200);
    expect(owner.body.status).toBe("uploaded");

    const other = await request(app).get(`/api/media/${mediaId}`).set("Authorization", `Bearer ${bToken}`);
    expect(other.status).toBe(403);
  });

  it("rejects re-uploading a finalized asset", async () => {
    const presign = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ purpose: "reel", contentType: "video/mp4", size: VID.length });
    const putUrl = presign.body.upload.url;
    await request(app).put(putUrl).set("Content-Type", "video/mp4").send(VID);
    await request(app).post(`/api/media/${presign.body.mediaId}/complete`).set("Authorization", `Bearer ${aToken}`);

    const reuse = await request(app).put(putUrl).set("Content-Type", "video/mp4").send(VID);
    expect(reuse.status).toBe(409);
  });

  afterAll(settleAssets);
});

describe("reel create with mediaId", () => {
  it("rejects another user's media, a wrong purpose, and double attach", async () => {
    // b uploads; a tries to attach → 404 (not visible)
    const { mediaId: bMedia } = await fullUpload(bToken, { purpose: "reel", bytes: VID });
    const wrongOwner = await request(app)
      .post("/api/reels")
      .set("Authorization", `Bearer ${aToken}`)
      .field("mediaId", bMedia);
    expect(wrongOwner.status).toBe(404);

    // a uploads a POST-purpose asset; reel attach → 400
    const { mediaId: postMedia } = await fullUpload(aToken, { purpose: "post", bytes: VID });
    const wrongPurpose = await request(app)
      .post("/api/reels")
      .set("Authorization", `Bearer ${aToken}`)
      .field("mediaId", postMedia);
    expect(wrongPurpose.status).toBe(400);

    // double attach: c attaches their own reel asset twice
    const { mediaId: cMedia } = await fullUpload(cToken, { purpose: "reel", bytes: VID });
    const first = await request(app).post("/api/reels").set("Authorization", `Bearer ${cToken}`).field("mediaId", cMedia);
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/reels").set("Authorization", `Bearer ${cToken}`).field("mediaId", cMedia);
    expect(second.status).toBe(400);
  });

  it("creates a reel from JSON {mediaId} with optional thumbnailUrl", async () => {
    const badThumb = await request(app)
      .post("/api/reels")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ mediaId: "does-not-matter", thumbnailUrl: "javascript:alert(1)" });
    expect(badThumb.status).toBe(400);

    const { mediaId } = await fullUpload(aToken, { purpose: "reel", bytes: VID });
    const res = await request(app)
      .post("/api/reels")
      .set("Authorization", `Bearer ${aToken}`)
      .send({ mediaId, description: `${PREFIX} json reel`, hashtags: "mediatest", thumbnailUrl: "/api/files/abc/file" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("uploaded");
    expect(res.body.content).toBeNull(); // playback hydrates when ready
    expect(res.body.thumbnail).toBe("/api/files/abc/file");
    expect(res.body.hlsUrl).toBeNull();
    expect(res.body.description).toBe(`${PREFIX} json reel`);
  });

  it("accepts mediaId as a multipart text field", async () => {
    const { mediaId } = await fullUpload(aToken, { purpose: "reel", bytes: VID });
    const res = await request(app)
      .post("/api/reels")
      .set("Authorization", `Bearer ${aToken}`)
      .field("mediaId", mediaId)
      .field("description", `${PREFIX} multipart reel`);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("uploaded");
    expect(res.body.thumbnail).toBeNull();
  });

  afterAll(settleAssets);
});

describe("visibility of processing reels", () => {
  let reelId = "";
  let mediaId = "";

  beforeAll(async () => {
    const { mediaId: id } = await fullUpload(aToken, { purpose: "reel", bytes: VID });
    mediaId = id;
    const res = await request(app)
      .post("/api/reels")
      .set("Authorization", `Bearer ${aToken}`)
      .field("mediaId", mediaId)
      .field("hashtags", "mediatest");
    expect(res.status).toBe(201);
    reelId = res.body.id;
  });

  it("hides the processing reel from other users' lists and single fetch", async () => {
    const user = await request(app).get(`/api/reels/user/${aId}`).set("Authorization", `Bearer ${bToken}`);
    expect(user.status).toBe(200);
    expect(user.body.items.map((r: { id: string }) => r.id)).not.toContain(reelId);

    const single = await request(app).get(`/api/reels/${reelId}`).set("Authorization", `Bearer ${bToken}`);
    expect(single.status).toBe(404);

    const foryou = await request(app).get("/api/reels").query({ feed: "foryou" }).set("Authorization", `Bearer ${bToken}`);
    expect(foryou.status).toBe(200);
    expect(foryou.body.items.map((r: { id: string }) => r.id)).not.toContain(reelId);

    const hashtag = await request(app).get("/api/reels/by-hashtag").query({ tags: "mediatest" }).set("Authorization", `Bearer ${bToken}`);
    expect(hashtag.status).toBe(200);
    expect(hashtag.body.items.map((r: { id: string }) => r.id)).not.toContain(reelId);
  });

  it("keeps the reel visible to the owner everywhere", async () => {
    const user = await request(app).get(`/api/reels/user/${aId}`).set("Authorization", `Bearer ${aToken}`);
    expect(user.body.items.map((r: { id: string }) => r.id)).toContain(reelId);

    const single = await request(app).get(`/api/reels/${reelId}`).set("Authorization", `Bearer ${aToken}`);
    expect(single.status).toBe(200);
    expect(single.body.status).toBe("uploaded");

    // public lists (by-hashtag included) hide processing reels for everyone —
    // only the profile list and the single fetch keep owner visibility.
    const hashtag = await request(app).get("/api/reels/by-hashtag").query({ tags: "mediatest" }).set("Authorization", `Bearer ${aToken}`);
    expect(hashtag.body.items.map((r: { id: string }) => r.id)).not.toContain(reelId);
  });

  describe("hydration once the media is ready", () => {
    beforeAll(async () => {
      const { db } = await import("@/infrastructure/database/prisma");
      await db.mediaAsset.update({
        where: { id: mediaId },
        data: {
          status: "ready",
          readyAt: new Date(),
          hlsKey: `media/${mediaId}/hls/master.m3u8`,
          mp4Key: `media/${mediaId}/video.mp4`,
          posterKey: `media/${mediaId}/poster.jpg`,
          durationMs: 2000,
          width: 1920,
          height: 1080,
        },
      });
    });

    it("adds playback fields and swaps content/thumbnail", async () => {
      const res = await request(app).get(`/api/reels/${reelId}`).set("Authorization", `Bearer ${bToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ready");
      expect(res.body.hlsUrl).toBe(`/api/media/files/media/${mediaId}/hls/master.m3u8`);
      expect(res.body.mp4Url).toBe(`/api/media/files/media/${mediaId}/video.mp4`);
      expect(res.body.posterUrl).toBe(`/api/media/files/media/${mediaId}/poster.jpg`);
      expect(res.body.content).toBe(res.body.mp4Url);
      expect(res.body.thumbnail).toBe(res.body.posterUrl);
      expect(res.body.durationMs).toBe(2000);
      expect(res.body.width).toBe(1920);
      expect(res.body.height).toBe(1080);
      expect(res.body.aspectRatio).toBeCloseTo(16 / 9);
    });
  });
});

describe("public playback serving (GET /api/media/files/*)", () => {
  let mediaId = "";
  const M3U8 = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n360.m3u8\n";

  beforeAll(async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    // the reel media from the previous group is ready — reuse it
    const reel = await db.communityReel.findFirst({ where: { user: { email: { startsWith: PREFIX } }, mediaId: { not: null } }, orderBy: { createdAt: "desc" } });
    mediaId = reel!.mediaId!;

    // write playback outputs + a source file on disk
    await fs.mkdir(path.join(storeDir, "media", mediaId, "hls"), { recursive: true });
    await fs.writeFile(path.join(storeDir, "media", mediaId, "hls", "master.m3u8"), M3U8);
    await fs.writeFile(path.join(storeDir, "media", mediaId, "video.mp4"), VID);
    await fs.writeFile(path.join(storeDir, "media", mediaId, "poster.jpg"), Buffer.from("poster"));
    await fs.writeFile(path.join(storeDir, "media", mediaId, "source.mp4"), VID);
  });

  it("serves a full playlist with the HLS mime + short cache", async () => {
    const res = await request(app).get(`/api/media/files/media/${mediaId}/hls/master.m3u8`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/vnd.apple.mpegurl");
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(res.text).toBe(M3U8);
  });

  it("answers Range requests with 206 + Content-Range", async () => {
    const res = await request(app).get(`/api/media/files/media/${mediaId}/video.mp4`).set("Range", `bytes=0-4`);
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 0-4/${VID.length}`);
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-length"]).toBe("5");
    expect(res.body.length).toBe(5);

    const suffix = await request(app).get(`/api/media/files/media/${mediaId}/video.mp4`).set("Range", "bytes=-3");
    expect(suffix.status).toBe(206);
    expect(suffix.headers["content-range"]).toBe(`bytes ${VID.length - 3}-${VID.length - 1}/${VID.length}`);
  });

  it("answers 416 on an out-of-bounds range", async () => {
    const res = await request(app).get(`/api/media/files/media/${mediaId}/video.mp4`).set("Range", `bytes=${VID.length + 10}-`);
    expect(res.status).toBe(416);
    expect(res.headers["content-range"]).toBe(`bytes */${VID.length}`);
  });

  it("never serves the raw source", async () => {
    const res = await request(app).get(`/api/media/files/media/${mediaId}/source.mp4`);
    expect(res.status).toBe(404);
  });

  it("rejects path traversal", async () => {
    const res = await request(app).get("/api/media/files/media/..%2F..%2F..%2Fpackage.json");
    expect(res.status).toBe(400);
  });

  it("hides outputs of assets that are not ready", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const pending = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${bToken}`)
      .send({ purpose: "post", contentType: "video/mp4", size: VID.length });
    await fs.mkdir(path.join(storeDir, "media", pending.body.mediaId), { recursive: true });
    await fs.writeFile(path.join(storeDir, "media", pending.body.mediaId, "video.mp4"), VID);

    const res = await request(app).get(`/api/media/files/media/${pending.body.mediaId}/video.mp4`);
    expect(res.status).toBe(404);
    await db.mediaAsset.delete({ where: { id: pending.body.mediaId } });
  });
});

describe("GET /api/files/:id/file Range support", () => {
  it("streams 206 ranges and 200 full bodies", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const bytes = Buffer.from("0123456789abcdef");
    const storedName = `${randomUUID()}-range.mp4`;
    await fs.writeFile(path.join(storeDir, "..", storedName), bytes);
    const asset = await db.fileAsset.create({
      data: { name: "range.mp4", storedName, mime: "video/mp4", size: bytes.length, folder: "community", uploadedByName: PREFIX },
    });

    try {
      const ranged = await request(app).get(`/api/files/${asset.id}/file`).set("Range", "bytes=2-5");
      expect(ranged.status).toBe(206);
      expect(ranged.headers["content-range"]).toBe(`bytes 2-5/${bytes.length}`);
      expect(ranged.body.toString("utf8")).toBe("2345");

      const full = await request(app).get(`/api/files/${asset.id}/file`);
      expect(full.status).toBe(200);
      expect(full.headers["accept-ranges"]).toBe("bytes");
      expect(full.body.length).toBe(bytes.length);
    } finally {
      await db.fileAsset.delete({ where: { id: asset.id } }).catch(() => {});
      await fs.rm(path.join(storeDir, "..", storedName), { force: true });
    }
  });
});

describe("post create with mediaIds", () => {
  let mediaId = "";
  let postId = "";

  it("rejects wrong purpose and non-video content types", async () => {
    const { mediaId: reelMedia } = await fullUpload(aToken, { purpose: "reel", bytes: VID });
    const wrongPurpose = await request(app)
      .post("/api/posts")
      .set("Authorization", `Bearer ${aToken}`)
      .field("mediaIds", reelMedia)
      .field("contentType", "1");
    expect(wrongPurpose.status).toBe(400);

    const { mediaId: postMedia } = await fullUpload(aToken, { purpose: "post", bytes: VID });
    const wrongType = await request(app)
      .post("/api/posts")
      .set("Authorization", `Bearer ${aToken}`)
      .field("mediaIds", postMedia)
      .field("contentType", "0");
    expect(wrongType.status).toBe(400);

    const other = await fullUpload(cToken, { purpose: "post", bytes: VID });
    const wrongOwner = await request(app)
      .post("/api/posts")
      .set("Authorization", `Bearer ${aToken}`)
      .field("mediaIds", other.mediaId)
      .field("contentType", "1");
    expect(wrongOwner.status).toBe(404);
    mediaId = postMedia;
  });

  it("creates a video post from mediaIds (JSON-array string form)", async () => {
    const { mediaId: second } = await fullUpload(aToken, { purpose: "post", bytes: VID });
    const res = await request(app)
      .post("/api/posts")
      .set("Authorization", `Bearer ${aToken}`)
      .field("desc", `${PREFIX} video post`)
      .field("contentType", "1")
      .field("mediaIds", JSON.stringify([mediaId, second]));
    expect(res.status).toBe(201);
    expect(res.body.content.length).toBe(2);
    expect(res.body.content[0].contentType).toBe(1);
    expect(res.body.content[0].status).toBe("uploaded");
    expect(res.body.content[0].content).toBe("");
    expect(res.body.content[0].mp4Url).toBeNull();
    postId = res.body.id;
  });

  it("hides the processing post from other users' feeds but shows it to the owner", async () => {
    const other = await request(app).get("/api/posts").query({ type: "latest" }).set("Authorization", `Bearer ${bToken}`);
    expect(other.status).toBe(200);
    expect(other.body.items.map((p: { id: string }) => p.id)).not.toContain(postId);

    const mine = await request(app).get("/api/posts").query({ type: "latest" }).set("Authorization", `Bearer ${aToken}`);
    expect(mine.body.items.map((p: { id: string }) => p.id)).toContain(postId);
  });

  it("hydrates content when the media is ready and deletes media with the post", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    await db.mediaAsset.update({
      where: { id: mediaId },
      data: {
        status: "ready",
        readyAt: new Date(),
        hlsKey: `media/${mediaId}/hls/master.m3u8`,
        mp4Key: `media/${mediaId}/video.mp4`,
        posterKey: `media/${mediaId}/poster.jpg`,
        durationMs: 1500,
        width: 720,
        height: 1280,
      },
    });

    const other = await request(app).get(`/api/posts/${postId}`).set("Authorization", `Bearer ${bToken}`);
    expect(other.status).toBe(200);
    const ready = other.body.content.find(
      (c: { status: string; mp4Url: string | null; hlsUrl: string | null; content: string; aspectRatio: number; durationMs: number }) => c.status === "ready"
    );
    expect(ready).toBeTruthy();
    expect(ready.status).toBe("ready");
    expect(ready.mp4Url).toBe(`/api/media/files/media/${mediaId}/video.mp4`);
    expect(ready.hlsUrl).toBe(`/api/media/files/media/${mediaId}/hls/master.m3u8`);
    expect(ready.content).toBe(ready.mp4Url);
    expect(ready.aspectRatio).toBeCloseTo(720 / 1280);
    expect(ready.durationMs).toBe(1500);

    const del = await request(app).delete(`/api/posts/${postId}`).set("Authorization", `Bearer ${aToken}`);
    expect(del.status).toBe(200);
    expect(await db.mediaAsset.findUnique({ where: { id: mediaId } })).toBeNull();
  });

  afterAll(settleAssets);
});

describe("concurrent cap vs stale pending uploads", () => {
  it("ignores pending_upload rows older than the URL TTL for the cap", async () => {
    const { db } = await import("@/infrastructure/database/prisma");

    // 5 fresh pending uploads → the 6th is capped
    const fresh: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/media/uploads")
        .set("Authorization", `Bearer ${cToken}`)
        .send({ purpose: "post", contentType: "video/mp4", size: VID.length });
      expect(res.status).toBe(201);
      fresh.push(res.body.mediaId);
    }
    const blocked = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${cToken}`)
      .send({ purpose: "post", contentType: "video/mp4", size: VID.length });
    expect(blocked.status).toBe(429);

    // age 3 of them past the 15-min URL TTL — abandoned uploads must free the cap
    await db.mediaAsset.updateMany({
      where: { id: { in: fresh.slice(0, 3) } },
      data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) },
    });
    const ok = await request(app)
      .post("/api/media/uploads")
      .set("Authorization", `Bearer ${cToken}`)
      .send({ purpose: "post", contentType: "video/mp4", size: VID.length });
    expect(ok.status).toBe(201);

    // keep the queue clean for later groups
    await db.mediaAsset.deleteMany({ where: { id: { in: [...fresh, ok.body.mediaId] } } });
  });
});

describe("abandoned asset sweeper", () => {
  it("sweeps stale pending/unattached rows (store prefix included) and keeps attached ones", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const { sweepAbandonedAssets } = await import("@/jobs/workers/transcoder.worker");
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000); // past the 24h sweep age

    const mk = (status: string) =>
      db.mediaAsset.create({
        data: { ownerId: cId, purpose: "reel", status, sourceKey: "", sourceMime: "video/mp4", sourceSize: 1, createdAt: old },
      });
    const stalePending = await mk("pending_upload");
    const staleUnattached = await mk("uploaded");
    const staleAttached = await mk("ready");
    const freshPending = await db.mediaAsset.create({
      data: { ownerId: cId, purpose: "reel", status: "pending_upload", sourceKey: "", sourceMime: "video/mp4", sourceSize: 1 },
    });

    // the ready asset belongs to a live reel — must be kept
    const reel = await db.communityReel.create({ data: { userId: cId, mediaId: staleAttached.id } });
    // orphaned bytes for the stale pending upload — swept with the row
    await fs.mkdir(path.join(storeDir, "media", stalePending.id), { recursive: true });
    await fs.writeFile(path.join(storeDir, "media", stalePending.id, "source.mp4"), VID);

    const removed = await sweepAbandonedAssets();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await db.mediaAsset.findUnique({ where: { id: stalePending.id } })).toBeNull();
    expect(await db.mediaAsset.findUnique({ where: { id: staleUnattached.id } })).toBeNull();
    await expect(fs.access(path.join(storeDir, "media", stalePending.id, "source.mp4"))).rejects.toThrow();
    expect(await db.mediaAsset.findUnique({ where: { id: staleAttached.id } })).not.toBeNull();
    expect(await db.mediaAsset.findUnique({ where: { id: freshPending.id } })).not.toBeNull();

    await db.communityReel.delete({ where: { id: reel.id } });
    await db.mediaAsset.deleteMany({ where: { id: { in: [staleAttached.id, freshPending.id] } } });
  });
});

describe("storage config validation", () => {
  it("fail-fast names the missing S3 variables and passes a complete config", async () => {
    const { assertStorageConfig } = await import("@/infrastructure/storage");
    const saved: Array<[string, string | undefined]> = [
      ["STORAGE_DRIVER", process.env.STORAGE_DRIVER],
      ["S3_BUCKET", process.env.S3_BUCKET],
      ["S3_REGION", process.env.S3_REGION],
      ["S3_ACCESS_KEY_ID", process.env.S3_ACCESS_KEY_ID],
      ["S3_SECRET_ACCESS_KEY", process.env.S3_SECRET_ACCESS_KEY],
    ];
    const set = (k: string, v: string | undefined) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    };
    try {
      set("STORAGE_DRIVER", "s3");
      set("S3_BUCKET", undefined);
      set("S3_REGION", undefined);
      set("S3_ACCESS_KEY_ID", undefined);
      set("S3_SECRET_ACCESS_KEY", undefined);
      expect(() => assertStorageConfig()).toThrow(/S3_BUCKET, S3_REGION/);

      set("S3_BUCKET", "bucket");
      expect(() => assertStorageConfig()).toThrow(/S3_REGION/);

      set("S3_REGION", "eu-west-1");
      expect(() => assertStorageConfig()).not.toThrow();

      // half a credential pair is a misconfiguration
      set("S3_ACCESS_KEY_ID", "key");
      expect(() => assertStorageConfig()).toThrow(/S3_SECRET_ACCESS_KEY/);
      set("S3_ACCESS_KEY_ID", undefined);
      set("S3_SECRET_ACCESS_KEY", "secret");
      expect(() => assertStorageConfig()).toThrow(/S3_ACCESS_KEY_ID/);

      // the local driver has no required vars
      set("STORAGE_DRIVER", "local");
      expect(() => assertStorageConfig()).not.toThrow();
    } finally {
      for (const [k, v] of saved) set(k, v);
    }
  });
});

describe("end-to-end transcode (ffmpeg)", () => {
  /** Generate a 2s lavfi test clip (video + audio) and return its path. */
  function genClip(size: string, extraArgs: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      const out = path.join(storeDir, "..", `e2e-${randomUUID()}.mp4`);
      const gen = spawnSync(
        FFMPEG,
        ["-y", "-f", "lavfi", "-i", `testsrc=duration=2:size=${size}:rate=15`, "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", ...extraArgs, "-shortest", out]
      );
      if (gen.status !== 0) return reject(new Error(gen.stderr?.toString().slice(-400) || "ffmpeg failed"));
      resolve(out);
    });
  }

  it.skipIf(!hasFfmpeg)(
    "transcodes a PORTRAIT clip: 3-rung HLS ladder with per-rung segments + poster",
    async () => {
      const { db } = await import("@/infrastructure/database/prisma");
      const { processMediaAsset } = await import("@/jobs/workers/transcoder.worker");

      // 2s 720x1280 portrait clip (video + audio) via lavfi — short side 720
      // → the full ladder (360/540/720) is generated.
      const tmp = await genClip("720x1280");
      const bytes = await fs.readFile(tmp);
      await fs.rm(tmp, { force: true });

      const { mediaId } = await fullUpload(aToken, { purpose: "reel", bytes });

      const updated = await processMediaAsset(mediaId);
      expect(updated?.status).toBe("ready");
      expect(updated?.hlsKey).toBe(`media/${mediaId}/hls/master.m3u8`);
      expect(updated?.mp4Key).toBe(`media/${mediaId}/video.mp4`);
      expect(updated?.posterKey).toBe(`media/${mediaId}/poster.jpg`);
      // display dims stay portrait
      expect(updated?.width).toBe(720);
      expect(updated?.height).toBe(1280);
      expect(updated!.width!).toBeLessThan(updated!.height!);
      expect(Math.abs((updated?.durationMs ?? 0) - 2000)).toBeLessThanOrEqual(500);

      // ladder + per-rung segment layout
      const rungs = [360, 540, 720];
      const hlsDir = path.join(storeDir, "media", mediaId, "hls");
      const files = await fs.readdir(hlsDir);
      expect(files).toContain("master.m3u8");
      for (const rung of rungs) expect(files).toContain(`${rung}.m3u8`);

      // each variant playlist references ONLY its own rung's segments, and
      // those segment files exist and differ between rungs
      const segmentsByRung: Record<number, string[]> = {};
      for (const rung of rungs) {
        const playlist = await fs.readFile(path.join(hlsDir, `${rung}.m3u8`), "utf8");
        const refs = playlist.split("\n").filter((l) => l.endsWith(".ts"));
        expect(refs.length).toBeGreaterThan(0);
        for (const ref of refs) expect(ref).toMatch(new RegExp(`^${rung}p_\\d{4}\\.ts$`));
        for (const ref of refs) await fs.access(path.join(hlsDir, ref)); // exists
        segmentsByRung[rung] = refs;
      }
      // distinct segment sets per rung (no collision/overwrite): disjoint
      // names, every file non-empty, and higher rungs encode more bytes
      const names = rungs.map((r) => new Set(segmentsByRung[r]));
      for (let i = 0; i < rungs.length; i++) {
        for (let j = i + 1; j < rungs.length; j++) {
          for (const name of names[i]) expect(names[j].has(name)).toBe(false);
        }
      }
      const bytesOf = (rung: number) =>
        segmentsByRung[rung].reduce((sum, name) => sum + statSync(path.join(hlsDir, name)).size, 0);
      expect(bytesOf(360)).toBeGreaterThan(0);
      expect(bytesOf(360)).toBeLessThan(bytesOf(540));
      expect(bytesOf(540)).toBeLessThan(bytesOf(720));

      // master playlist: independent segments + one STREAM-INF per rung
      const master = await fs.readFile(path.join(hlsDir, "master.m3u8"), "utf8");
      expect(master).toContain("#EXT-X-INDEPENDENT-SEGMENTS");
      expect(master.split("#EXT-X-STREAM-INF").length - 1).toBe(rungs.length);
      for (const rung of rungs) expect(master).toContain(`${rung}.m3u8`);

      await fs.access(path.join(storeDir, "media", mediaId, "video.mp4"));
      await fs.access(path.join(storeDir, "media", mediaId, "poster.jpg"));

      // source bytes are dropped after a successful transcode
      await expect(fs.access(path.join(storeDir, "media", mediaId, "source.mp4"))).rejects.toThrow();

      // playback serving round-trips the master playlist
      const served = await request(app).get(`/api/media/files/media/${mediaId}/hls/master.m3u8`);
      expect(served.status).toBe(200);
      expect(served.text).toContain("#EXT-X-INDEPENDENT-SEGMENTS");

      // the reel hydrates with the transcoded URLs and portrait dims —
      // create one from the now-ready media (media-mode POST /api/reels)
      const created = await request(app)
        .post("/api/reels")
        .set("Authorization", `Bearer ${aToken}`)
        .send({ mediaId, description: `${PREFIX} portrait e2e` });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe("ready");
      expect(created.body.hlsUrl).toBe(`/api/media/files/media/${mediaId}/hls/master.m3u8`);
      expect(created.body.content).toBe(created.body.mp4Url);
      expect(created.body.width).toBe(720);
      expect(created.body.height).toBe(1280);
      expect(created.body.width).toBeLessThan(created.body.height);

      const reel = await db.communityReel.findFirst({ where: { userId: aId, mediaId }, select: { id: true } });
      expect(reel).toBeTruthy();
    },
    120_000
  );

  it.skipIf(!hasFfmpeg)(
    "transcodes a ROTATED landscape clip (rotate metadata → portrait display dims)",
    async () => {
      const { processMediaAsset } = await import("@/jobs/workers/transcoder.worker");

      // 1280x720 landscape source, then stamp rotate-90 display metadata on a
      // stream copy (ffmpeg ≥6: -display_rotation is an input option) — the
      // probe must resolve portrait display dims 720x1280.
      const landscape = await genClip("1280x720");
      const rotated = path.join(storeDir, "..", `e2e-rot-${randomUUID()}.mp4`);
      const stamp = spawnSync(FFMPEG, ["-y", "-v", "error", "-display_rotation", "90", "-i", landscape, "-c", "copy", rotated]);
      expect(stamp.status).toBe(0);
      const bytes = await fs.readFile(rotated);
      await fs.rm(landscape, { force: true });
      await fs.rm(rotated, { force: true });

      const { mediaId } = await fullUpload(aToken, { purpose: "post", bytes });
      const updated = await processMediaAsset(mediaId);
      expect(updated?.status).toBe("ready");
      // rotation metadata respected: portrait display dims
      expect(updated?.width).toBe(720);
      expect(updated?.height).toBe(1280);
      expect(updated!.width!).toBeLessThan(updated!.height!);
    },
    120_000
  );
});
