"use client";

/**
 * Doctor portal — Camps. My camps list + camp day view: patient queue
 * (attendance list with WAITING → IN_CONSULTATION → COMPLETED / NO_SHOW
 * progression) and a start-consultation action that opens the patient
 * workbench in the Patients tab.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  HeartPulse,
  MapPin,
  RefreshCw,
  Stethoscope,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ageSexLine,
  asArray,
  ListSkeleton,
  medTone,
  QuietEmpty,
  toastError,
  type AttendanceRow,
  type BeneficiaryLite,
  type CampSummary,
} from "./shared";

interface CampDetail extends CampSummary {
  description?: string | null;
  campPartners?: Array<{ id: string; org?: { name?: string } | null; status?: string }>;
  campStaff?: Array<{ id: string; professional?: { name?: string; kind?: string } | null }>;
}

export interface DoctorCampsProps {
  user: SessionUser;
  /** Opens the patient workbench in the Patients tab (router-level handoff). */
  onOpenPatient?: (beneficiary: BeneficiaryLite) => void;
}

export default function DoctorCamps({ onOpenPatient }: DoctorCampsProps) {
  const [camps, setCamps] = useState<CampSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [camp, setCamp] = useState<CampDetail | null>(null);
  const [campLoading, setCampLoading] = useState(false);
  const [queue, setQueue] = useState<AttendanceRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  const loadCamps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<unknown>("/api/medical-camps?upcoming=1&status=SCHEDULED,LIVE");
      const list = asArray<CampSummary>(data).sort((x, y) => {
        if (x.status === "LIVE" && y.status !== "LIVE") return -1;
        if (y.status === "LIVE" && x.status !== "LIVE") return 1;
        return new Date(x.campDate).getTime() - new Date(y.campDate).getTime();
      });
      setCamps(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load camps");
      setCamps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCamps();
  }, [loadCamps]);

  const openCamp = useCallback(async (id: string) => {
    setCampLoading(true);
    setCamp(null);
    try {
      const detail = await get<CampDetail>(`/api/medical-camps/${id}`);
      setCamp((detail && typeof detail === "object" && "id" in detail ? detail : null) ?? null);
    } catch (e) {
      toastError(e, "Could not open the camp");
      // Fall back to a minimal shell so the queue is still usable.
      setCamp({ id, title: "Camp", campDate: new Date().toISOString(), status: "LIVE" });
    } finally {
      setCampLoading(false);
    }
  }, []);

  const loadQueue = useCallback(async (campId: string) => {
    setQueueLoading(true);
    try {
      const data = await get<unknown>(`/api/camp-attendance?campId=${campId}`);
      setQueue(asArray<AttendanceRow>(data));
    } catch (e) {
      setQueue([]);
      toastError(e, "Could not load the patient queue");
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (camp) void loadQueue(camp.id);
  }, [camp, loadQueue]);

  const advance = async (row: AttendanceRow, status: string) => {
    setAdvancingId(row.id);
    try {
      // The camp queue API takes { id, status } in the body (no :id route).
      await patch("/api/camp-attendance", { id: row.id, status });
      setQueue((prev) => prev.map((r) => (r.id === row.id ? { ...r, status } : r)));
      if (status === "COMPLETED") toast.success("Consultation completed");
    } catch (e) {
      toastError(e, "Could not update the queue");
    } finally {
      setAdvancingId(null);
    }
  };

  /* ─────────────────────────── camp day view ─────────────────────────── */

  if (camp) {
    const waiting = queue.filter((r) => r.status === "WAITING").length;
    const inConsult = queue.filter((r) => r.status === "IN_CONSULTATION").length;
    const completed = queue.filter((r) => r.status === "COMPLETED").length;
    return (
      <div className="space-y-6">
        <PageHeader
          title={camp.title}
          description={`${formatDate(camp.campDate)}${camp.venue ? ` · ${camp.venue}` : ""}`}
          icon={<HeartPulse className="size-5" />}
          actions={
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-1.5 sm:min-h-9"
              onClick={() => setCamp(null)}
              aria-label="Back to my camps"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              All camps
            </Button>
          }
        />

        <div className="grid grid-cols-3 gap-3" aria-label="Queue summary">
          {[
            { label: "Waiting", value: waiting },
            { label: "In consultation", value: inConsult },
            { label: "Completed", value: completed },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border bg-card p-3 text-center sm:p-4">
              <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
            </div>
          ))}
        </div>

        <SectionCard
          title="Patient queue"
          description="Advance each patient as the consultation progresses"
          icon={<CalendarCheck className="size-5" />}
          actions={
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 gap-1 sm:min-h-9"
              onClick={() => void loadQueue(camp.id)}
              aria-label="Refresh queue"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
          }
        >
          {queueLoading || campLoading ? (
            <ListSkeleton rows={4} />
          ) : queue.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck className="size-5" />}
              title="Nobody in the queue yet"
              hint="Patients appear here once the registration desk checks them in for this camp."
            />
          ) : (
            <ul className="max-h-[32rem] divide-y overflow-y-auto scrollbar-thin">
              {queue.map((row) => {
                const b = row.beneficiary;
                const busy = advancingId === row.id;
                return (
                  <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] font-bold text-primary"
                    >
                      {row.queueToken ? String(row.queueToken).replace(/\D/g, "").slice(-2) || "•" : "•"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{b?.name ?? "Patient"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {ageSexLine(b)}
                        {row.checkInAt ? ` · checked in ${formatDateTime(row.checkInAt)}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={row.status} tone={medTone(row.status)} />
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      {(row.status === "CHECKED_IN" || row.status === "WAITING") && (
                        <>
                          <Button
                            size="sm"
                            className="min-h-11 flex-1 gap-1.5 sm:min-h-9 sm:flex-none"
                            disabled={busy}
                            onClick={() => {
                              void advance(row, "IN_CONSULTATION");
                              if (b) onOpenPatient?.(b);
                            }}
                          >
                            <Stethoscope className="size-4" aria-hidden="true" />
                            Start consultation
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-11 sm:min-h-9"
                            disabled={busy}
                            onClick={() => void advance(row, "NO_SHOW")}
                            aria-label={`Mark ${b?.name ?? "patient"} as no-show`}
                          >
                            <UserX className="size-4" aria-hidden="true" />
                            <span className="sr-only sm:not-sr-only sm:text-xs">No-show</span>
                          </Button>
                        </>
                      )}
                      {row.status === "IN_CONSULTATION" && (
                        <Button
                          size="sm"
                          className="min-h-11 flex-1 gap-1.5 sm:min-h-9 sm:flex-none"
                          disabled={busy}
                          onClick={() => void advance(row, "COMPLETED")}
                        >
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                          Complete
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        {camp.campStaff && camp.campStaff.length > 0 && (
          <SectionCard title="Camp staff" description="Professionals rostered for this camp" icon={<Stethoscope className="size-5" />}>
            <ul className="flex flex-wrap gap-2">
              {camp.campStaff.map((s) => (
                <li
                  key={s.id}
                  className="rounded-full border bg-muted/40 px-3 py-1.5 text-xs font-medium"
                >
                  {s.professional?.name ?? "Staff member"}
                  {s.professional?.kind ? ` · ${s.professional.kind.replace("_", " ")}` : ""}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>
    );
  }

  /* ─────────────────────────── camps list ─────────────────────────────── */

  return (
    <div className="space-y-6">
      <PageHeader
        title="My camps"
        description="Medical camps you're rostered for — open one to run the day's queue."
        icon={<Stethoscope className="size-5" />}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 gap-1.5 sm:min-h-9"
            onClick={loadCamps}
            aria-label="Refresh camps"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {loading ? (
        <ListSkeleton rows={3} />
      ) : camps.length === 0 ? (
        <QuietEmpty
          icon={<Stethoscope className="size-5" />}
          title="No camps on your roster"
          error={error}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {camps.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => void openCamp(c.id)}
              aria-label={`Open camp ${c.title}`}
              className="group flex min-h-11 flex-col gap-2 rounded-xl border bg-card p-5 text-left shadow-sm outline-none transition hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <HeartPulse className="size-4" aria-hidden="true" />
                </span>
                <StatusBadge status={c.status} tone={medTone(c.status)} />
              </div>
              <p className="text-sm font-semibold">{c.title}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                {formatDate(c.campDate)}
                {c.venue ? ` · ${c.venue}` : ""}
              </p>
              <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-medium text-primary">
                Open camp day
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
