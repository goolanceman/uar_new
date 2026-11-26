/**
 * Medical document routes — /api/medical-documents, /api/medical-documents/:id
 * Converted 1:1 from src/app/api/medical-documents/* (Next.js route handlers) to Express.
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

export const router = Router();

const VALID_KINDS = ["PRESCRIPTION", "LAB_REPORT", "DISCHARGE_SUMMARY", "REFERRAL", "OTHER"];
// File-manager assets (/api/files/:id/file) or absolute http(s) URLs only —
// blocks javascript:/data: injection vectors.
const URL_RE = /^(\/api\/files\/[\w-]+\/file)|^https?:\/\//;

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

// GET /api/medical-documents?beneficiaryId= — ADMIN | DOCTOR | NURSE (all);
// BENEFICIARY role sees documents of their own patient record only.
router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const staffRoles = ["ADMIN", "DOCTOR", "NURSE"];
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
      const beneficiaryId = url.searchParams.get("beneficiaryId");
      if (beneficiaryId) where.beneficiaryId = beneficiaryId;
    }

    const [total, items] = await Promise.all([
      db.medicalDocument.count({ where }),
      db.medicalDocument.findMany({
        where,
        include: {
          beneficiary: { select: { id: true, code: true, name: true } },
          camp: { select: { id: true, code: true, title: true } },
        },
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

// POST /api/medical-documents — ADMIN | DOCTOR | NURSE; BENEFICIARY adds to
// their own patient record only. { beneficiaryId, campId?, name, kind, url }
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR", "NURSE", "BENEFICIARY");
    const body = req.body ?? {};

    let beneficiaryId = String(body?.beneficiaryId ?? "").trim();
    if (session.role === "BENEFICIARY") {
      const own = await db.beneficiary.findUnique({ where: { userId: session.userId }, select: { id: true } });
      if (!own) throw new ApiError("No patient record is linked to your account yet", 403);
      beneficiaryId = own.id;
    }
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await db.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { id: true, code: true },
    });
    if (!beneficiary) throw new ApiError("Beneficiary not found", 404);

    const name = optText(body?.name);
    if (!name) throw new ApiError("name is required", 400);

    const urlStr = optText(body?.url);
    if (!urlStr) throw new ApiError("url is required", 400);
    if (!URL_RE.test(urlStr))
      throw new ApiError("url must be a /api/files/:id/file URL or an http(s) URL", 400);

    const kind = String(body?.kind ?? "OTHER").trim().toUpperCase();
    if (!VALID_KINDS.includes(kind))
      throw new ApiError(`kind must be one of: ${VALID_KINDS.join(", ")}`, 400);

    const campId = optText(body?.campId);
    if (campId) {
      const camp = await db.medicalCamp.findUnique({ where: { id: campId }, select: { id: true } });
      if (!camp) throw new ApiError("Camp not found", 404);
    }

    const document = await db.medicalDocument.create({
      data: {
        beneficiaryId,
        campId,
        name,
        kind,
        url: urlStr,
        uploadedByName: session.name,
      },
      include: {
        beneficiary: { select: { id: true, code: true, name: true } },
        camp: { select: { id: true, code: true, title: true } },
      },
    });

    await logActivity(
      session.name,
      "DOCUMENT_ADD",
      "MEDICAL_DOCUMENT",
      `${kind} "${name}" added for ${beneficiary.code}`,
      session.userId
    );

    return json(res, document, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/medical-documents/:id — ADMIN | DOCTOR | NURSE, plus the
// BENEFICIARY account linked to the patient record itself.
router.get("/:id", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const allowed = ["ADMIN", "DOCTOR", "NURSE", "BENEFICIARY"];
    if (!allowed.includes(session.role))
      throw new ApiError("You do not have permission for this action", 403);

    const { id } = req.params;
    const document = await db.medicalDocument.findUnique({
      where: { id },
      include: {
        beneficiary: { select: { id: true, code: true, name: true } },
        camp: { select: { id: true, code: true, title: true } },
      },
    });
    if (!document) throw new ApiError("Document not found", 404);

    if (session.role === "BENEFICIARY") {
      const own = await db.beneficiary.findUnique({
        where: { userId: session.userId },
        select: { id: true },
      });
      if (!own || own.id !== document.beneficiaryId)
        throw new ApiError("You do not have permission for this action", 403);
    }

    return json(res, document);
  } catch (e) {
    return handleError(e, res);
  }
});

// DELETE /api/medical-documents/:id — ADMIN only.
router.delete("/:id", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const { id } = req.params;

    const existing = await db.medicalDocument.findUnique({
      where: { id },
      include: { beneficiary: { select: { code: true } } },
    });
    if (!existing) throw new ApiError("Document not found", 404);

    await db.medicalDocument.delete({ where: { id } });

    await logActivity(
      session.name,
      "DOCUMENT_DELETE",
      "MEDICAL_DOCUMENT",
      `"${existing.name}" (${existing.kind}) removed from ${existing.beneficiary.code}`,
      session.userId
    );

    return json(res, { ok: true });
  } catch (e) {
    return handleError(e, res);
  }
});
