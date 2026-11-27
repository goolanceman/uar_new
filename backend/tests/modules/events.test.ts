/**
 * Events module — the live donation feed SSE stream /api/events/stream
 * (real router via @/routes/events).
 *
 * Public read: when the features.liveDonationFeed flag is off the endpoint
 * answers the 503 envelope; when on it opens a text/event-stream that
 * immediately writes the `: connected` comment. The flag row is created for
 * the happy path and restored (deleted) right after the assertion.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { IncomingMessage } from "node:http";
import express from "express";
import request from "supertest";

const FLAG_KEY = "features.liveDonationFeed";

let app: express.Express;
let flagRowExisted = false;
let flagRowPriorValue: string | null = null;

async function buildApp() {
  const { router } = await import("@/routes/events");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/events", router);
  // the centralized error middleware (app.ts) — event controllers forward
  // errors via next(error)
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
  });
  return a;
}

/** Restores the flag row to its pre-test state (absent or original value). */
async function restoreFlag() {
  const { db } = await import("@/infrastructure/database/prisma");
  if (flagRowExisted) {
    await db.setting.update({ where: { key: FLAG_KEY }, data: { value: flagRowPriorValue ?? "false" } });
    flagRowExisted = false;
  } else {
    await db.setting.deleteMany({ where: { key: FLAG_KEY } });
  }
  const { invalidateSettings } = await import("@/infrastructure/cache");
  await invalidateSettings();
}

beforeAll(async () => {
  await restoreFlag(); // ensure a known baseline (flag off)
  app = await buildApp();
});

afterAll(async () => {
  await restoreFlag();
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("GET /api/events/stream (public)", () => {
  it("answers 503 when the live donation feed flag is off", async () => {
    const res = await request(app).get("/api/events/stream");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("Live donation feed is disabled");
  });

  it("accepts (and ignores) query string noise — legacy leniency", async () => {
    const res = await request(app).get("/api/events/stream").query({ since: "1", extra: "x" });
    expect([200, 503]).toContain(res.status); // the schema strips everything
  });

  it("opens a text/event-stream with the `: connected` comment when the flag is on", async () => {
    // flip the flag (created here — restored in afterAll)
    const { db } = await import("@/infrastructure/database/prisma");
    const prior = await db.setting.findUnique({ where: { key: FLAG_KEY } });
    flagRowExisted = Boolean(prior);
    flagRowPriorValue = prior?.value ?? null;
    await db.setting.upsert({
      where: { key: FLAG_KEY },
      create: { key: FLAG_KEY, value: "true" },
      update: { value: "true" },
    });
    // loadSettings() is a cached KV map — drop it so the stream sees the flip
    const { invalidateSettings } = await import("@/infrastructure/cache");
    await invalidateSettings();

    // The stream stays open forever — resolve as soon as the first chunk
    // (the `: connected` comment) arrives, then close the socket.
    let firstChunk = "";
    const req = request(app).get("/api/events/stream");
    req.parse((res, callback) => {
      const raw = res as unknown as IncomingMessage;
      raw.once("data", (chunk: Buffer) => {
        firstChunk = chunk.toString();
        callback(null, Buffer.alloc(0));
        raw.destroy(); // clean up the open SSE socket
      });
    });
    const res = await req;

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toContain("no-cache");
    expect(firstChunk).toBe(": connected\n\n");

    // drop the settings cache so the next suite sees the restored value
    await invalidateSettings();
    await restoreFlag();
  });
});
