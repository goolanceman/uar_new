/**
 * Files module — /api/files (real router via @/routes/files).
 *
 * Multipart upload (any authenticated user; non-admins pinned to
 * kyc/<userId>), the admin list with global stats, the single record, the
 * PATCH field checks, the DELETE (DB row + on-disk bytes) and the download
 * access policy (image mimes public; document mimes need ADMIN/uploader).
 * Only touches FileAssets whose name starts with the unique PREFIX.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { existsSync } from "node:fs";

const PREFIX = `files-${Date.now()}`;
const PASSWORD = "[redacted]]";
const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d4948445200000001", "hex");
const TXT_BYTES = Buffer.from(`${PREFIX} document body`, "utf8");

let app: express.Express;
let adminToken = "";
let donorToken = "";
let otherToken = "";
let donorId = "";
let pngId = "";
let docId = "";
let uploadedStoredNames: string[] = [];

async function buildApp() {
  const { router } = await import("@/routes/files");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/files", router);
  // the centralized error middleware (app.ts) — file controllers forward
  // errors via next(error)
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

/** Buffers the (possibly binary) download body so byte compares work. */
function rawBody(req: import("supertest").Test) {
  return req.buffer(true).parse((res: unknown, callback: (err: Error | null, body?: Buffer) => unknown) => {
    const chunks: Buffer[] = [];
    (res as import("http").IncomingMessage).on("data", (chunk: Buffer) => chunks.push(chunk));
    (res as import("http").IncomingMessage).on("end", () => callback(null, Buffer.concat(chunks)));
  });
}

async function cleanup() {
  const { db } = await import("@/infrastructure/database/prisma");
  const rows = await db.fileAsset.findMany({ where: { name: { startsWith: PREFIX } } });
  for (const row of rows) {
    await db.fileAsset.delete({ where: { id: row.id } }).catch(() => {});
    const { UPLOAD_DIR } = await import("@/domains/files");
    const target = `${UPLOAD_DIR}/${row.storedName}`;
    if (existsSync(target)) {
      const { unlink } = await import("node:fs/promises");
      await unlink(target).catch(() => {});
    }
  }
  uploadedStoredNames = [];
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.activityLog.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  const { db } = await import("@/infrastructure/database/prisma");
  const { hashPassword, issueToken } = await import("@/infrastructure/auth/session");

  const admin = await db.user.create({
    data: {
      email: `${PREFIX}-admin@test.local`,
      name: `${PREFIX} admin`,
      role: "ADMIN",
      password: hashPassword(PASSWORD),
      status: "ACTIVE",
      isActive: true,
    },
  });
  const donor = await db.user.create({
    data: {
      email: `${PREFIX}-donor@test.local`,
      name: `${PREFIX} donor`,
      role: "DONOR",
      password: hashPassword(PASSWORD),
      status: "ACTIVE",
      isActive: true,
    },
  });
  const other = await db.user.create({
    data: {
      email: `${PREFIX}-other@test.local`,
      name: `${PREFIX} other`,
      role: "DONOR",
      password: hashPassword(PASSWORD),
      status: "ACTIVE",
      isActive: true,
    },
  });
  donorId = donor.id;
  adminToken = issueToken({ userId: admin.id, role: "ADMIN", name: admin.name, email: admin.email });
  donorToken = issueToken({ userId: donor.id, role: "DONOR", name: donor.name, email: donor.email });
  otherToken = issueToken({ userId: other.id, role: "DONOR", name: other.name, email: other.email });
});

afterAll(async () => {
  await cleanup();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("POST /api/files (multipart upload)", () => {
  it("uploads an image for an authenticated user — pinned to their kyc folder", async () => {
    const res = await request(app)
      .post("/api/files")
      .set("Authorization", `Bearer ${donorToken}`)
      .attach("file", PNG_BYTES, { filename: `${PREFIX}-a.png`, contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.files).toHaveLength(1);
    expect(res.body.files[0].name).toBe(`${PREFIX}-a.png`);
    expect(res.body.files[0].mime).toBe("image/png");
    expect(res.body.files[0].folder).toBe(`kyc/${donorId}`); // non-admins cannot pick folders
    expect(res.body.urls[0]).toContain("/api/files/");
    pngId = res.body.files[0].id;
    uploadedStoredNames.push(res.body.files[0].storedName);
  });

  it("uploads a document for the admin in a chosen folder", async () => {
    const res = await request(app)
      .post("/api/files")
      .set("Authorization", `Bearer ${adminToken}`)
      .field("folder", "docs")
      .attach("file", TXT_BYTES, { filename: `${PREFIX}-d.txt`, contentType: "text/plain" });
    expect(res.status).toBe(201);
    expect(res.body.files[0].folder).toBe("docs");
    docId = res.body.files[0].id;
  });

  it("rejects an upload with no file (400, exact message)", async () => {
    const res = await request(app).post("/api/files").set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No file provided");
  });

  it("401 without a token (multer runs first, then the auth gate)", async () => {
    const res = await request(app)
      .post("/api/files")
      .attach("file", PNG_BYTES, { filename: `${PREFIX}-nope.png`, contentType: "image/png" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Please sign in to continue");
  });
});

describe("GET /api/files/:id/file — download policy", () => {
  it("serves image mimes publicly with the recorded type + bytes", async () => {
    const res = await rawBody(request(app).get(`/api/files/${pngId}/file`));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
  });

  it("forces a download with the original filename via ?download=1", async () => {
    const res = await request(app).get(`/api/files/${pngId}/file`).query({ download: 1 });
    expect(res.status).toBe(200);
    expect(String(res.headers["content-disposition"])).toContain(`${PREFIX}-a.png`);
  });

  it("requires a session for document mimes (401 anonymous)", async () => {
    const res = await request(app).get(`/api/files/${docId}/file`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Please sign in to access this document");
  });

  it("forbids document mimes for non-uploaders (403) but allows the admin", async () => {
    const forbidden = await request(app)
      .get(`/api/files/${docId}/file`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("You do not have permission to access this document");

    const ok = await rawBody(request(app)
      .get(`/api/files/${docId}/file`)
      .set("Authorization", `Bearer ${adminToken}`));
    expect(ok.status).toBe(200);
    expect(Buffer.compare(ok.body as Buffer, TXT_BYTES)).toBe(0);
  });

  it("404s for unknown ids", async () => {
    const res = await request(app).get("/api/files/nonexistent-file-id/file");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("File not found");
  });
});

describe("admin file management", () => {
  it("lists files newest-first with global stats on the unfiltered first page", async () => {
    const res = await request(app).get("/api/files").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(res.body.stats).toBeTypeOf("object");
    expect(typeof res.body.stats.count).toBe("number");
    expect(typeof res.body.stats.totalBytes).toBe("number");
    expect(res.body.items.map((f: { name: string }) => f.name)).toContain(`${PREFIX}-a.png`);
  });

  it("403s the list for non-admins", async () => {
    const res = await request(app).get("/api/files").set("Authorization", `Bearer ${donorToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You do not have permission for this action");
  });

  it("fetches a single record (admin) and 404s unknown ids", async () => {
    const ok = await request(app).get(`/api/files/${pngId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe(`${PREFIX}-a.png`);

    const missing = await request(app)
      .get("/api/files/nonexistent-file-id")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("File not found");
  });

  it("patches title/description/folder with the exact field messages", async () => {
    const ok = await request(app)
      .patch(`/api/files/${pngId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `${PREFIX} title`, description: "note" });
    expect(ok.status).toBe(200);
    expect(ok.body.title).toBe(`${PREFIX} title`);

    const badFolder = await request(app)
      .patch(`/api/files/${pngId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ folder: "bad folder!" });
    expect(badFolder.status).toBe(400);
    expect(badFolder.body.error).toBe("Folder may only contain a-z, 0-9, dashes and underscores");

    const empty = await request(app)
      .patch(`/api/files/${pngId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Nothing to update");

    const missing = await request(app)
      .patch("/api/files/nonexistent-file-id")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "x" });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("File not found");
  });

  it("deletes a file (row + on-disk bytes) and 404s unknown ids", async () => {
    const { db } = await import("@/infrastructure/database/prisma");
    const before = await db.fileAsset.findUnique({ where: { id: pngId } });
    expect(before).toBeTruthy();

    const res = await request(app)
      .delete(`/api/files/${pngId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expect(await db.fileAsset.findUnique({ where: { id: pngId } })).toBeNull();
    const { UPLOAD_DIR } = await import("@/domains/files");
    expect(existsSync(`${UPLOAD_DIR}/${before!.storedName}`)).toBe(false);
    pngId = "";

    const missing = await request(app)
      .delete(`/api/files/${before!.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("File not found");
  });
});
