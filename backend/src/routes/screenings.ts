/**
 * Screening routes — /api/screenings
 * Converted 1:1 from src/app/api/screenings/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import {
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";

export const router = Router();

const VALID_TYPES = [
  "EYE", "DENTAL", "BP", "GLUCOSE", "HEARING", "SKIN", "NUTRITION", "GENERAL", "OTHER",
];

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

// GET /api/screenings — ADMIN | DOCTOR | NURSE.
// Filters: beneficiaryId, campId, encounterId, type, abnormal=1/0.
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "DOCTOR", "NURSE");
    const url = new URL(req.url, "http://localhost");
    const { page, limit, skip } = pageParams(url);

    const where: Record<string, unknown> = {};
    for (const f of ["beneficiaryId", "campId", "encounterId", "type"]) {
      const v = url.searchParams.get(f);
      if (v) {
        if (f === "type" && !VALID_TYPES.includes(v))
          throw new ApiError("Invalid screening type", 400);
        where[f] = v;
      }
    }
    const abnormal = url.searchParams.get("abnormal");
    if (abnormal === "1" || abnormal === "0") where.abnormal = abnormal === "1";

    const [total, items] = await Promise.all([
      db.screeningRecord.count({ where }),
      db.screeningRecord.findMany({
        where,
        include: {
          beneficiary: { select: { id: true, code: true, name: true } },
          camp: { select: { id: true, code: true, title: true } },
        },
        orderBy: { recordedAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return json(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/screenings — ADMIN | DOCTOR | NURSE.
// { campId?, beneficiaryId, encounterId?, type, result, abnormal?, notes? }
// Screening observations only — these records never constitute a diagnosis.
// NOTE: the ScreeningRecord table has no notes column yet — `notes` is
// accepted in the payload but not persisted (schema-change request filed).
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "DOCTOR", "NURSE");
    const body = req.body ?? {};

    const beneficiaryId = String(body?.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await db.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { id: true, code: true },
    });
    if (!beneficiary) throw new ApiError("Beneficiary not found", 404);

    const result = optText(body?.result);
    if (!result) throw new ApiError("result is required", 400);

    const type = String(body?.type ?? "GENERAL").trim().toUpperCase();
    if (!VALID_TYPES.includes(type))
      throw new ApiError(`type must be one of: ${VALID_TYPES.join(", ")}`, 400);

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

    const screening = await db.screeningRecord.create({
      data: {
        beneficiaryId,
        campId,
        encounterId,
        type,
        result,
        abnormal: Boolean(body?.abnormal),
        recordedByName: session.name,
      },
      include: { beneficiary: { select: { id: true, code: true, name: true } } },
    });

    await logActivity(
      session.name,
      "SCREENING_RECORD",
      "SCREENING",
      `${type} screening for ${beneficiary.code} — ${screening.abnormal ? "ABNORMAL" : "normal"}`,
      session.userId
    );

    return json(res, screening, 201);
  } catch (e) {
    return handleError(e, res);
  }
});
