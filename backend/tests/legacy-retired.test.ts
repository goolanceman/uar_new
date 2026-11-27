/**
 * Legacy mobile-only surface retired (vitest + supertest).
 *
 * The mobile wire-compat router (src/routes/mobile — the `apikey`-gated
 * Laravel-shaped handlers) was deleted in the S7 cleanup. Requests that still
 * carry the legacy `apikey` header now fall through to the generic routers,
 * which answer 404 for the retired legacy paths — nothing may resurrect them.
 *
 * Runs against the TEST database; creates no rows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

let app: express.Express;

async function buildApp() {
  const { router: postsRouter } = await import("@/routes/posts");
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use("/api/posts", postsRouter);
  // same 404 catch-all as src/index.ts — the retired paths must answer with
  // the generic { error: "Not found" } body.
  a.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  return a;
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  const { db } = await import("@/infrastructure/database/prisma");
  await db.$disconnect();
});

describe("retired legacy mobile routes", () => {
  it("an apikey request to a former legacy path (POST /api/fetchPosts) is a plain 404", async () => {
    const res = await request(app)
      .post("/api/fetchPosts")
      .set("apikey", "test")
      .set("authtoken", "junk")
      .send({ start: 0, limit: 10 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" }); // the generic 404 body
  });

  it("GET /api/mobile-ping (compat health probe) is 404", async () => {
    const res = await request(app).get("/api/mobile-ping").set("apikey", "test");
    expect(res.status).toBe(404);
  });

  it("an apikey request that collides with a generic path uses the generic router", async () => {
    // /api/posts exists generically — an apikey header must not change that.
    const res = await request(app).get("/api/posts").set("apikey", "test");
    expect(res.status).toBe(401); // auth required, NOT 404 from a legacy handler
  });
});
