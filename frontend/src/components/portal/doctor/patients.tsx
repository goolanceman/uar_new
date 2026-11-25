"use client";

/**
 * Doctor portal — Patients. Beneficiary search + recent encounters, and an
 * in-page patient workbench: identity card (allergies/meds highlighted),
 * medical timeline, vitals, AI consult draft (never auto-applied), encounter
 * create/edit, and a locking SIGN action with amendment trail.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  FileText,
  FlaskConical,
  HeartPulse,
  Sparkles,
  Stethoscope,
  TriangleAlert,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch, post } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheet } from "@/components/shared/form-sheet";
import { FieldGrid, TextareaField, TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ageSexLine,
  asArray,
  beneficiaryCode,
  ListSkeleton,
  medTone,
  NoteBanner,
  QuietEmpty,
  toastError,
  useBeneficiarySearch,
  type BeneficiaryLite,
  type EncounterRow,
  type TimelineItem,
  type VitalsRow,
} from "./shared";

interface EncounterDetail extends EncounterRow {
  prescriptions?: Array<{ id: string; status?: string; diagnosis?: string | null }>;
  labOrders?: Array<{ id: string; testName?: string | null; status?: string }>;
  referrals?: Array<{ id: string; status?: string; org?: { name?: string } | null }>;
}

interface EncounterForm {
  chiefComplaint: string;
  observations: string;
  diagnosis: string;
  advice: string;
  followUpDate: string;
}

const EMPTY_FORM: EncounterForm = {
  chiefComplaint: "",
  observations: "",
  diagnosis: "",
  advice: "",
  followUpDate: "",
};

export default function DoctorPatients({
  focus,
  onClearFocus,
}: {
  user: SessionUser;
  /** Beneficiary handed over from the camp queue ("start consultation"). */
  focus?: BeneficiaryLite | null;
  onClearFocus?: () => void;
}) {
  const search = useBeneficiarySearch();
  const [selected, setSelected] = useState<BeneficiaryLite | null>(null);

  const [encounters, setEncounters] = useState<EncounterRow[]>([]);
  const [detail, setDetail] = useState<EncounterDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [vitals, setVitals] = useState<VitalsRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<EncounterForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [signing, setSigning] = useState(false);

  const [aiDraft, setAiDraft] = useState<{ draft: string; disclaimer: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  /* Handoff from the camp queue — open the workbench straight away. */
  useEffect(() => {
    if (focus) {
      setSelected(focus);
      setAiDraft(null);
      setDetail(null);
    }
  }, [focus]);

  const loadPatient = useCallback(async (b: BeneficiaryLite) => {
    setLoading(true);
    setEncounters([]);
    setVitals([]);
    setTimeline([]);
    setDetail(null);
    setAiDraft(null);
    const results = await Promise.all([
      get<unknown>(`/api/encounters?beneficiaryId=${b.id}`).catch(() => []),
      get<unknown>(`/api/vitals?beneficiaryId=${b.id}`).catch(() => []),
      get<unknown>(`/api/health-timeline?beneficiaryId=${b.id}`).catch(() => []),
    ]);
    setEncounters(asArray<EncounterRow>(results[0]));
    setVitals(asArray<VitalsRow>(results[1]));
    setTimeline(asArray<TimelineItem>(results[2]));
    setLoading(false);
  }, []);

  const openWorkbench = (b: BeneficiaryLite) => {
    setSelected(b);
    void loadPatient(b);
  };

  const openDetail = async (enc: EncounterRow) => {
    setDetailLoading(true);
    try {
      const d = await get<EncounterDetail>(`/api/encounters/${enc.id}`);
      setDetail(d);
    } catch (e) {
      toastError(e, "Could not open the encounter");
      setDetail(enc);
    } finally {
      setDetailLoading(false);
    }
  };

  const startNewEncounter = () => {
    setForm(EMPTY_FORM);
    setAiDraft(null);
    setSheetOpen(true);
  };

  const editEncounter = (enc: EncounterRow) => {
    setForm({
      chiefComplaint: enc.chiefComplaint ?? "",
      observations: enc.observations ?? "",
      diagnosis: enc.diagnosis ?? "",
      advice: enc.advice ?? "",
      followUpDate: enc.followUpDate ? String(enc.followUpDate).slice(0, 10) : "",
    });
    setAiDraft(null);
    setSheetOpen(true);
  };

  const saveEncounter = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const body = {
        beneficiaryId: selected.id,
        chiefComplaint: form.chiefComplaint.trim() || undefined,
        observations: form.observations.trim() || undefined,
        diagnosis: form.diagnosis.trim() || undefined,
        advice: form.advice.trim() || undefined,
        followUpDate: form.followUpDate || undefined,
      };
      if (detail && detail.status === "DRAFT") {
        await patch(`/api/encounters/${detail.id}`, body);
        toast.success("Encounter updated");
      } else {
        const created = await post<EncounterRow>("/api/encounters", body);
        setEncounters((prev) => [created, ...prev]);
        toast.success("Encounter draft created — sign it when the note is final");
      }
      setSheetOpen(false);
      await loadPatient(selected);
    } catch (e) {
      toastError(e, "Could not save the encounter");
    } finally {
      setSaving(false);
    }
  };

  const signEncounter = async () => {
    if (!detail) return;
    setSigning(true);
    try {
      await post(`/api/encounters/${detail.id}/sign`);
      toast.success("Encounter signed and locked");
      setSignOpen(false);
      await openDetail(detail);
      if (selected) await loadPatient(selected);
    } catch (e) {
      toastError(e, "Could not sign the encounter");
    } finally {
      setSigning(false);
    }
  };

  const runAiDraft = async () => {
    if (!selected) return;
    setAiLoading(true);
    try {
      const res = await post<{ draft: string; disclaimer: string }>("/api/health-ai", {
        action: "consult-draft",
        encounterId: detail?.id,
        beneficiaryId: selected.id,
        chiefComplaint: form.chiefComplaint || detail?.chiefComplaint || undefined,
        observations: form.observations || detail?.observations || undefined,
      });
      setAiDraft({ draft: res.draft ?? "", disclaimer: res.disclaimer ?? "" });
    } catch (e) {
      toastError(e, "AI draft is unavailable right now");
    } finally {
      setAiLoading(false);
    }
  };

  const insertDraft = () => {
    if (!aiDraft?.draft) return;
    setForm((f) => ({ ...f, observations: f.observations ? `${f.observations}\n\n${aiDraft.draft}` : aiDraft.draft }));
    setSheetOpen(true);
    toast.info("Draft inserted into the note — review before signing");
  };

  const canEdit = detail ? detail.status === "DRAFT" : false;

  /* ─────────────────────────── workbench view ────────────────────────── */

  if (selected) {
    const allergy = selected.allergies ?? "";
    const meds = selected.currentMedications ?? "";
    return (
      <div className="space-y-6">
        <PageHeader
          title={selected.name}
          description={ageSexLine(selected)}
          icon={<Users className="size-5" />}
          actions={
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-1.5 sm:min-h-9"
              onClick={() => {
                setSelected(null);
                setDetail(null);
                onClearFocus?.();
              }}
              aria-label="Back to patient search"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Search
            </Button>
          }
        />

        {/* Identity card */}
        <SectionCard title="Identity" description={beneficiaryCode(selected)} icon={<Users className="size-5" />}>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <p><span className="text-muted-foreground">Age / gender: </span><span className="font-medium">{ageSexLine(selected)}</span></p>
            <p><span className="text-muted-foreground">Blood group: </span><span className="font-medium">{selected.bloodGroup || "Not on record"}</span></p>
            <p><span className="text-muted-foreground">Phone: </span><span className="font-medium">{selected.phone || "—"}</span></p>
            <p><span className="text-muted-foreground">City: </span><span className="font-medium">{selected.city || "—"}</span></p>
          </div>
          {(allergy || meds) && (
            <div className="mt-4 space-y-2">
              {allergy && (
                <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm font-medium text-red-700 dark:text-red-300" role="alert">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span><span className="font-semibold">Allergies:</span> {allergy}</span>
                </p>
              )}
              {meds && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                  <FileText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span><span className="font-semibold">Current medications:</span> {meds}</span>
                </p>
              )}
            </div>
          )}
        </SectionCard>

        {/* Encounters */}
        <SectionCard
          title="Encounters"
          description="Consultation notes — drafts are editable until signed"
          icon={<Stethoscope className="size-5" />}
          actions={
            <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={startNewEncounter}>
              <Stethoscope className="size-4" aria-hidden="true" />
              New encounter
            </Button>
          }
        >
          {loading ? (
            <ListSkeleton rows={2} />
          ) : encounters.length === 0 ? (
            <QuietEmpty
              icon={<Stethoscope className="size-5" />}
              title="No encounters yet for this patient"
              hint="Create one to start the consultation note."
            />
          ) : (
            <ul className="max-h-96 divide-y overflow-y-auto scrollbar-thin">
              {encounters.map((enc) => (
                <li key={enc.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {enc.diagnosis || enc.chiefComplaint || "Consultation"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {enc.createdAt ? formatDateTime(enc.createdAt) : ""}
                    </p>
                  </div>
                  <StatusBadge status={enc.status} tone={medTone(enc.status)} />
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    onClick={() => void openDetail(enc)}
                    aria-label={`Open encounter from ${enc.createdAt ? formatDate(enc.createdAt) : "record"}`}
                  >
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Selected encounter detail */}
        {detail && (
          <SectionCard
            title={`Encounter · ${detail.status === "SIGNED" ? "signed" : "draft"}`}
            description={detail.createdAt ? formatDateTime(detail.createdAt) : undefined}
            icon={<FileText className="size-5" />}
            actions={
              <>
                {canEdit && (
                  <Button size="sm" variant="outline" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => editEncounter(detail)}>
                    Edit note
                  </Button>
                )}
                {detail.status === "DRAFT" && (
                  <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => setSignOpen(true)}>
                    Sign encounter
                  </Button>
                )}
              </>
            }
          >
            {detailLoading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : (
              <div className="space-y-3 text-sm">
                <p><span className="text-muted-foreground">Chief complaint: </span>{detail.chiefComplaint || "—"}</p>
                <p><span className="text-muted-foreground">Observations: </span>{detail.observations || "—"}</p>
                <p><span className="text-muted-foreground">Diagnosis: </span>{detail.diagnosis || "—"}</p>
                <p><span className="text-muted-foreground">Advice: </span>{detail.advice || "—"}</p>
                <p><span className="text-muted-foreground">Follow-up: </span>{detail.followUpDate ? formatDate(detail.followUpDate) : "—"}</p>
                {detail.status === "SIGNED" && (
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Signed — this note is locked. Corrections create an amendment.
                    </p>
                    {detail.amendments ? (
                      <div className="mt-2 space-y-1.5" aria-label="Amendments (read-only)">
                        {(Array.isArray(detail.amendments) ? detail.amendments : []).map(
                          (a: { at?: string; byName?: string; note?: string } | string, i: number) => (
                            <p key={i} className="rounded-md bg-background p-2 text-xs leading-relaxed">
                              {typeof a === "string"
                                ? a
                                : `${a.note ?? ""}${a.byName ? ` — ${a.byName}` : ""}${a.at ? ` · ${formatDateTime(a.at)}` : ""}`}
                            </p>
                          )
                        )}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">No amendments recorded.</p>
                    )}
                  </div>
                )}
                {detail.prescriptions && detail.prescriptions.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Prescriptions on this encounter: {detail.prescriptions.map((p) => p.id.slice(-6)).join(", ")}
                  </p>
                )}
                {detail.labOrders && detail.labOrders.length > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
                    Lab orders linked: {detail.labOrders.length}
                  </p>
                )}
              </div>
            )}
          </SectionCard>
        )}

        {/* Vitals */}
        <SectionCard title="Vitals" description="Recorded by nurses and doctors" icon={<HeartPulse className="size-5" />}>
          {loading ? (
            <ListSkeleton rows={2} />
          ) : vitals.length === 0 ? (
            <QuietEmpty icon={<HeartPulse className="size-5" />} title="No vitals recorded yet" />
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto scrollbar-thin">
              {vitals.map((v) => (
                <li key={v.id} className="py-3 text-sm first:pt-0 last:pb-0">
                  <p className="flex flex-wrap gap-x-3 gap-y-0.5 font-medium">
                    {v.bpSystolic != null && <span>BP {v.bpSystolic}/{v.bpDiastolic ?? "—"}</span>}
                    {v.pulse != null && <span>Pulse {v.pulse}</span>}
                    {v.spo2 != null && <span>SpO₂ {v.spo2}%</span>}
                    {v.tempC != null && <span>Temp {v.tempC}°C</span>}
                    {v.heightCm != null && v.weightKg != null && <span>{v.weightKg}kg · {v.heightCm}cm{v.bmi ? ` · BMI ${v.bmi.toFixed?.(1) ?? v.bmi}` : ""}</span>}
                    {v.glucose != null && <span>Glucose {v.glucose}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {v.recordedAt || v.createdAt ? formatDateTime(v.recordedAt ?? v.createdAt) : ""}
                    {v.recordedByName ? ` · by ${v.recordedByName}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Medical timeline */}
        <SectionCard title="Medical timeline" description="Everything on record for this patient" icon={<CalendarClock className="size-5" />}>
          {loading ? (
            <ListSkeleton rows={2} />
          ) : timeline.length === 0 ? (
            <QuietEmpty icon={<CalendarClock className="size-5" />} title="Nothing on the timeline yet" />
          ) : (
            <ol className="max-h-96 space-y-3 overflow-y-auto pr-1 scrollbar-thin">
              {timeline.map((t, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0">
                    <p className="text-sm">{t.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.kind ? `${t.kind} · ` : ""}{formatDateTime(t.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>

        {/* Encounter FormSheet */}
        <FormSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={detail && detail.status === "DRAFT" ? "Edit encounter" : "New encounter"}
          description={`Consultation note for ${selected.name}`}
          size="md"
          submitLabel="Save encounter"
          onSubmit={saveEncounter}
          loading={saving}
          dirty={JSON.stringify(form) !== JSON.stringify(EMPTY_FORM)}
        >
          <FieldGrid>
            <TextareaField
              label="Chief complaint"
              value={form.chiefComplaint}
              onChange={(v) => setForm((f) => ({ ...f, chiefComplaint: v }))}
              placeholder="e.g. Chest pain for 2 days…"
            />
            <TextareaField
              label="Observations"
              rows={5}
              value={form.observations}
              onChange={(v) => setForm((f) => ({ ...f, observations: v }))}
              placeholder="Clinical findings, examination notes…"
            />
            <TextareaField
              label="Diagnosis"
              value={form.diagnosis}
              onChange={(v) => setForm((f) => ({ ...f, diagnosis: v }))}
            />
            <TextareaField
              label="Advice"
              value={form.advice}
              onChange={(v) => setForm((f) => ({ ...f, advice: v }))}
            />
            <TextField
              label="Follow-up date"
              type="date"
              value={form.followUpDate}
              onChange={(v) => setForm((f) => ({ ...f, followUpDate: v }))}
            />
          </FieldGrid>
          <NoteBanner>
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
              AI draft: press &quot;AI consult draft&quot; below to generate a suggested note — it is never applied automatically.
            </span>
          </NoteBanner>
          <Button type="button" variant="outline" className="min-h-11 gap-1.5" disabled={aiLoading} onClick={() => void runAiDraft()}>
            {aiLoading ? <Sparkles className="size-4 animate-pulse" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
            {aiLoading ? "Drafting…" : "AI consult draft"}
          </Button>
          {aiDraft && (
            <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{aiDraft.draft}</p>
              {aiDraft.disclaimer && <NoteBanner>{aiDraft.disclaimer}</NoteBanner>}
              <Button type="button" size="sm" variant="secondary" className="min-h-11 sm:min-h-9" onClick={insertDraft}>
                Insert into note
              </Button>
            </div>
          )}
        </FormSheet>

        {/* Sign confirmation */}
        <ConfirmDialog
          open={signOpen}
          onOpenChange={setSignOpen}
          title="Sign this encounter?"
          recordName={selected.name}
          description="Signing locks the note; corrections create an amendment. Prescriptions and lab orders can still be issued separately."
          confirmLabel="Sign encounter"
          loading={signing}
          onConfirm={signEncounter}
        />
      </div>
    );
  }

  /* ───────────────────────────── list view ─────────────────────────────── */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patients"
        description="Search beneficiaries by name, phone or ID, then open the consultation workbench."
        icon={<Users className="size-5" />}
      />

      <SectionCard title="Find a patient" icon={<Users className="size-5" />}>
        <Input
          type="search"
          value={search.q}
          onChange={(e) => search.setQ(e.target.value)}
          placeholder="Search by name, phone or code…"
          aria-label="Search beneficiaries"
          className="h-11"
        />
        {search.loading && <Skeleton className="mt-3 h-12 w-full rounded-xl" />}
        {!search.loading && search.q.trim().length >= 2 && search.results.length === 0 && (
          <div className="mt-3">
            <QuietEmpty
              icon={<Users className="size-5" />}
              title="No patients match your search"
              error={search.error}
            />
          </div>
        )}
        {search.results.length > 0 && (
          <ul className="mt-3 max-h-96 divide-y overflow-y-auto scrollbar-thin">
            {search.results.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {beneficiaryCode(b)} · {ageSexLine(b)}
                    {b.phone ? ` · ${b.phone}` : ""}
                  </p>
                </div>
                {b.allergies && (
                  <StatusBadge status="ALLERGY" tone="danger">
                    Allergy
                  </StatusBadge>
                )}
                <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => openWorkbench(b)}>
                  <Stethoscope className="size-4" aria-hidden="true" />
                  Workbench
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
