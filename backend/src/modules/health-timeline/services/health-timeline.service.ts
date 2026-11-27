/**
 * Health-timeline service — merges encounters, vitals, screenings,
 * prescriptions, lab orders, referrals, follow-ups, documents and camp
 * attendances into one descending list, capped at 200 entries. The legacy
 * per-kind summaries and merge order are preserved verbatim, including the
 * BENEFICIARY self-lookup before the "beneficiaryId is required" check.
 *
 * generatedBy: "system" — this is a mechanical merge, NOT AI output.
 */
import { ApiError } from "@/shared/errors";
import type { Session } from "@/infrastructure/auth/session";
import type {
  HealthTimelineRepository,
} from "../repositories/health-timeline.repository.interface";

const LIMIT = 200;

type Entry = { kind: string; at: Date; summary: string; data: Record<string, unknown> };

export interface HealthTimelinePayload {
  items: Entry[];
  total: number;
  generatedBy: string;
  beneficiary: { id: string; code: string; name: string } | null;
}

export class HealthTimelineService {
  constructor(private readonly healthTimelineRepository: HealthTimelineRepository) {}

  /** GET /api/health-timeline?beneficiaryId= — the unified chronology. The
   *  session role was already gated by the route's authorize() middleware
   *  (same roles, same 403, as the legacy inline check). */
  async timeline(session: Session, beneficiaryIdRaw: string): Promise<HealthTimelinePayload> {
    let beneficiaryId = beneficiaryIdRaw;

    if (session.role === "BENEFICIARY") {
      const own = await this.healthTimelineRepository.findBeneficiaryIdByUserId(session.userId);
      if (!own) return { items: [], total: 0, generatedBy: "system", beneficiary: null };
      beneficiaryId = own.id;
    }
    if (!beneficiaryId) throw new ApiError("beneficiaryId is required", 400);

    const beneficiary = await this.healthTimelineRepository.findBeneficiaryHeader(beneficiaryId);
    if (!beneficiary) throw new ApiError("Beneficiary not found", 404);

    const bundle = await this.healthTimelineRepository.loadTimeline(beneficiaryId, LIMIT);

    const entries: Entry[] = [];

    for (const e of bundle.encounters)
      entries.push({
        kind: "encounter",
        at: e.createdAt,
        summary: `Consultation with Dr. ${e.doctor.name}${e.chiefComplaint ? ` — ${e.chiefComplaint}` : ""}${e.diagnosis ? ` · Dx: ${e.diagnosis}` : ""} (${e.status})`,
        data: e as unknown as Record<string, unknown>,
      });

    for (const v of bundle.vitals) {
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

    for (const s of bundle.screenings)
      entries.push({
        kind: "screening",
        at: s.recordedAt,
        summary: `${s.type} screening — ${s.result}${s.abnormal ? " (abnormal)" : ""}`,
        data: s as unknown as Record<string, unknown>,
      });

    for (const p of bundle.prescriptions)
      entries.push({
        kind: "prescription",
        at: p.createdAt,
        summary: `Prescription ${p.code} — ${p.items.length} medicine(s) · ${p.status}`,
        data: { ...p, itemCount: p.items.length, items: undefined } as unknown as Record<string, unknown>,
      });

    for (const l of bundle.labOrders)
      entries.push({
        kind: "lab",
        at: l.createdAt,
        summary: `Lab: ${l.testName} (${l.code}) — ${l.status}${l.critical ? " · CRITICAL" : ""}`,
        data: l as unknown as Record<string, unknown>,
      });

    for (const r of bundle.referrals)
      entries.push({
        kind: "referral",
        at: r.createdAt,
        summary: `Referral ${r.code} (${r.priority}) — ${r.reason}${r.receivingOrg?.name ? ` → ${r.receivingOrg.name}` : ""} · ${r.status}`,
        data: r as unknown as Record<string, unknown>,
      });

    for (const f of bundle.followUps)
      entries.push({
        kind: "followup",
        at: f.createdAt,
        summary: `Follow-up due ${f.dueDate.toISOString().slice(0, 10)} — ${f.status}${f.ownerName ? ` (owner: ${f.ownerName})` : ""}`,
        data: f as unknown as Record<string, unknown>,
      });

    for (const d of bundle.documents)
      entries.push({
        kind: "document",
        at: d.createdAt,
        summary: `Document: ${d.name} (${d.kind})`,
        data: d as unknown as Record<string, unknown>,
      });

    for (const a of bundle.attendances)
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

    return {
      items,
      total: items.length,
      generatedBy: "system",
      beneficiary: { id: beneficiary.id, code: beneficiary.code, name: beneficiary.name },
    };
  }
}
