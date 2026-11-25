"use client";

/**
 * Health Programme — Appointments tab.
 *
 * Calendar-ish grouped list (Today / Upcoming / Past) with status filter,
 * schedule FormSheet (camp, beneficiary search, professional, type,
 * datetime), status advance (confirm / complete / cancel) and a no-show
 * action that asks for a reason.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Loader2,
  Plus,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { get, patch, post } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { humanize, StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { FieldGrid, FormSection, SelectField, TextField, TextareaField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import type { TabProps } from "./overview";
import {
  APPOINTMENT_TYPES,
  APPT_TONE,
  asPaged,
  BeneficiarySearch,
  CampSelect,
  errorText,
  FilterChips,
  ProfessionalSelect,
  type AppointmentRow,
} from "./shared";

const APPT_STATUSES = ["ALL", "PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"];

const EMPTY_FORM = {
  campId: "",
  beneficiary: null as { id: string; label: string } | null,
  professionalId: "",
  type: "CONSULTATION",
  scheduledAt: "",
  notes: "",
};

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export default function AppointmentsTab({ revision }: TabProps) {
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("ALL");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [noShowTarget, setNoShowTarget] = useState<AppointmentRow | null>(null);
  const [noShowReason, setNoShowReason] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (status !== "ALL") sp.set("status", status);
      const d = await get<unknown>(`/api/appointments?${sp.toString()}`);
      const list = asPaged<AppointmentRow>(d).items.slice();
      list.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
      setRows(list);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load, revision]);

  const groups = useMemo(() => {
    const todayStart = startOfDay(new Date());
    const todayEnd = todayStart + 86_400_000;
    const g: { label: string; items: AppointmentRow[] }[] = [
      { label: "Today", items: [] },
      { label: "Upcoming", items: [] },
      { label: "Past", items: [] },
    ];
    for (const a of rows) {
      const t = new Date(a.scheduledAt).getTime();
      if (!Number.isFinite(t)) continue;
      if (t >= todayStart && t < todayEnd) g[0].items.push(a);
      else if (t >= todayEnd) g[1].items.push(a);
      else g[2].items.push(a);
    }
    return g;
  }, [rows]);

  const schedule = async () => {
    if (!form.beneficiary || !form.scheduledAt) {
      toast.error("Pick a beneficiary and a time");
      return;
    }
    setSaving(true);
    try {
      await post("/api/appointments", {
        campId: form.campId || undefined,
        beneficiaryId: form.beneficiary.id,
        professionalId: form.professionalId || undefined,
        type: form.type,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        notes: form.notes.trim() || undefined,
      });
      toast.success("Appointment scheduled");
      setOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const setStatusOn = useCallback(
    async (row: AppointmentRow, next: string, extra?: Record<string, unknown>) => {
      try {
        await patch(`/api/appointments/${row.id}`, { status: next, ...extra });
        toast.success(`Appointment ${next.toLowerCase().replace(/_/g, " ")}`);
        await load();
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    [load]
  );

  const runNoShow = async () => {
    if (!noShowTarget) return;
    setActing(true);
    try {
      await patch(`/api/appointments/${noShowTarget.id}`, {
        status: "NO_SHOW",
        noShowReason: noShowReason.trim() || undefined,
      });
      toast.success("Marked as no-show");
      setNoShowTarget(null);
      setNoShowReason("");
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setActing(false);
    }
  };

  const csv: CsvColumn<AppointmentRow>[] = useMemo(
    () => [
      { header: "When", value: (a) => formatDateTime(a.scheduledAt) },
      { header: "Type", value: (a) => a.type ?? "" },
      { header: "Beneficiary", value: (a) => a.beneficiary?.name ?? "" },
      { header: "Professional", value: (a) => a.professional?.name ?? "" },
      { header: "Camp", value: (a) => a.camp?.title ?? "" },
      { header: "Status", value: (a) => a.status },
      { header: "No-show reason", value: (a) => a.noShowReason ?? "" },
    ],
    []
  );

  const renderRow = (a: AppointmentRow) => {
    const moves: Array<{ label: string; status: string; danger?: boolean }> = [];
    if (a.status === "PENDING")
      moves.push({ label: "Confirm", status: "CONFIRMED" });
    if (a.status === "CONFIRMED" || a.status === "PENDING") {
      moves.push({ label: "Mark completed", status: "COMPLETED" });
      moves.push({ label: "Cancel", status: "CANCELLED", danger: true });
      moves.push({ label: "No-show…", status: "NO_SHOW", danger: true });
    }
    return (
      <li
        key={a.id}
        className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {a.beneficiary?.name ?? "Beneficiary"}
            {a.type ? <span className="ml-2 font-normal text-muted-foreground">{humanize(a.type)}</span> : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[formatDateTime(a.scheduledAt), a.professional?.name, a.camp?.title].filter(Boolean).join(" · ") || "—"}
          </p>
          {a.noShowReason ? (
            <p className="mt-1 truncate text-xs text-red-600 dark:text-red-400">No-show: {a.noShowReason}</p>
          ) : null}
        </div>
        <StatusBadge status={a.status} tone={APPT_TONE[a.status] ?? undefined} />
        {moves.length > 0 ? (
          <div className="flex gap-1.5">
            {moves
              .filter((m) => !m.danger)
              .map((m) => (
                <Button key={m.status} size="sm" variant="outline" className="min-h-9" onClick={() => setStatusOn(a, m.status)}>
                  <Check className="size-3.5" aria-hidden="true" /> {m.label}
                </Button>
              ))}
            {moves.some((m) => m.status === "NO_SHOW") ? (
              <Button
                size="sm"
                variant="outline"
                className="min-h-9 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                onClick={() => {
                  setNoShowTarget(a);
                  setNoShowReason("");
                }}
              >
                <XCircle className="size-3.5" aria-hidden="true" /> No-show
              </Button>
            ) : null}
            {moves.some((m) => m.status === "CANCELLED") ? (
              <Button
                size="sm"
                variant="outline"
                className="min-h-9 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                onClick={() => setStatusOn(a, "CANCELLED")}
              >
                <X className="size-3.5" aria-hidden="true" /> Cancel
              </Button>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips label="Filter appointments by status" options={APPT_STATUSES} value={status} onChange={setStatus} />
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${rows.length} appointment${rows.length === 1 ? "" : "s"}`}
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ExportMenu columns={csv} rows={rows} filename="uar-appointments" disabled={rows.length === 0} />
          <Button className="min-h-11 sm:min-h-9" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden="true" /> Schedule
          </Button>
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={<CalendarDays className="size-8" aria-hidden="true" />}
          title="Appointments could not load"
          hint={error}
        >
          <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
            Retry
          </Button>
        </EmptyState>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="size-8" aria-hidden="true" />}
          title="No appointments yet"
          hint="Schedule camp or follow-up consultations with verified professionals — the list groups them into Today, Upcoming and Past."
        >
          <Button size="sm" className="min-h-11" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden="true" /> Schedule appointment
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <section key={g.label} className="space-y-2" aria-label={`${g.label} appointments`}>
                  <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.label}
                    <Badge variant="outline" className="tabular-nums">
                      {g.items.length}
                    </Badge>
                  </h3>
                  {g.items.map(renderRow)}
                </section>
              )
          )}
        </div>
      )}

      {/* schedule FormSheet */}
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title="Schedule appointment"
        description="Book a consultation for a beneficiary with a verified professional — camp-linked or standalone."
        size="md"
        submitLabel="Schedule"
        loading={saving}
        dirty={!!form.beneficiary || !!form.scheduledAt}
        onSubmit={schedule}
      >
        <FormSection title="Who & what">
          <div>
            <p className="mb-1.5 text-xs font-medium">
              Beneficiary<span className="ml-0.5 text-destructive">*</span>
            </p>
            {form.beneficiary ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border bg-primary/5 px-3 py-2">
                <span className="truncate text-sm font-medium">{form.beneficiary.label}</span>
                <Button variant="ghost" size="sm" className="h-8 px-2" aria-label="Clear selected beneficiary" onClick={() => setForm({ ...form, beneficiary: null })}>
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <BeneficiarySearch onPick={(b) => setForm({ ...form, beneficiary: { id: b.id, label: b.name } })} />
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium">Professional</p>
            <ProfessionalSelect
              value={form.professionalId}
              onChange={(v) => setForm({ ...form, professionalId: v })}
              placeholder="Optional — any available"
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium">Camp (optional)</p>
            <CampSelect value={form.campId} onChange={(v) => setForm({ ...form, campId: v })} placeholder="Standalone appointment" />
          </div>
          <FieldGrid>
            <SelectField
              label="Type"
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v })}
              options={APPOINTMENT_TYPES.map((t) => ({ value: t, label: humanize(t) }))}
            />
            <TextField
              label="When"
              required
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(v) => setForm({ ...form, scheduledAt: v })}
            />
          </FieldGrid>
          <TextareaField label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} rows={2} placeholder="Anything the professional should know" />
        </FormSection>
      </FormSheet>

      {/* no-show reason */}
      <FormSheet
        open={!!noShowTarget}
        onOpenChange={(o) => {
          if (!o) setNoShowTarget(null);
        }}
        title="Mark no-show"
        description={`Record why ${noShowTarget?.beneficiary?.name ?? "the beneficiary"} missed this appointment — it stays on the timeline.`}
        size="sm"
        submitLabel="Mark no-show"
        loading={acting}
        dirty={!!noShowReason.trim()}
        onSubmit={runNoShow}
      >
        <FormSection title="Reason" description="Optional but recommended for follow-up planning.">
          <TextareaField
            label="No-show reason"
            value={noShowReason}
            onChange={setNoShowReason}
            rows={3}
            placeholder="e.g. Transport unavailable, informed over phone at 9am…"
          />
        </FormSection>
      </FormSheet>
    </div>
  );
}
