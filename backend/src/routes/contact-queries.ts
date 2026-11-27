/**
 * Contact query routes — /api/contact-queries, /api/contact-queries/:id
 * Converted 1:1 from src/app/api/contact-queries/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { assertTransition } from "@/lib/workflow";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";
import { loadSettings, notifyContactQuery } from "@/lib/notify";

const log = logger.child("contact-queries");

export const router = Router();

const CONTACT_QUERY_STATUSES = ["PENDING", "RESOLVED", "CLOSED"];
const CONTACT_QUERY_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED", "PENDING"],
  CLOSED: ["PENDING"],
};

// GET /api/contact-queries?status — admin inbox
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN");

    const sp = new URL(req.url, "http://localhost").searchParams;
    const status = sp.get("status");

    const queries = await db.contactQuery.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: { createdAt: "desc" },
    });

    return json(res, queries);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/contact-queries — public contact form
router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};

    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const subject = String(body?.subject ?? "").trim();
    const message = String(body?.message ?? "").trim();

    if (!name || !email || !subject || !message)
      throw new ApiError("Name, email, subject and message are required", 400);
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Please enter a valid email address", 400);

    const query = await db.contactQuery.create({
      data: {
        name,
        email,
        phone: body?.phone ? String(body.phone).trim() : null,
        subject,
        message,
        status: "PENDING",
      },
    });

    await logActivity(name, "CONTACT", "CONTACT_QUERY", `${subject} · ${email}`);

    // Fire-and-forget public acknowledgement (senders no-op when disabled)
    void (async () => {
      try {
        const map = await loadSettings();
        await notifyContactQuery(
          map,
          {
            name: map["org.name"] || "United Angel Reach",
            footer: map["receipts.footer"] || undefined,
          },
          { name: query.name, email: query.email }
        );
      } catch (e) {
        log.warn("contact_query_ack_failed", {
          error: e instanceof Error ? e : String(e),
          queryId: query.id,
        });
      }
    })();

    return json(res, query, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/contact-queries/:id — admin updates query status
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const body = req.body ?? {};

    const status = String(body?.status ?? "").trim().toUpperCase();
    if (!CONTACT_QUERY_STATUSES.includes(status))
      throw new ApiError("Status must be RESOLVED, CLOSED or PENDING", 400);

    const existing = await db.contactQuery.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Query not found", 404);
    assertTransition(CONTACT_QUERY_TRANSITIONS, existing.status, status, "contact query");

    const data: Record<string, unknown> = { status };
    if (status === "RESOLVED") {
      data.resolvedAt = new Date();
      data.resolvedBy = session.name;
    }

    const query = await db.contactQuery.update({ where: { id }, data });

    await logActivity(
      session.name,
      "CONTACT_QUERY_UPDATE",
      "CONTACT_QUERY",
      `${query.subject} → ${status}`,
      session.userId
    );

    return json(res, query);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/contact-queries/:id — admin removes a query
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;

    const existing = await db.contactQuery.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Query not found", 404);

    await db.contactQuery.delete({ where: { id } });

    await logActivity(
      session.name,
      "CONTACT_QUERY_DELETE",
      "CONTACT_QUERY",
      `${existing.subject} · ${existing.email}`,
      session.userId
    );

    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
