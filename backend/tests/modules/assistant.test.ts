/**
 * Assistant module — POST /api/assistant/chat (real router via
 * @/routes/assistant). PUBLIC route: guests welcome, the optional session is
 * validated mid-handler (role gates live-ops data). The empty-message 400 is
 * asserted plus the documented legacy crash parity for a non-string message.
 * The z-ai LLM may be unavailable in this environment — the service falls
 * back to the knowledge base, so a 200 always carries a non-empty reply.
 * Touches no database rows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const PREFIX = `assistant-${Date.now()}`;

let app: express.Express;

async function buildApp() {
  const { router } = await import("@/routes/assistant");
  const { handleError } = await import("@/infrastructure/auth/session");
  const a = express();
  a.use(express.json({ limit: "1mb" }));
  a.use("/api/assistant", router);
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    handleError(err, res);
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

describe("POST /api/assistant/chat", () => {
  it("400s an empty/missing message with the exact legacy body", async () => {
    const empty = await request(app).post("/api/assistant/chat").send({ message: "" });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("Message is required");

    const missing = await request(app).post("/api/assistant/chat").send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("Message is required");
  });

  it("keeps the legacy crash parity for a non-string message (500)", async () => {
    const res = await request(app).post("/api/assistant/chat").send({ message: 42 });
    expect(res.status).toBe(500);
  });

  it("answers a guest (no session) with reply + sources + suggestions + helplines", async () => {
    const res = await request(app)
      .post("/api/assistant/chat")
      .send({ message: `${PREFIX} how do I report a cyber fraud?` });
    expect(res.status).toBe(200);
    expect(typeof res.body.reply).toBe("string");
    expect(res.body.reply.length).toBeGreaterThan(0); // KB fallback keeps it non-empty offline
    expect(Array.isArray(res.body.sources)).toBe(true);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    expect(res.body.suggestions.length).toBeLessThanOrEqual(4);
    expect(res.body.helplines.emergency).toBe("112");
    expect(res.body.helplines.cyberFraud).toBe("1930");
  });

  it("treats an invalid token as a guest (PUBLIC role, still 200)", async () => {
    const res = await request(app)
      .post("/api/assistant/chat")
      .set("Authorization", "Bearer not-a-real-token")
      .send({ message: "what is united angel reach?" });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBeTruthy();
  });

  it("accepts conversation history alongside the message", async () => {
    const res = await request(app)
      .post("/api/assistant/chat")
      .send({
        message: "and the ambulance number?",
        history: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "Hi! How can I help?" },
        ],
      });
    expect(res.status).toBe(200);
    expect(typeof res.body.reply).toBe("string");
  });
});
