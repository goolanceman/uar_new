"use client";

/**
 * Nurse tab — Vitals & Queue. Pick a camp, manage the patient queue
 * (WAITING / IN_CONSULTATION), record vitals with a live BMI preview, and
 * log point-of-care screenings.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, HeartPulse, RefreshCw, Stethoscope, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch, post } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormSheet } from "@/components/shared/form-sheet";
import { Field, FieldGrid, TextField, TextareaField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ageSexLine,
  asArray,
  bmiOf,
  ListSkeleton,
  medTone,
  QuietEmpty,
  toastError,
  useBeneficiarySearch,
  type AttendanceRow,
  type BeneficiaryLite,
  type CampSummary,
  type ScreeningRowLite,
  type VitalsRow,
} from "./shared";
import { useRowBusy } from "@/hooks/use-row-busy";

interface VitalsForm {
  heightCm: string;
  weightKg: string;
  tempC: string;
  pulse: string;
  bpSystolic: string;
  bpDiastolic: string;
  spo2: string;
  glucose: string;
  notes: string;
}

interface ScreeningForm {
  type: string;
  result: string;
  abnormal: boolean;
  notes: string;
}

const EMPTY_VITALS: VitalsForm = {
  heightCm: "",
  weightKg: "",
  tempC: "",
  pulse: "",
  bpSystolic: "",
  bpDiastolic: "",
  spo2: "",
  glucose: "",
  notes: "",
};

const SCREENING_TYPES = ["BP", "GLUCOSE", "EYE", "DENTAL", "HEARING", "SKIN", "NUTRITION", "GENERAL", "OTHER"].map((t) => ({
  value: t,
  label: t === "BP" ? "Blood pressure" : t === "GLUCOSE" ? "Blood sugar" : t.charAt(0) + t.slice(1).toLowerCase(),
}));

export default function NurseVitals({ user }: { user: SessionUser }) {
  const [camps, setCamps] = useState<CampSummary[]>([]);
  const [campId, setCampId] = useState("");
  const [campsLoading, setCampsLoading] = useState(true);

  const [queue, setQueue] = useState<AttendanceRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const { busyId, setBusyId } = useRowBusy();

  const [vitalsOpen, setVitalsOpen] = useState(false);
  const [vitalsForm, setVitalsForm] = useState<VitalsForm>(EMPTY_VITALS);
  const [vitalsSaving, setVitalsSaving] = useState(false);
  const search = useBeneficiarySearch();
  const [picked, setPicked] = useState<BeneficiaryLite | null>(null);

  const [screeningsOpen, setScreeningsOpen] = useState(false);
  const [screeningForm, setScreeningForm] = useState<ScreeningForm>({ type: "", result: "", abnormal: false, notes: "" });
  const [screenings, setScreenings] = useState<ScreeningRowLite[]>([]);
  const [screeningSaving, setScreeningSaving] = useState(false);

  const loadCamps = useCallback(async () => {
    setCampsLoading(true);
    try {
      const data = await get<unknown>("/api/medical-camps?upcoming=1&status=SCHEDULED,LIVE");
      const list = asArray<CampSummary>(data);
      setCamps(list);
      setCampId((prev) => prev || (list.find((c) => c.status === "LIVE") ?? list[0])?.id || "");
    } catch {
      setCamps([]);
    } finally {
      setCampsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCamps();
  }, [loadCamps]);

  const loadQueue = useCallback(async () => {
    if (!campId) return;
    setQueueLoading(true);
    try {
      const data = await get<unknown>(`/api/camp-attendance?campId=${campId}`);
      setQueue(asArray<AttendanceRow>(data));
    } catch (e) {
      setQueue([]);
      toastError(e, "Could not load the queue");
    } finally {
      setQueueLoading(false);
    }
  }, [campId]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const loadScreenings = useCallback(async () => {
    try {
      const data = await get<unknown>(`/api/screenings${campId ? `?campId=${campId}` : ""}`);
      setScreenings(asArray<ScreeningRowLite>(data).slice(0, 10));
    } catch {
      setScreenings([]);
    }
  }, [campId]);

  useEffect(() => {
    loadScreenings();
  }, [loadScreenings]);

  const advance = async (row: AttendanceRow, status: string) => {
    setBusyId(row.id);
    try {
      // The camp queue API takes { id, status } in the body (no :id route).
      await patch("/api/camp-attendance", { id: row.id, status });
      setQueue((prev) => prev.map((r) => (r.id === row.id ? { ...r, status } : r)));
    } catch (e) {
      toastError(e, "Could not update the queue");
    } finally {
      setBusyId(null);
    }
  };

  const openVitals = (b?: BeneficiaryLite | null) => {
    setPicked(b ?? null);
    setVitalsForm(EMPTY_VITALS);
    search.setQ("");
    setVitalsOpen(true);
  };

  const saveVitals = async () => {
    const b = picked;
    if (!b) {
      toast.error("Pick a patient first");
      return;
    }
    if (!vitalsForm.bpSystolic && !vitalsForm.weightKg && !vitalsForm.pulse && !vitalsForm.tempC) {
      toast.error("Record at least one reading");
      return;
    }
    setVitalsSaving(true);
    try {
      await post("/api/vitals", {
        beneficiaryId: b.id,
        campId: campId || undefined,
        heightCm: vitalsForm.heightCm ? Number(vitalsForm.heightCm) : undefined,
        weightKg: vitalsForm.weightKg ? Number(vitalsForm.weightKg) : undefined,
        tempC: vitalsForm.tempC ? Number(vitalsForm.tempC) : undefined,
        pulse: vitalsForm.pulse ? Number(vitalsForm.pulse) : undefined,
        bpSystolic: vitalsForm.bpSystolic ? Number(vitalsForm.bpSystolic) : undefined,
        bpDiastolic: vitalsForm.bpDiastolic ? Number(vitalsForm.bpDiastolic) : undefined,
        spo2: vitalsForm.spo2 ? Number(vitalsForm.spo2) : undefined,
        glucose: vitalsForm.glucose ? Number(vitalsForm.glucose) : undefined,
        notes: vitalsForm.notes.trim() || undefined,
      });
      toast.success(`Vitals recorded for ${b.name}`);
      setVitalsOpen(false);
    } catch (e) {
      toastError(e, "Could not record vitals");
    } finally {
      setVitalsSaving(false);
    }
  };

  const saveScreening = async () => {
    const b = picked;
    if (!b) {
      toast.error("Pick a patient first");
      return;
    }
    if (!screeningForm.type || !screeningForm.result.trim()) {
      toast.error("Choose the screening type and enter the result");
      return;
    }
    setScreeningSaving(true);
    try {
      await post("/api/screenings", {
        beneficiaryId: b.id,
        campId: campId || undefined,
        type: screeningForm.type,
        result: screeningForm.result.trim(),
        abnormal: screeningForm.abnormal,
        notes: screeningForm.notes.trim() || undefined,
      });
      toast.success("Screening recorded");
      setScreeningsOpen(false);
      await loadScreenings();
    } catch (e) {
      toastError(e, "Could not record the screening");
    } finally {
      setScreeningSaving(false);
    }
  };

  const waiting = queue.filter((r) => r.status === "WAITING").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vitals & queue"
        description="Run the camp desk: check the queue, record vitals and screenings."
        icon={<Activity className="size-5" />}
        actions={
          <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => { void loadQueue(); void loadScreenings(); }} aria-label="Refresh">
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {/* Camp picker */}
      <SectionCard title="Camp" description="Vitals and screenings are tagged to this camp" icon={<Stethoscope className="size-5" />}>
        {campsLoading ? (
          <Skeleton className="h-11 w-full rounded-md" />
        ) : camps.length === 0 ? (
          <QuietEmpty icon={<Stethoscope className="size-5" />} title="No upcoming camps" hint="Ask the coordinator to schedule and roster you." />
        ) : (
          <Field label="Medical camp">
            <select
              value={campId}
              onChange={(e) => setCampId(e.target.value)}
              aria-label="Select medical camp"
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
            >
              {camps.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} — {c.status === "LIVE" ? "LIVE" : "upcoming"}
                </option>
              ))}
            </select>
          </Field>
        )}
      </SectionCard>

      {/* Record actions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => openVitals(null)}
          className="flex min-h-11 flex-col gap-1.5 rounded-xl border bg-card p-5 text-left shadow-sm outline-none transition hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <HeartPulse className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold">Record vitals</span>
          <span className="text-xs text-muted-foreground">Height, weight, BP, pulse, SpO₂ — with live BMI preview.</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setPicked(null);
            search.setQ("");
            setScreeningsOpen(true);
          }}
          className="flex min-h-11 flex-col gap-1.5 rounded-xl border bg-card p-5 text-left shadow-sm outline-none transition hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Activity className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold">Log a screening</span>
          <span className="text-xs text-muted-foreground">BP, sugar, anaemia, vision, dental — point-of-care checks.</span>
        </button>
      </div>

      {/* Queue */}
      <SectionCard
        title="Patient queue"
        description={waiting > 0 ? `${waiting} waiting — move patients into consultation` : "Everyone seen for now"}
        icon={<Users className="size-5" />}
      >
        {queueLoading ? (
          <ListSkeleton rows={3} />
        ) : queue.length === 0 ? (
          <QuietEmpty icon={<Users className="size-5" />} title="Queue is empty" hint="Patients appear here as the registration desk checks them in." />
        ) : (
          <ul className="max-h-[28rem] divide-y overflow-y-auto scrollbar-thin">
            {queue.map((row) => {
              const b = row.beneficiary;
              return (
                <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{b?.name ?? "Patient"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {ageSexLine(b)}
                      {row.queueToken ? ` · token ${row.queueToken}` : ""}
                      {row.checkInAt ? ` · ${formatDateTime(row.checkInAt)}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={row.status} tone={medTone(row.status)} />
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    {row.status === "WAITING" && (
                      <Button size="sm" variant="outline" className="min-h-11 gap-1.5 sm:min-h-9" disabled={busyId !== null} onClick={() => void advance(row, "IN_CONSULTATION")}>
                        <Stethoscope className="size-4" aria-hidden="true" />
                        Into consult
                      </Button>
                    )}
                    {row.status === "IN_CONSULTATION" && (
                      <Button size="sm" variant="outline" className="min-h-11 gap-1.5 sm:min-h-9" disabled={busyId !== null} onClick={() => void advance(row, "COMPLETED")}>
                        Done
                      </Button>
                    )}
                    {b && (
                      <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => openVitals(b)}>
                        <HeartPulse className="size-4" aria-hidden="true" />
                        Vitals
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* Recent screenings */}
      <SectionCard title="Recent screenings" description="Point-of-care checks at this camp" icon={<Activity className="size-5" />}>
        {screenings.length === 0 ? (
          <QuietEmpty icon={<Activity className="size-5" />} title="No screenings recorded yet" />
        ) : (
          <ul className="max-h-72 divide-y overflow-y-auto scrollbar-thin">
            {screenings.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {s.beneficiary?.name ?? "Patient"} · {s.type ? s.type.charAt(0) + s.type.slice(1).toLowerCase().replace(/_/g, " ") : "Screening"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{s.notes || formatDateTime(s.createdAt ?? "")}</p>
                </div>
                {s.result && <p className="w-full truncate text-xs text-muted-foreground sm:w-auto sm:max-w-48">{s.result}</p>}
                <StatusBadge status={s.abnormal ? "ABNORMAL" : "NORMAL"} tone={s.abnormal ? "danger" : "success"}>
                  {s.abnormal ? "Abnormal" : "Normal"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Vitals FormSheet (with live BMI) */}
      <FormSheet
        open={vitalsOpen}
        onOpenChange={setVitalsOpen}
        title="Record vitals"
        description={picked ? `${picked.name} · ${ageSexLine(picked)}` : "Pick the patient below, then enter the readings you have."}
        size="md"
        submitLabel="Save vitals"
        onSubmit={saveVitals}
        loading={vitalsSaving}
        dirty={Object.values(vitalsForm).some((v) => v !== "")}
      >
        {picked ? (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
            <Users className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{picked.name}</p>
              <p className="truncate text-xs text-muted-foreground">{ageSexLine(picked)}</p>
            </div>
            <Button type="button" size="icon" variant="ghost" className="size-11" onClick={() => setPicked(null)} aria-label="Change patient">
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <>
            <Input type="search" value={search.q} onChange={(e) => search.setQ(e.target.value)} placeholder="Search patient by name, phone or code…" aria-label="Search patients" className="h-11" />
            {search.results.length > 0 && (
              <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border scrollbar-thin">
                {search.results.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => setPicked(b)} className="flex w-full min-h-11 flex-col justify-center px-3 py-2.5 text-left transition hover:bg-accent">
                      <span className="block truncate text-sm font-medium">{b.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{ageSexLine(b)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <FieldGrid>
          <TextField label="Height (cm)" type="number" inputMode="decimal" value={vitalsForm.heightCm} onChange={(v) => setVitalsForm((f) => ({ ...f, heightCm: v }))} placeholder="160" />
          <TextField label="Weight (kg)" type="number" inputMode="decimal" value={vitalsForm.weightKg} onChange={(v) => setVitalsForm((f) => ({ ...f, weightKg: v }))} placeholder="58" />
        </FieldGrid>
        {(vitalsForm.heightCm && vitalsForm.weightKg) && (
          <p className={cn("rounded-lg border bg-emerald-500/10 p-3 text-sm")} role="status">
            BMI preview: <span className="font-bold">{bmiOf(vitalsForm.heightCm, vitalsForm.weightKg)}</span>
            <span className="ml-1 text-xs text-muted-foreground">(weight ÷ height²)</span>
          </p>
        )}
        <FieldGrid>
          <TextField label="Temperature (°C)" type="number" step="0.1" inputMode="decimal" value={vitalsForm.tempC} onChange={(v) => setVitalsForm((f) => ({ ...f, tempC: v }))} placeholder="37.0" />
          <TextField label="Pulse (bpm)" type="number" inputMode="numeric" value={vitalsForm.pulse} onChange={(v) => setVitalsForm((f) => ({ ...f, pulse: v }))} placeholder="78" />
          <TextField label="BP systolic" type="number" inputMode="numeric" value={vitalsForm.bpSystolic} onChange={(v) => setVitalsForm((f) => ({ ...f, bpSystolic: v }))} placeholder="120" />
          <TextField label="BP diastolic" type="number" inputMode="numeric" value={vitalsForm.bpDiastolic} onChange={(v) => setVitalsForm((f) => ({ ...f, bpDiastolic: v }))} placeholder="80" />
          <TextField label="SpO₂ (%)" type="number" inputMode="numeric" value={vitalsForm.spo2} onChange={(v) => setVitalsForm((f) => ({ ...f, spo2: v }))} placeholder="98" />
          <TextField label="Blood sugar (mg/dL)" type="number" inputMode="numeric" value={vitalsForm.glucose} onChange={(v) => setVitalsForm((f) => ({ ...f, glucose: v }))} placeholder="110" />
        </FieldGrid>
        <TextareaField label="Notes" value={vitalsForm.notes} onChange={(v) => setVitalsForm((f) => ({ ...f, notes: v }))} placeholder="Anything the doctor should know…" />
      </FormSheet>

      {/* Screening FormSheet */}
      <FormSheet
        open={screeningsOpen}
        onOpenChange={setScreeningsOpen}
        title="Log a screening"
        description={picked ? `${picked.name} · ${ageSexLine(picked)}` : "Pick the patient below, then log the screening."}
        size="sm"
        submitLabel="Save screening"
        onSubmit={saveScreening}
        loading={screeningSaving}
        dirty={screeningForm.type !== "" || screeningForm.result !== "" || screeningForm.notes !== ""}
      >
        {picked ? (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
            <Users className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{picked.name}</p>
              <p className="truncate text-xs text-muted-foreground">{ageSexLine(picked)}</p>
            </div>
            <Button type="button" size="icon" variant="ghost" className="size-11" onClick={() => setPicked(null)} aria-label="Change patient">
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <>
            <Input type="search" value={search.q} onChange={(e) => search.setQ(e.target.value)} placeholder="Search patient by name, phone or code…" aria-label="Search patients" className="h-11" />
            {search.results.length > 0 && (
              <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border scrollbar-thin">
                {search.results.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => setPicked(b)} className="flex w-full min-h-11 flex-col justify-center px-3 py-2.5 text-left transition hover:bg-accent">
                      <span className="block truncate text-sm font-medium">{b.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{ageSexLine(b)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <Field label="Screening type">
          <div className="flex flex-wrap gap-2">
            {SCREENING_TYPES.map((t) => (
              <button key={t.value} type="button" onClick={() => setScreeningForm((f) => ({ ...f, type: t.value }))} aria-pressed={screeningForm.type === t.value}
                className={`min-h-11 rounded-full border px-3.5 py-1.5 text-xs font-medium ${screeningForm.type === t.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Result" hint="What you observed — e.g. “BP 150/94, repeat after rest”">
          <TextareaField
            label=""
            rows={2}
            value={screeningForm.result}
            onChange={(v) => setScreeningForm((f) => ({ ...f, result: v }))}
            placeholder="Finding at the point of care…"
          />
        </Field>
        <Field label="Flag">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setScreeningForm((f) => ({ ...f, abnormal: false }))} aria-pressed={!screeningForm.abnormal}
              className={`min-h-11 rounded-full border px-3.5 py-1.5 text-xs font-medium ${!screeningForm.abnormal ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}>
              Normal finding
            </button>
            <button type="button" onClick={() => setScreeningForm((f) => ({ ...f, abnormal: true }))} aria-pressed={screeningForm.abnormal}
              className={`min-h-11 rounded-full border px-3.5 py-1.5 text-xs font-medium ${screeningForm.abnormal ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}>
              Abnormal — flag for the doctor
            </button>
          </div>
        </Field>
        <TextareaField label="Notes" value={screeningForm.notes} onChange={(v) => setScreeningForm((f) => ({ ...f, notes: v }))} placeholder="Referred to eye camp; needs follow-up…" />
      </FormSheet>
    </div>
  );
}
