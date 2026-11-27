/**
 * Beneficiary-request routes — /api/beneficiary-requests, /api/beneficiary-requests/:id
 * Converted 1:1 from src/app/api/beneficiary-requests/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
  validateSession,
} from "@/lib/session";
import { assertTransition } from "@/lib/workflow";

export const router = Router();

const log = logger.child("beneficiary-requests");

// GET /api/beneficiary-requests — admin queue, or ?mine=1 for the caller
router.get("/", async (req, res) => {
  try {
    const sp = new URL(req.url, "http://localhost").searchParams;
    const mine = sp.get("mine") === "1";
    const status = sp.get("status");

    if (mine) {
      const s = await requireRole(req, "BENEFICIARY", "DONOR", "VOLUNTEER", "ADMIN");
      const rows = await db.beneficiaryRequest.findMany({
        where: { userId: s.userId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return json(res, rows);
    }

    await requireRole(req, "ADMIN", "VOLUNTEER");
    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const rows = await db.beneficiaryRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { beneficiary: { select: { id: true, name: true, city: true } } },
    });
    return json(res, rows);
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/beneficiary-requests — beneficiary submits a help request
router.post("/", async (req, res) => {
  try {
    const session = await validateSession(req);
    const body = req.body ?? {};

    const name = String(body?.name ?? "").trim();
    const details = String(body?.details ?? "").trim();
    if (!name || !details)
      throw new ApiError("Name and request details are required", 400);

    const urgency = String(body?.urgency ?? "MEDIUM").toUpperCase();
    if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(urgency))
      throw new ApiError("Invalid urgency level", 400);

    // Link to the caller's beneficiary record when one exists
    const linked = session
      ? await db.beneficiary.findUnique({ where: { userId: session.userId } })
      : null;

    const row = await db.beneficiaryRequest.create({
      data: {
        beneficiaryId: body?.beneficiaryId
          ? String(body.beneficiaryId)
          : linked?.id ?? null,
        userId: session?.userId ?? null,
        name,
        phone: body?.phone ? String(body.phone).trim() : null,
        category: body?.category ? String(body.category) : "OTHER",
        urgency,
        details,
      },
    });

    log.info("beneficiary_request_created", {
      requestId: row.id,
      category: row.category,
      urgency: row.urgency,
      ...(row.beneficiaryId ? { beneficiaryId: row.beneficiaryId } : {}),
      ...(session ? { actor: session.userId } : {}),
    });

    return json(res, row, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

const VALID_STATUSES = ["PENDING", "IN_REVIEW", "APPROVED", "FULFILLED", "REJECTED"];
// Review machine: triage → decide → fulfil. FULFILLED/REJECTED are terminal.
// (The food-assistance flow updates requests programmatically — a direct db
// write with its own reopen guard — and intentionally bypasses this table.)
const TRANSITIONS: Record<string, string[]> = {
  PENDING: ["IN_REVIEW", "APPROVED", "REJECTED"],
  IN_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["FULFILLED"],
  FULFILLED: [],
  REJECTED: [],
};

// PATCH /api/beneficiary-requests/:id — admin reviews a request
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "VOLUNTEER");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.beneficiaryRequest.findUnique({ where: { id } });
    if (!existing) {
      log.warn("beneficiary_request_update_not_found", { requestId: id, actor: session.userId });
      throw new ApiError("Request not found", 404);
    }

    const data: Record<string, unknown> = {};
    if (body?.status !== undefined) {
      const status = String(body.status).toUpperCase();
      if (!VALID_STATUSES.includes(status))
        throw new ApiError("Invalid request status", 400);
      if (existing.status !== status && !TRANSITIONS[existing.status]?.includes(status))
        log.warn("beneficiary_request_invalid_transition", {
          requestId: id,
          from: existing.status,
          to: status,
          actor: session.userId,
        });
      assertTransition(TRANSITIONS, existing.status, status, "beneficiary request", 400);
      data.status = status;
      data.reviewedBy = session.name;
      data.reviewedAt = new Date();
    }
    if (body?.reviewNote !== undefined)
      data.reviewNote = body.reviewNote ? String(body.reviewNote) : null;
    if (body?.urgency !== undefined) {
      const u = String(body.urgency).toUpperCase();
      if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(u))
        throw new ApiError("Invalid urgency level", 400);
      data.urgency = u;
    }

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const row = await db.beneficiaryRequest.update({ where: { id }, data });

    log.info("beneficiary_request_reviewed", {
      requestId: id,
      ...(data.status !== undefined ? { from: existing.status, to: row.status } : { fields: Object.keys(data) }),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "BENEFICIARY_REQUEST_REVIEW",
      "BENEFICIARY_REQUEST",
      `${row.name}: ${row.status}`,
      session.userId
    );

    return json(res, row);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/beneficiary-requests/:id
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;
    const existing = await db.beneficiaryRequest.findUnique({ where: { id } });
    if (!existing) {
      log.warn("beneficiary_request_delete_not_found", { requestId: id, actor: session.userId });
      throw new ApiError("Request not found", 404);
    }
    await db.beneficiaryRequest.delete({ where: { id } });
    log.info("beneficiary_request_deleted", {
      requestId: id,
      status: existing.status,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "BENEFICIARY_REQUEST_DELETE",
      "BENEFICIARY_REQUEST",
      existing.name,
      session.userId
    );
    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
