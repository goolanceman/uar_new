/**
 * Follow-up routes — /api/follow-ups, /api/follow-ups/:id
 * Converted 1:1 from src/app/api/follow-ups/* (Next.js route handlers) to Express.
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
} from "@/lib/session";
import { assertTransition } from "@/lib/workflow";

export const router = Router();

const log = logger.child("follow-ups");

const VALID_STATUSES = ["DONE", "MISSED", "CANCELLED"];
// PENDING opens; DONE/MISSED/CANCELLED are terminal — no reopen, no relabel.
const TRANSITIONS: Record<string, string[]> = {
  PENDING: ["DONE", "MISSED", "CANCELLED"],
  DONE: [],
  MISSED: [],
  CANCELLED: [],
};

function pageParams(url: URL, defLimit = 50) {
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(url.searchParams.get("limit")) || defLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

function optText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

const FOLLOWUP_INCLUDE = {
  beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
  camp: { select: { id: true, code: true, title: true } },
  referral: { select: { id: true, code: true, status: true, priority: true } },
} as const;

// GET /api/follow-ups — ADMIN | DOCTOR | NURSE | VOLUNTEER; BENEFICIARY own.
// Filters: beneficiaryId, status, overdue=1 (dueDate in the past & PENDING).
router.get("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR", "NURSE", "VOLUNTEER", "BENEFICIARY");
    const url = new URL(req.url, "http://localhost");
    const { page, limit, skip } = pageParams(url);

    const where: Record<string, unknown> = {};
    for (const f of ["beneficiaryId", "status"]) {
      const v = url.searchParams.get(f);
      if (v) where[f] = v;
    }
    if (session.role === "BENEFICIARY") {
      const own = await db.beneficiary.findUnique({ where: { userId: session.userId }, select: { id: true } });
      if (!own) return json(res, { items: [], total: 0, page: 1, pages: 1 });
      where.beneficiaryId = own.id;
    }
    if (url.searchParams.get("overdue") === "1") {
      where.status = "PENDING";
      where.dueDate = { lt: new Date() };
    }

    const overdueOnly = where.dueDate !== undefined;

    const [total, items] = await Promise.all([
      db.followUp.count({ where }),
      db.followUp.findMany({
        where,
        include: FOLLOWUP_INCLUDE,
        orderBy: overdueOnly ? { dueDate: "asc" } : { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/follow-ups — DOCTOR | ADMIN | NURSE.
// { beneficiaryId, campId?, referralId?, dueDate, instructions?, ownerName? }
// → status PENDING.
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "DOCTOR", "ADMIN", "NURSE");
    const body = req.body ?? {};

    const beneficiaryId = String(body?.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await db.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { id: true, code: true },
    });
    if (!beneficiary) {
      log.warn("follow_up_beneficiary_not_found", {
        beneficiaryId,
        actor: session.userId,
      });
      throw new ApiError("Beneficiary not found", 404);
    }

    const dueDate = body?.dueDate ? new Date(String(body.dueDate)) : null;
    if (!dueDate || Number.isNaN(dueDate.getTime()))
      throw new ApiError("A valid dueDate is required", 400);

    const campId = optText(body?.campId);
    if (campId) {
      const camp = await db.medicalCamp.findUnique({ where: { id: campId }, select: { id: true } });
      if (!camp) {
        log.warn("follow_up_camp_not_found", { campId, actor: session.userId });
        throw new ApiError("Camp not found", 404);
      }
    }
    const referralId = optText(body?.referralId);
    if (referralId) {
      const ref = await db.medicalReferral.findUnique({
        where: { id: referralId },
        select: { id: true },
      });
      if (!ref) {
        log.warn("follow_up_referral_not_found", {
          referralId,
          actor: session.userId,
        });
        throw new ApiError("Referral not found", 404);
      }
    }

    const followUp = await db.followUp.create({
      data: {
        beneficiaryId,
        campId,
        referralId,
        dueDate,
        instructions: optText(body?.instructions),
        ownerName: optText(body?.ownerName),
        status: "PENDING",
      },
      include: FOLLOWUP_INCLUDE,
    });

    log.info("follow_up_created", {
      followUpId: followUp.id,
      beneficiaryId,
      ...(campId ? { campId } : {}),
      ...(referralId ? { referralId } : {}),
      dueDate: dueDate.toISOString().slice(0, 10),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "FOLLOWUP_CREATE",
      "FOLLOW_UP",
      `Follow-up for ${beneficiary.code} due ${dueDate.toISOString().slice(0, 10)}`,
      session.userId
    );

    return json(res, followUp, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/follow-ups/:id — ADMIN | DOCTOR | NURSE | VOLUNTEER.
router.get("/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "DOCTOR", "NURSE", "VOLUNTEER");
    const { id } = req.params;
    const followUp = await db.followUp.findUnique({
      where: { id },
      include: {
        beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
        camp: { select: { id: true, code: true, title: true } },
        referral: { select: { id: true, code: true, status: true, priority: true } },
      },
    });
    if (!followUp) throw new ApiError("Follow-up not found", 404);
    return json(res, followUp);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/follow-ups/:id — ADMIN | DOCTOR | NURSE | VOLUNTEER.
// { status: DONE | MISSED | CANCELLED, outcome? } — DONE stamps doneAt.
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR", "NURSE", "VOLUNTEER");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.followUp.findUnique({ where: { id } });
    if (!existing) {
      log.warn("follow_up_update_not_found", { followUpId: id, actor: session.userId });
      throw new ApiError("Follow-up not found", 404);
    }

    const data: Record<string, unknown> = {};
    if (body?.status !== undefined) {
      const status = String(body.status).trim().toUpperCase();
      if (!VALID_STATUSES.includes(status))
        throw new ApiError(`status must be one of: ${VALID_STATUSES.join(", ")}`, 400);
      if (existing.status !== status && !TRANSITIONS[existing.status]?.includes(status))
        log.warn("follow_up_invalid_transition", {
          followUpId: id,
          from: existing.status,
          to: status,
          actor: session.userId,
        });
      assertTransition(TRANSITIONS, existing.status, status, "follow-up");
      data.status = status;
      if (status === "DONE") data.doneAt = new Date();
      else data.doneAt = null;
    }
    if (body?.outcome !== undefined) data.outcome = optText(body.outcome);

    if (Object.keys(data).length === 0) throw new ApiError("Nothing to update", 400);

    const followUp = await db.followUp.update({
      where: { id },
      data,
      include: {
        beneficiary: { select: { id: true, code: true, name: true } },
        camp: { select: { id: true, code: true, title: true } },
        referral: { select: { id: true, code: true, status: true } },
      },
    });

    log.info("follow_up_updated", {
      followUpId: id,
      fields: Object.keys(data),
      ...(data.status !== undefined ? { newStatus: followUp.status } : {}),
      actor: session.userId,
    });

    const done = data.status === "DONE";
    await logActivity(
      session.name,
      done ? "FOLLOWUP_DONE" : "FOLLOWUP_UPDATE",
      "FOLLOW_UP",
      `Follow-up for ${followUp.beneficiary.code} — ${done ? "completed" : `status ${followUp.status}`}`,
      session.userId
    );

    return json(res, followUp);
  } catch (e) {
    return handleError(e, res);
  }
});
