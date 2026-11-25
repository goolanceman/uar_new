/**
 * Vitals routes — /api/vitals
 * Converted 1:1 from src/app/api/vitals/route.ts (Next.js route handler) to Express.
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

// Screening DATA ranges — vital observations are data capture, never
// diagnoses. Values outside these physiological plausibility windows are
// rejected so typos never reach the clinical record.
const RANGES: Record<string, [number, number]> = {
  bpSystolic: [50, 300],
  bpDiastolic: [20, 200],
  pulse: [20, 250],
  tempC: [30, 45],
  respRate: [5, 80],
  spo2: [40, 100],
  glucose: [10, 1500],
  heightCm: [20, 280],
  weightKg: [0.5, 700],
};

const INT_FIELDS = new Set(["bpSystolic", "bpDiastolic", "pulse", "respRate", "spo2"]);

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

// GET /api/vitals — ADMIN | DOCTOR | NURSE. Filters: beneficiaryId, campId,
// encounterId. Newest first.
router.get("/", async (req, res) => {
  try {
    await requireRole(req, "ADMIN", "DOCTOR", "NURSE");
    const url = new URL(req.url, "http://localhost");
    const { page, limit, skip } = pageParams(url);

    const where: Record<string, unknown> = {};
    for (const f of ["beneficiaryId", "campId", "encounterId"]) {
      const v = url.searchParams.get(f);
      if (v) where[f] = v;
    }

    const [total, items] = await Promise.all([
      db.vitalObservation.count({ where }),
      db.vitalObservation.findMany({
        where,
        include: { beneficiary: { select: { id: true, code: true, name: true } } },
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

// POST /api/vitals — ADMIN | NURSE | DOCTOR.
// { beneficiaryId, campId?, encounterId?, bpSystolic?, bpDiastolic?, pulse?,
//   tempC?, respRate?, spo2?, heightCm?, weightKg?, glucose?, notes? }
// BMI is computed when height + weight are given (kg/m², 1 decimal).
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN", "NURSE", "DOCTOR");
    const body = req.body ?? {};

    const beneficiaryId = String(body?.beneficiaryId ?? "").trim();
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);
    const beneficiary = await db.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { id: true, code: true },
    });
    if (!beneficiary) throw new ApiError("Beneficiary not found", 404);

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

    const data: Record<string, unknown> = { beneficiaryId, campId, encounterId };
    for (const field of Object.keys(RANGES)) {
      const raw = body?.[field];
      if (raw === undefined || raw === null || raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n))
        throw new ApiError(`${field} must be a number`, 400);
      const [min, max] = RANGES[field];
      if (n < min || n > max)
        throw new ApiError(`${field} must be between ${min} and ${max}`, 400);
      data[field] = INT_FIELDS.has(field) ? Math.round(n) : n;
    }

    const heightCm = data.heightCm as number | undefined;
    const weightKg = data.weightKg as number | undefined;
    if (heightCm && weightKg) {
      const bmi = weightKg / Math.pow(heightCm / 100, 2);
      data.bmi = Math.round(bmi * 10) / 10;
    }

    const vital = await db.vitalObservation.create({
      data: {
        ...data,
        recordedByName: session.name,
      } as {
        beneficiaryId: string;
        campId: string | null;
        encounterId: string | null;
        recordedByName: string;
        [k: string]: unknown;
      },
      include: { beneficiary: { select: { id: true, code: true, name: true } } },
    });

    await logActivity(
      session.name,
      "VITALS_RECORD",
      "VITALS",
      `Vitals recorded for ${beneficiary.code}`,
      session.userId
    );

    return json(res, vital, 201);
  } catch (e) {
    return handleError(e, res);
  }
});
