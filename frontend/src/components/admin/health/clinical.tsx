"use client";

/**
 * Health Programme — Clinical tab.
 *
 * Left: encounters list (status DRAFT/SIGNED, doctor, camp, beneficiary)
 * with a DetailSheet showing the encounter + vitals + linked
 * prescriptions / lab orders / referrals (+ amendments timeline when the
 * backend returns them).
 * Right: vitals & screenings entry for any beneficiary (BMI preview client-
 * side; the server computes BMI authoritatively).
 *
 * ADMIN sees everything read/oversight — DOCTOR-role edits live in the
 * doctor portal (noted in the UI).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ClipboardList,
  Loader2,
  Plus,
  Stethoscope,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { get, post } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { humanize, StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { FormSheet } from "@/components/shared/form-sheet";
import { DetailGrid, DetailSection, DetailSheet } from "@/components/shared/detail-sheet";
import { DataField } from "@/components/shared/data-field";
import { FieldGrid, FormSection, SelectField, SwitchField, TextField, TextareaField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import type { TabProps } from "./overview";
import {
  asPaged,
  BeneficiarySearch,
  bmi,
  CampSelect,
  errorText,
  FilterChips,
  NoteBox,
  num,
  type EncounterDetail,
  type EncounterRow,
  type ScreeningRow,
  type VitalsRow,
} from "./shared";

const ENC_FILTERS = ["ALL", "DRAFT", "SIGNED"];
const EMPTY_VITALS = {
  bpSystolic: "",
  bpDiastolic: "",
  pulse: "",
  tempC: "",
  respRate: "",
  spo2: "",
  heightCm: "",
  weightKg: "",
  glucose: "",
  notes: "",
};
const EMPTY_SCREENING = { type: "", result: "", abnormal: false };

export default function ClinicalTab({ revision }: TabProps) {
  /* ------------------------------ encounters ------------------------------ */
  const [encounters, setEncounters] = useState<EncounterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("ALL");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EncounterDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /* ------------------------- vitals & screenings ------------------------- */
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [vitalsOpen, setVitalsOpen] = useState(false);
  const [vitalsForm, setVitalsForm] = useState(EMPTY_VITALS);
  const [vitalsSaving, setVitalsSaving] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);
  const [screenForm, setScreenForm] = useState(EMPTY_SCREENING);
  const [screenSaving, setScreenSaving] = useState(false);
  const [screenings, setScreenings] = useState<ScreeningRow[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (status !== "ALL") sp.set("status", status);
      const d = await get<unknown>(`/api/encounters?${sp.toString()}`);
      setEncounters(asPaged<EncounterRow>(d).items);
      if (picked) {
        const s = await get<unknown>(`/api/screenings?beneficiaryId=${picked.id}`);
        setScreenings(Array.isArray(s) ? s : ((s as { items?: ScreeningRow[] }).items ?? []));
      } else {
        setScreenings(null);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [status, picked]);

  useEffect(() => {
    load();
  }, [load, revision]);

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    try {
      const d = await get<EncounterDetail>(`/api/encounters/${id}`);
      setDetail(d);
    } catch (e) {
      toast.error(errorText(e));
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const saveVitals = async () => {
    if (!picked) {
      toast.error("Pick a beneficiary first");
      return;
    }
    const hasAny = Object.entries(vitalsForm).some(([k, v]) => k !== "notes" && v !== "");
    if (!hasAny) {
      toast.error("Enter at least one vital reading");
      return;
    }
    setVitalsSaving(true);
    try {
      await post("/api/vitals", {
        beneficiaryId: picked.id,
        bpSystolic: vitalsForm.bpSystolic ? num(vitalsForm.bpSystolic) : undefined,
        bpDiastolic: vitalsForm.bpDiastolic ? num(vitalsForm.bpDiastolic) : undefined,
        pulse: vitalsForm.pulse ? num(vitalsForm.pulse) : undefined,
        tempC: vitalsForm.tempC ? num(vitalsForm.tempC) : undefined,
        respRate: vitalsForm.respRate ? num(vitalsForm.respRate) : undefined,
        spo2: vitalsForm.spo2 ? num(vitalsForm.spo2) : undefined,
        heightCm: vitalsForm.heightCm ? num(vitalsForm.heightCm) : undefined,
        weightKg: vitalsForm.weightKg ? num(vitalsForm.weightKg) : undefined,
        glucose: vitalsForm.glucose ? num(vitalsForm.glucose) : undefined,
        notes: vitalsForm.notes.trim() || undefined,
      });
      toast.success("Vitals recorded — BMI computed server-side");
      setVitalsOpen(false);
      setVitalsForm(EMPTY_VITALS);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setVitalsSaving(false);
    }
  };

  const saveScreening = async () => {
    if (!picked) {
      toast.error("Pick a beneficiary first");
      return;
    }
    if (!screenForm.type.trim() || !screenForm.result.trim()) {
      toast.error("Screening type and result are required");
      return;
    }
    setScreenSaving(true);
    try {
      await post("/api/screenings", {
        beneficiaryId: picked.id,
        type: screenForm.type.trim(),
        result: screenForm.result.trim(),
        abnormal: screenForm.abnormal,
      });
      toast.success("Screening recorded");
      setScreenOpen(false);
      setScreenForm(EMPTY_SCREENING);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setScreenSaving(false);
    }
  };

  const columns: DataTableColumn<EncounterRow>[] = useMemo(
    () => [
      {
        key: "beneficiary",
        header: "Beneficiary",
        accessor: (e) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{e.beneficiary?.name ?? "—"}</p>
            <p className="truncate text-xs text-muted-foreground">{e.beneficiary?.code || "—"}</p>
          </div>
        ),
      },
      {
        key: "doctor",
        header: "Doctor",
        hideBelow: "sm",
        accessor: (e) => <span className="block max-w-40 truncate text-sm">{e.doctor?.name ?? "—"}</span>,
      },
      {
        key: "camp",
        header: "Camp",
        hideBelow: "md",
        accessor: (e) => <span className="block max-w-48 truncate text-sm">{e.camp?.title ?? "—"}</span>,
      },
      { key: "status", header: "Status", accessor: (e) => <StatusBadge status={e.status} /> },
      {
        key: "when",
        header: "Recorded",
        hideBelow: "lg",
        accessor: (e) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {e.createdAt ? formatDateTime(e.createdAt) : "—"}
          </span>
        ),
      },
    ],
    []
  );

  const previewBmi = bmi(vitalsForm.heightCm, vitalsForm.weightKg);

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-3 lg:gap-6 lg:space-y-0">
      {/* Encounters */}
      <div className="space-y-4 lg:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips label="Filter encounters by status" options={ENC_FILTERS} value={status} onChange={setStatus} />
          <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {loading ? "Loading…" : `${encounters.length} encounter${encounters.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {error ? (
          <EmptyState
            icon={<Stethoscope className="size-8" aria-hidden="true" />}
            title="Encounters could not load"
            hint={error}
          >
            <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
              Retry
            </Button>
          </EmptyState>
        ) : (
          <DataTable
            columns={columns}
            rows={encounters}
            rowKey={(e) => e.id}
            loading={loading}
            skeletonRows={6}
            height="max-h-[32rem]"
            onRowClick={(e) => openDetail(e.id)}
            itemLabel="encounters"
            empty={
              <EmptyState
                icon={<Stethoscope className="size-8" aria-hidden="true" />}
                title="No encounters yet"
                hint="Doctors create encounters from the doctor portal during camps — they appear here for oversight the moment they are opened."
              />
            }
          />
        )}

        <NoteBox>
          Admin view is read-only oversight. Doctors write encounters, prescriptions and lab orders
          from the doctor portal during (or after) a camp.
        </NoteBox>
      </div>

      {/* Vitals & screenings entry */}
      <div className="space-y-4">
        <SectionCard
          title="Record vitals"
          description="Nurse desk entry for any beneficiary."
          icon={<Activity className="size-4" aria-hidden="true" />}
          actions={
            <Button size="sm" className="min-h-9" disabled={!picked} onClick={() => setVitalsOpen(true)}>
              <Plus className="size-3.5" aria-hidden="true" /> Vitals
            </Button>
          }
        >
          {picked ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-primary/5 px-3 py-2">
              <span className="truncate text-sm font-medium">{picked.label}</span>
              <Button variant="ghost" size="sm" className="h-8 px-2" aria-label="Clear selected beneficiary" onClick={() => setPicked(null)}>
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <BeneficiarySearch onPick={(b) => setPicked({ id: b.id, label: b.name })} />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Pick a beneficiary, then open the vitals sheet — blood pressure, pulse, temperature,
            SpO₂, height/weight (BMI preview) and glucose.
          </p>
        </SectionCard>

        <SectionCard
          title="Record screening"
          description="Camp screening outcomes (eye, dental,…)."
          icon={<ClipboardList className="size-4" aria-hidden="true" />}
          actions={
            <Button size="sm" variant="outline" className="min-h-9" disabled={!picked} onClick={() => setScreenOpen(true)}>
              <Plus className="size-3.5" aria-hidden="true" /> Screening
            </Button>
          }
        >
          {screenings === null ? (
            <p className="text-xs text-muted-foreground">Screenings for the selected beneficiary appear here.</p>
          ) : screenings.length === 0 ? (
            <p className="text-xs text-muted-foreground">No screenings recorded for this beneficiary yet.</p>
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto scrollbar-thin" aria-label="Screenings">
              {screenings.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{s.type}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.result}</span>
                  </span>
                  {s.abnormal ? <StatusBadge status="ABNORMAL" tone="danger" /> : <StatusBadge status="NORMAL" tone="success" />}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* encounter detail sheet */}
      <DetailSheet
        open={!!detailId}
        onOpenChange={(o) => {
          if (!o) {
            setDetailId(null);
            setDetail(null);
          }
        }}
        eyebrow="Encounter"
        title={detail?.beneficiary?.name ?? "Encounter"}
        description={detail ? [detail.doctor?.name, detail.camp?.title].filter(Boolean).join(" · ") : undefined}
        status={detail ? <StatusBadge status={detail.status} /> : null}
        loading={detailLoading}
      >
        {detail ? (
          <>
            <DetailSection title="Encounter" description="Clinical notes as recorded by the doctor.">
              <DetailGrid cols={2}>
                <DataField label="Status" value={<StatusBadge status={detail.status} />} />
                <DataField label="Recorded" value={detail.createdAt ? formatDateTime(detail.createdAt) : null} />
                <DataField label="Doctor" value={detail.doctor?.name ?? null} />
                <DataField label="Camp" value={detail.camp?.title ?? null} />
              </DetailGrid>
              {detail.diagnosis ? (
                <DataField label="Diagnosis" value={detail.diagnosis} />
              ) : null}
              {detail.notes ? (
                <p className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm leading-relaxed">{detail.notes}</p>
              ) : null}
            </DetailSection>

            <DetailSection title="Vitals">
              {(detail.vitals ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No vitals recorded in this encounter.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {(detail.vitals ?? []).map((v: VitalsRow) => (
                    <div key={v.id} className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {v.recordedAt || v.createdAt ? formatDateTime((v.recordedAt ?? v.createdAt) as string) : "Vitals"}
                      </p>
                      <p className="mt-1 tabular-nums">
                        {v.bpSystolic && v.bpDiastolic ? `BP ${v.bpSystolic}/${v.bpDiastolic} · ` : ""}
                        {v.pulse ? `Pulse ${v.pulse} · ` : ""}
                        {v.tempC ? `${v.tempC}°C · ` : ""}
                        {v.spo2 ? `SpO₂ ${v.spo2}% · ` : ""}
                        {v.weightKg ? `${v.weightKg} kg` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </DetailSection>

            <DetailSection title="Linked records" description="Prescriptions, lab orders and referrals raised in this encounter.">
              <div className="space-y-3">
                {(detail.prescriptions ?? []).length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prescriptions</p>
                    <ul className="space-y-1.5">
                      {(detail.prescriptions ?? []).map((rx) => (
                        <li key={rx.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                          <span className="truncate">{rx.code ?? rx.id.slice(0, 8)}</span>
                          <StatusBadge status={rx.status} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {(detail.labOrders ?? []).length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lab orders</p>
                    <ul className="space-y-1.5">
                      {(detail.labOrders ?? []).map((lo) => (
                        <li key={lo.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                          <span className="truncate">{lo.test ?? "Lab order"}</span>
                          <StatusBadge status={lo.status} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {(detail.referrals ?? []).length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Referrals</p>
                    <ul className="space-y-1.5">
                      {(detail.referrals ?? []).map((rf) => (
                        <li key={rf.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                          <span className="truncate">{rf.facility ?? rf.reason ?? "Referral"}</span>
                          <StatusBadge status={rf.status} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {(detail.prescriptions ?? []).length === 0 &&
                (detail.labOrders ?? []).length === 0 &&
                (detail.referrals ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing linked yet.</p>
                ) : null}
              </div>
            </DetailSection>

            {(detail.amendments ?? []).length > 0 ? (
              <DetailSection title="Amendments" description="Change history for this encounter.">
                <ol className="space-y-2 border-l-2 pl-4">
                  {(detail.amendments ?? []).map((a, i) => (
                    <li key={i} className="text-sm">
                      <p className="font-medium">{a.summary ?? humanize(a.kind)}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(a.at)}</p>
                    </li>
                  ))}
                </ol>
              </DetailSection>
            ) : null}
          </>
        ) : null}
      </DetailSheet>

      {/* vitals FormSheet */}
      <FormSheet
        open={vitalsOpen}
        onOpenChange={setVitalsOpen}
        title="Record vitals"
        description={picked ? `For ${picked.label}. BMI is computed automatically server-side.` : undefined}
        size="md"
        submitLabel="Save vitals"
        loading={vitalsSaving}
        dirty={Object.entries(vitalsForm).some(([k, v]) => k !== "notes" && v !== "")}
        onSubmit={saveVitals}
      >
        <FormSection title="Readings" description="Fill what was measured — blanks are skipped.">
          <FieldGrid>
            <TextField label="BP systolic" inputMode="numeric" value={vitalsForm.bpSystolic} onChange={(v) => setVitalsForm({ ...vitalsForm, bpSystolic: v })} />
            <TextField label="BP diastolic" inputMode="numeric" value={vitalsForm.bpDiastolic} onChange={(v) => setVitalsForm({ ...vitalsForm, bpDiastolic: v })} />
            <TextField label="Pulse" inputMode="numeric" value={vitalsForm.pulse} onChange={(v) => setVitalsForm({ ...vitalsForm, pulse: v })} />
            <TextField label="Temperature (°C)" inputMode="decimal" value={vitalsForm.tempC} onChange={(v) => setVitalsForm({ ...vitalsForm, tempC: v })} />
            <TextField label="Resp. rate" inputMode="numeric" value={vitalsForm.respRate} onChange={(v) => setVitalsForm({ ...vitalsForm, respRate: v })} />
            <TextField label="SpO₂ (%)" inputMode="numeric" value={vitalsForm.spo2} onChange={(v) => setVitalsForm({ ...vitalsForm, spo2: v })} />
          </FieldGrid>
        </FormSection>
        <FormSection title="Body measurements" description="Height + weight → BMI.">
          <FieldGrid>
            <TextField label="Height (cm)" inputMode="decimal" value={vitalsForm.heightCm} onChange={(v) => setVitalsForm({ ...vitalsForm, heightCm: v })} />
            <TextField label="Weight (kg)" inputMode="decimal" value={vitalsForm.weightKg} onChange={(v) => setVitalsForm({ ...vitalsForm, weightKg: v })} />
          </FieldGrid>
          <FieldGrid>
            <TextField label="Glucose (mg/dL)" inputMode="numeric" value={vitalsForm.glucose} onChange={(v) => setVitalsForm({ ...vitalsForm, glucose: v })} />
            <div className="flex items-end">
              <div className="w-full rounded-lg border bg-muted/30 px-3 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">BMI preview</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums">{previewBmi ?? "—"}</p>
              </div>
            </div>
          </FieldGrid>
          <TextareaField label="Notes" value={vitalsForm.notes} onChange={(v) => setVitalsForm({ ...vitalsForm, notes: v })} rows={2} />
        </FormSection>
      </FormSheet>

      {/* screening FormSheet */}
      <FormSheet
        open={screenOpen}
        onOpenChange={setScreenOpen}
        title="Record screening"
        description={picked ? `For ${picked.label}.` : undefined}
        size="sm"
        submitLabel="Save screening"
        loading={screenSaving}
        dirty={!!screenForm.type.trim() || !!screenForm.result.trim()}
        onSubmit={saveScreening}
      >
        <FormSection title="Screening">
          <SelectField
            label="Type"
            required
            value={screenForm.type}
            onChange={(v) => setScreenForm({ ...screenForm, type: v })}
            options={[
              { value: "EYE", label: "Eye" },
              { value: "DENTAL", label: "Dental" },
              { value: "DERMATOLOGY", label: "Skin" },
              { value: "ENT", label: "ENT" },
              { value: "BLOOD_PRESSURE", label: "Blood pressure" },
              { value: "BLOOD_SUGAR", label: "Blood sugar" },
              { value: "OTHER", label: "Other" },
            ]}
          />
          <TextField
            label="Result"
            required
            value={screenForm.result}
            onChange={(v) => setScreenForm({ ...screenForm, result: v })}
            placeholder="e.g. Referred to vision centre"
          />
          <SwitchField
            label="Abnormal finding"
            hint="Flags the screening for clinical review"
            checked={screenForm.abnormal}
            onChange={(v) => setScreenForm({ ...screenForm, abnormal: v })}
          />
        </FormSection>
      </FormSheet>
    </div>
  );
}
