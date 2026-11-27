/**
 * Referral routes — /api/referrals, /api/referrals/:id
 * Converted 1:1 from src/app/api/referrals/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { REFERRAL_FLOW, REFERRAL_TERMINAL_STATUSES, referralTransitions } from "@/lib/referrals";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";
import { nextRefCode } from "@/lib/health-codes";

export const router = Router();

const log = logger.child("referrals");

const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "EMERGENCY"];

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

const REFERRAL_INCLUDE = {
  beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
  camp: { select: { id: true, code: true, title: true } },
  encounter: { select: { id: true, status: true, diagnosis: true } },
  receivingOrg: { select: { id: true, name: true, type: true, city: true } },
} as const;

const REFERRAL_ID_INCLUDE = {
  beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
  camp: { select: { id: true, code: true, title: true } },
  receivingOrg: { select: { id: true, name: true, type: true, city: true } },
} as const;

// Shared workflow definition; any strictly-forward move is allowed.
const CHAIN: readonly string[] = REFERRAL_FLOW;
const TERMINAL_CANCELLED: readonly string[] = REFERRAL_TERMINAL_STATUSES;

// GET /api/referrals — ADMIN | DOCTOR | NURSE see all; HOSPITAL users see
// only referrals addressed to their own organisation; BENEFICIARY sees own.
// Filters: beneficiaryId, status, priority.
router.get("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR", "NURSE", "HOSPITAL", "BENEFICIARY");
    const url = new URL(req.url, "http://localhost");
    const { page, limit, skip } = pageParams(url);

    const where: Record<string, unknown> = {};
    if (session.role === "HOSPITAL") {
      const org = await db.healthcareOrg.findUnique({
        where: { ownerUserId: session.userId },
        select: { id: true, name: true },
      });
      if (!org)
        throw new ApiError("No healthcare organisation is linked to your account", 403);
      where.receivingOrgId = org.id;
    } else if (session.role === "BENEFICIARY") {
      const own = await db.beneficiary.findUnique({ where: { userId: session.userId }, select: { id: true } });
      if (!own) return json(res, { items: [], total: 0, page: 1, pages: 1 });
      where.beneficiaryId = own.id;
    } else {
      for (const f of ["beneficiaryId", "status", "priority"]) {
        const v = url.searchParams.get(f);
        if (v) where[f] = v;
      }
    }

    const [total, items] = await Promise.all([
      db.medicalReferral.count({ where }),
      db.medicalReferral.findMany({
        where,
        include: REFERRAL_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/referrals — DOCTOR | ADMIN.
// { beneficiaryId, campId?, encounterId?, reason, priority, receivingOrgId?,
//   speciality? } → code UAR-REF-NNNNN, status CREATED.
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "DOCTOR", "ADMIN");
    const body = req.body ?? {};

    const beneficiaryId = String(body?.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await db.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { id: true, code: true },
    });
    if (!beneficiary) {
      log.warn("referral_beneficiary_not_found", {
        beneficiaryId,
        actor: session.userId,
      });
      throw new ApiError("Beneficiary not found", 404);
    }

    const reason = optText(body?.reason);
    if (!reason) throw new ApiError("reason is required", 400);

    const priority = String(body?.priority ?? "MEDIUM").trim().toUpperCase();
    if (!VALID_PRIORITIES.includes(priority))
      throw new ApiError(`priority must be one of: ${VALID_PRIORITIES.join(", ")}`, 400);

    const campId = optText(body?.campId);
    if (campId) {
      const camp = await db.medicalCamp.findUnique({ where: { id: campId }, select: { id: true } });
      if (!camp) {
        log.warn("referral_camp_not_found", { campId, actor: session.userId });
        throw new ApiError("Camp not found", 404);
      }
    }
    const encounterId = optText(body?.encounterId);
    if (encounterId) {
      const enc = await db.encounter.findUnique({ where: { id: encounterId }, select: { id: true } });
      if (!enc) {
        log.warn("referral_encounter_not_found", {
          encounterId,
          actor: session.userId,
        });
        throw new ApiError("Encounter not found", 404);
      }
    }
    const receivingOrgId = optText(body?.receivingOrgId);
    if (receivingOrgId) {
      const org = await db.healthcareOrg.findUnique({
        where: { id: receivingOrgId },
        select: { id: true },
      });
      if (!org) {
        log.warn("referral_org_not_found", {
          receivingOrgId,
          actor: session.userId,
        });
        throw new ApiError("Receiving organisation not found", 404);
      }
    }

    const code = await nextRefCode();
    const referral = await db.medicalReferral.create({
      data: {
        code,
        beneficiaryId,
        campId,
        encounterId,
        reason,
        priority,
        receivingOrgId,
        speciality: optText(body?.speciality),
        referralDoctorName: session.name,
        status: "CREATED",
      },
      include: REFERRAL_INCLUDE,
    });

    log.info("referral_created", {
      referralId: referral.id,
      code: referral.code,
      beneficiaryId,
      priority,
      ...(campId ? { campId } : {}),
      ...(receivingOrgId ? { receivingOrgId } : {}),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      "REFERRAL_CREATE",
      "REFERRAL",
      `${code} (${priority}) for ${beneficiary.code} — ${reason}`,
      session.userId
    );

    return json(res, referral, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/referrals/:id — ADMIN | DOCTOR | NURSE; HOSPITAL users only for
// referrals addressed to their own organisation.
router.get("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR", "NURSE", "HOSPITAL");
    const { id } = req.params;
    const referral = await db.medicalReferral.findUnique({
      where: { id },
      include: { ...REFERRAL_ID_INCLUDE, followUps: true },
    });
    if (!referral) throw new ApiError("Referral not found", 404);

    if (session.role === "HOSPITAL") {
      const org = await db.healthcareOrg.findUnique({
        where: { ownerUserId: session.userId },
        select: { id: true },
      });
      if (!org || referral.receivingOrgId !== org.id)
        throw new ApiError("You do not have permission for this action", 403);
    }

    return json(res, referral);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/referrals/:id
// - ADMIN | DOCTOR: forward status moves along
//   CREATED→SHARED→ACCEPTED→SCHEDULED→ATTENDED→REPORT_RECEIVED→COMPLETED,
//   plus CANCELLED / LOST_TO_FOLLOWUP from most states; notes may be updated.
// - The receiving organisation's HOSPITAL user may set ACCEPTED only (and only
//   on referrals addressed to their own org).
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR", "HOSPITAL");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.medicalReferral.findUnique({ where: { id } });
    if (!existing) {
      log.warn("referral_update_not_found", { referralId: id, actor: session.userId });
      throw new ApiError("Referral not found", 404);
    }

    const data: Record<string, unknown> = {};

    if (session.role === "HOSPITAL") {
      const org = await db.healthcareOrg.findUnique({
        where: { ownerUserId: session.userId },
        select: { id: true },
      });
      if (!org || existing.receivingOrgId !== org.id) {
        log.warn("referral_update_forbidden", {
          referralId: id,
          receivingOrgId: existing.receivingOrgId,
          actor: session.userId,
        });
        throw new ApiError("You do not have permission for this action", 403);
      }
      const target = String(body?.status ?? "");
      if (target !== "ACCEPTED") {
        log.warn("referral_hospital_status_forbidden", {
          referralId: id,
          to: target,
          actor: session.userId,
        });
        throw new ApiError("Hospital users may only set referral status to ACCEPTED", 403);
      }
      if (!["CREATED", "SHARED"].includes(existing.status)) {
        log.warn("referral_accept_blocked_status", {
          referralId: id,
          status: existing.status,
          actor: session.userId,
        });
        throw new ApiError(`Cannot accept a referral in status ${existing.status}`, 409);
      }
      data.status = "ACCEPTED";
    } else if (body?.status !== undefined && String(body.status) !== existing.status) {
      const target = String(body.status).trim();
      if (!CHAIN.includes(target) && !TERMINAL_CANCELLED.includes(target))
        throw new ApiError(
          `status must be a forward move along ${CHAIN.join("→")} or ${TERMINAL_CANCELLED.join("/")}`,
          400
        );
      if (!referralTransitions(existing.status).includes(target)) {
        log.warn("referral_invalid_transition", {
          referralId: id,
          code: existing.code,
          from: existing.status,
          to: target,
          actor: session.userId,
        });
        throw new ApiError(
          CHAIN.includes(target)
            ? existing.status === "CREATED"
              ? `Invalid transition CREATED → ${target}. Expected CREATED → SHARED`
              : `Invalid transition ${existing.status} → ${target} — status can only move forward`
            : existing.status === "COMPLETED"
              ? "Completed referrals cannot be cancelled"
              : `Referral is already ${existing.status} (terminal)`,
          409
        );
      }
      data.status = target;
    }

    if (body?.notes !== undefined) data.notes = optText(body.notes);

    if (Object.keys(data).length === 0)
      throw new ApiError("Nothing to update", 400);

    const referral = await db.medicalReferral.update({
      where: { id },
      data,
      include: REFERRAL_ID_INCLUDE,
    });

    log.info("referral_updated", {
      referralId: id,
      code: existing.code,
      fields: Object.keys(data),
      ...(data.status !== undefined
        ? { from: existing.status, to: String(data.status) }
        : {}),
      actor: session.userId,
    });

    await logActivity(
      session.name,
      data.status ? `REFERRAL_${String(data.status)}` : "REFERRAL_UPDATE",
      "REFERRAL",
      `${existing.code} — ${data.status ? `${existing.status} → ${String(data.status)}` : "notes updated"}`,
      session.userId
    );

    return json(res, referral);
  } catch (e) {
    return handleError(e, res);
  }
});
