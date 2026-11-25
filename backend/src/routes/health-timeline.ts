/**
 * Health timeline route — /api/health-timeline
 * Converted 1:1 from src/app/api/health-timeline/route.ts (Next.js route handler) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { requireAuth, ApiError, json, handleError } from "@/lib/session";

export const router = Router();

// GET /api/health-timeline?beneficiaryId= — ADMIN | DOCTOR | NURSE;
// BENEFICIARY role sees its own chronology. Merges encounters, vitals,
// screenings, prescriptions, lab orders, referrals, follow-ups, documents and
// camp attendances into one descending list, capped at 200 entries.
// generatedBy: "system" — this is a mechanical merge, NOT AI output.
const LIMIT = 200;

router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const allowed = ["ADMIN", "DOCTOR", "NURSE", "BENEFICIARY"];
    if (!allowed.includes(session.role))
      throw new ApiError("You do not have permission for this action", 403);

    const url = new URL(req.url, "http://localhost");
    let beneficiaryId = url.searchParams.get("beneficiaryId") ?? "";

    if (session.role === "BENEFICIARY") {
      const own = await db.beneficiary.findUnique({
        where: { userId: session.userId },
        select: { id: true },
      });
      if (!own) return json(res, { items: [], total: 0, generatedBy: "system", beneficiary: null });
      beneficiaryId = own.id;
    }
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);

    const beneficiary = await db.beneficiary.findUnique({
      where: { id: beneficiaryId },
      select: { id: true, code: true, name: true },
    });
    if (!beneficiary) throw new ApiError("Beneficiary not found", 404);

    const [
      encounters, vitals, screenings, prescriptions, labOrders, referrals, followUps, documents, attendances,
    ] = await Promise.all([
      db.encounter.findMany({
        where: { beneficiaryId },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: {
          id: true, createdAt: true, status: true, chiefComplaint: true, diagnosis: true, followUpDate: true,
          doctor: { select: { name: true } },
          camp: { select: { title: true } },
        },
      }),
      db.vitalObservation.findMany({
        where: { beneficiaryId },
        orderBy: { recordedAt: "desc" },
        take: LIMIT,
        select: {
          id: true, recordedAt: true, bpSystolic: true, bpDiastolic: true, pulse: true,
          tempC: true, respRate: true, spo2: true, bmi: true, glucose: true, recordedByName: true,
        },
      }),
      db.screeningRecord.findMany({
        where: { beneficiaryId },
        orderBy: { recordedAt: "desc" },
        take: LIMIT,
        select: { id: true, recordedAt: true, type: true, result: true, abnormal: true, recordedByName: true },
      }),
      db.prescription.findMany({
        where: { beneficiaryId },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: {
          id: true, code: true, createdAt: true, status: true, diagnosis: true, signedByName: true,
          items: { select: { id: true } },
        },
      }),
      db.diagnosticOrder.findMany({
        where: { beneficiaryId },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: { id: true, code: true, createdAt: true, testName: true, status: true, critical: true },
      }),
      db.medicalReferral.findMany({
        where: { beneficiaryId },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: {
          id: true, code: true, createdAt: true, reason: true, priority: true, status: true,
          receivingOrg: { select: { name: true } },
        },
      }),
      db.followUp.findMany({
        where: { beneficiaryId },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: { id: true, createdAt: true, dueDate: true, instructions: true, status: true, ownerName: true },
      }),
      db.medicalDocument.findMany({
        where: { beneficiaryId },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: { id: true, createdAt: true, name: true, kind: true, url: true, uploadedByName: true },
      }),
      db.campAttendance.findMany({
        where: { beneficiaryId, checkInAt: { not: null } },
        orderBy: { checkInAt: "desc" },
        take: LIMIT,
        select: { id: true, checkInAt: true, status: true, queueToken: true, camp: { select: { title: true, code: true } } },
      }),
    ]);

    type Entry = { kind: string; at: Date; summary: string; data: Record<string, unknown> };
    const entries: Entry[] = [];

    for (const e of encounters)
      entries.push({
        kind: "encounter",
        at: e.createdAt,
        summary: `Consultation with Dr. ${e.doctor.name}${e.chiefComplaint ? ` — ${e.chiefComplaint}` : ""}${e.diagnosis ? ` · Dx: ${e.diagnosis}` : ""} (${e.status})`,
        data: e as unknown as Record<string, unknown>,
      });

    for (const v of vitals) {
      const bits = [
        v.bpSystolic && v.bpDiastolic ? `BP ${v.bpSystolic}/${v.bpDiastolic}` : null,
        v.pulse ? `pulse ${v.pulse}` : null,
        v.tempC ? `temp ${v.tempC}°C` : null,
        v.spo2 ? `SpO₂ ${v.spo2}%` : null,
        v.respRate ? `RR ${v.respRate}` : null,
        v.bmi ? `BMI ${v.bmi}` : null,
        v.glucose ? `glucose ${v.glucose}` : null,
      ].filter(Boolean);
      entries.push({
        kind: "vitals",
        at: v.recordedAt,
        summary: `Vitals recorded${bits.length ? ` — ${bits.join(" · ")}` : ""}`,
        data: v as unknown as Record<string, unknown>,
      });
    }

    for (const s of screenings)
      entries.push({
        kind: "screening",
        at: s.recordedAt,
        summary: `${s.type} screening — ${s.result}${s.abnormal ? " (abnormal)" : ""}`,
        data: s as unknown as Record<string, unknown>,
      });

    for (const p of prescriptions)
      entries.push({
        kind: "prescription",
        at: p.createdAt,
        summary: `Prescription ${p.code} — ${p.items.length} medicine(s) · ${p.status}`,
        data: { ...p, itemCount: p.items.length, items: undefined } as unknown as Record<string, unknown>,
      });

    for (const l of labOrders)
      entries.push({
        kind: "lab",
        at: l.createdAt,
        summary: `Lab: ${l.testName} (${l.code}) — ${l.status}${l.critical ? " · CRITICAL" : ""}`,
        data: l as unknown as Record<string, unknown>,
      });

    for (const r of referrals)
      entries.push({
        kind: "referral",
        at: r.createdAt,
        summary: `Referral ${r.code} (${r.priority}) — ${r.reason}${r.receivingOrg?.name ? ` → ${r.receivingOrg.name}` : ""} · ${r.status}`,
        data: r as unknown as Record<string, unknown>,
      });

    for (const f of followUps)
      entries.push({
        kind: "followup",
        at: f.createdAt,
        summary: `Follow-up due ${f.dueDate.toISOString().slice(0, 10)} — ${f.status}${f.ownerName ? ` (owner: ${f.ownerName})` : ""}`,
        data: f as unknown as Record<string, unknown>,
      });

    for (const d of documents)
      entries.push({
        kind: "document",
        at: d.createdAt,
        summary: `Document: ${d.name} (${d.kind})`,
        data: d as unknown as Record<string, unknown>,
      });

    for (const a of attendances)
      entries.push({
        kind: "attendance",
        at: a.checkInAt as Date,
        summary: `Camp attendance — ${a.camp?.title ?? "camp"} (${a.status})`,
        data: a as unknown as Record<string, unknown>,
      });

    entries.sort((a, b) => b.at.getTime() - a.at.getTime());
    const items = entries.slice(0, LIMIT).map((e) => ({
      kind: e.kind,
      at: e.at,
      summary: e.summary,
      data: e.data,
    }));

    return json(res, {
      items,
      total: items.length,
      generatedBy: "system",
      beneficiary: { id: beneficiary.id, code: beneficiary.code, name: beneficiary.name },
    });
  } catch (e) {
    return handleError(e, res);
  }
});
