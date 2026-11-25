/**
 * Lab order routes — /api/lab-orders, /api/lab-orders/:id
 * Converted 1:1 from src/app/api/lab-orders/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";
import { nextLabCode } from "@/lib/health-codes";
import { LAB_ORDER_NEXT } from "@/lib/lab-orders";

export const router = Router();

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

const ORDER_INCLUDE = {
  beneficiary: { select: { id: true, code: true, name: true, age: true, gender: true } },
  camp: { select: { id: true, code: true, title: true } },
  encounter: { select: { id: true, status: true, diagnosis: true } },
} as const;

// Enforced linear state machine — transition table lives in @/lib/lab-orders
// (shared with the lab-tech queue UI so the two can never drift).

/** File-manager assets (/api/files/:id/file) or absolute https URLs only. */
const FILE_URL_RE = /^(\/api\/files\/[\w-]+\/file)|^https?:\/\//;

// GET /api/lab-orders — ADMIN | DOCTOR | LAB_TECH | NURSE (BENEFICIARY sees
// own orders only). Filters: beneficiaryId, campId, status, q (code/testName).
router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const staffRoles = ["ADMIN", "DOCTOR", "LAB_TECH", "NURSE"];
    if (!staffRoles.includes(session.role) && session.role !== "BENEFICIARY")
      throw new ApiError("You do not have permission for this action", 403);

    const url = new URL(req.url, "http://localhost");
    const { page, limit, skip } = pageParams(url);

    const where: Record<string, unknown> = {};
    if (session.role === "BENEFICIARY") {
      const own = await db.beneficiary.findUnique({
        where: { userId: session.userId },
        select: { id: true },
      });
      if (!own) return json(res, { items: [], total: 0, page: 1, pages: 1 });
      where.beneficiaryId = own.id;
    } else {
      for (const f of ["beneficiaryId", "campId", "status"]) {
        const v = url.searchParams.get(f);
        if (v) where[f] = v;
      }
    }
    const q = url.searchParams.get("q");
    if (q) where.OR = [{ code: { contains: q } }, { testName: { contains: q } }];

    const [total, items] = await Promise.all([
      db.diagnosticOrder.count({ where }),
      db.diagnosticOrder.findMany({
        where,
        include: ORDER_INCLUDE,
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

// POST /api/lab-orders — DOCTOR | ADMIN.
// { beneficiaryId, campId?, encounterId?, testName } → code UAR-LAB-NNNNN,
// status ORDERED, orderedByName.
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
    if (!beneficiary) throw new ApiError("Beneficiary not found", 404);

    const testName = optText(body?.testName);
    if (!testName) throw new ApiError("testName is required", 400);

    const campId = optText(body?.campId);
    if (campId) {
      const camp = await db.medicalCamp.findUnique({ where: { id: campId }, select: { id: true } });
      if (!camp) throw new ApiError("Camp not found", 404);
    }
    const encounterId = optText(body?.encounterId);
    if (encounterId) {
      const enc = await db.encounter.findUnique({ where: { id: encounterId }, select: { id: true } });
      if (!enc) throw new ApiError("Encounter not found", 404);
    }

    const code = await nextLabCode();
    const order = await db.diagnosticOrder.create({
      data: {
        code,
        beneficiaryId,
        campId,
        encounterId,
        testName,
        status: "ORDERED",
        orderedByName: session.name,
      },
      include: ORDER_INCLUDE,
    });

    await logActivity(
      session.name,
      "LAB_ORDER_CREATE",
      "LAB_ORDER",
      `${code} — ${testName} for ${beneficiary.code}`,
      session.userId
    );

    return json(res, order, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/lab-orders/:id — ADMIN | DOCTOR | LAB_TECH | NURSE.
router.get("/:id", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "DOCTOR", "LAB_TECH", "NURSE");
    const { id } = req.params;
    const order = await db.diagnosticOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new ApiError("Lab order not found", 404);
    return json(res, order);
  } catch (e) {
    return handleError(e, res);
  }
});

// PATCH /api/lab-orders/:id — enforced transitions:
//   ORDERED→SAMPLE_COLLECTED (collectedAt) →RECEIVED→PROCESSING
//   →RESULT_AVAILABLE (resultText / resultFileUrl)   [LAB_TECH | ADMIN]
//   RESULT_AVAILABLE→VERIFIED (verifiedByName/verifiedAt)  [LAB_TECH | ADMIN]
//   VERIFIED→DOCTOR_REVIEWED (reviewedAt)                  [DOCTOR | ADMIN]
// `critical` may be set by DOCTOR | ADMIN alongside a transition or alone.
router.patch("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR", "LAB_TECH");
    const { id } = req.params;
    const body = req.body ?? {};

    const existing = await db.diagnosticOrder.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Lab order not found", 404);

    const isAdmin = session.role === "ADMIN";
    const isLabTech = session.role === "LAB_TECH";
    const isDoctor = session.role === "DOCTOR";

    const data: Record<string, unknown> = {};

    // resultFileUrl is validated whenever provided (transition or standalone
    // correction): file-manager assets (/api/files/:id/file) or https only.
    if (body?.resultFileUrl !== undefined) {
      const resultFileUrl = optText(body?.resultFileUrl);
      if (resultFileUrl && !FILE_URL_RE.test(resultFileUrl))
        throw new ApiError("resultFileUrl must be a /api/files/:id/file URL or an https URL", 400);
      if (!isLabTech && !isAdmin)
        throw new ApiError("Only lab staff (or an admin) can attach result files", 403);
      if (resultFileUrl !== null) data.resultFileUrl = resultFileUrl;
    }

    // ── status transition ──────────────────────────────────────────────────
    if (body?.status !== undefined && String(body.status) !== existing.status) {
      const target = String(body.status);
      const expected = LAB_ORDER_NEXT[existing.status];
      if (!expected)
        throw new ApiError(
          `Lab order ${existing.code} is already ${existing.status} — no further transitions`,
          409
        );
      if (target !== expected)
        throw new ApiError(
          `Invalid transition ${existing.status} → ${target}. Expected ${existing.status} → ${expected}`,
          409
        );
      if (target === "DOCTOR_REVIEWED") {
        if (!isDoctor && !isAdmin)
          throw new ApiError("Only a doctor (or an admin) can mark a result DOCTOR_REVIEWED", 403);
        data.reviewedAt = new Date();
      } else {
        if (!isLabTech && !isAdmin)
          throw new ApiError(`Only lab staff (or an admin) can move an order to ${target}`, 403);
        if (target === "SAMPLE_COLLECTED") data.collectedAt = new Date();
        if (target === "VERIFIED") {
          data.verifiedAt = new Date();
          data.verifiedByName = session.name;
        }
        if (target === "RESULT_AVAILABLE") {
          const resultText = optText(body?.resultText);
          if (!resultText && !data.resultFileUrl && !existing.resultText && !existing.resultFileUrl)
            throw new ApiError("Provide resultText or resultFileUrl when moving to RESULT_AVAILABLE", 400);
          if (resultText !== null) data.resultText = resultText;
        }
      }
      data.status = target;
    }

    // ── critical flag (DOCTOR | ADMIN) ─────────────────────────────────────
    if (body?.critical !== undefined) {
      if (!isDoctor && !isAdmin)
        throw new ApiError("Only a doctor (or an admin) can flag a result critical", 403);
      data.critical = Boolean(body.critical);
    }

    if (Object.keys(data).length === 0)
      throw new ApiError(
        existing.status === "VERIFIED"
          ? "Nothing to update — send { status: \"DOCTOR_REVIEWED\" } to complete doctor review"
          : "Nothing to update",
        400
      );

    const order = await db.diagnosticOrder.update({ where: { id }, data, include: ORDER_INCLUDE });

    const changed = data.status !== undefined;
    await logActivity(
      session.name,
      changed ? `LAB_ORDER_${String(data.status)}` : "LAB_ORDER_UPDATE",
      "LAB_ORDER",
      `${existing.code} (${existing.testName}) — ${changed ? `${existing.status} → ${String(data.status)}` : "critical flag updated"}`,
      session.userId
    );

    return json(res, order);
  } catch (e) {
    return handleError(e, res);
  }
});
