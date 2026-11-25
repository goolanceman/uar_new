"use client";

/**
 * Doctor portal — Overview. Today's appointments, assigned camps (LIVE first),
 * pending follow-ups and quick stats. Works for DOCTOR/NURSE/PHARMACIST/LAB_TECH
 * (each role simply sees what the APIs return for them).
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CalendarClock,
  CalendarDays,
  ClipboardPlus,
  HeartPulse,
  Pill,
  RefreshCw,
  Stethoscope,
  Users,
} from "lucide-react";
import type { SessionUser } from "@/hooks/use-auth";
import { get } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  asArray,
  medTone,
  QuietEmpty,
  type CampSummary,
  type FollowUpRow,
} from "./shared";

interface AppointmentLite {
  id: string;
  status: string;
  scheduledAt?: string | null;
  beneficiary?: { id: string; name: string } | null;
  notes?: string | null;
}

export default function DoctorOverview({ user }: { user: SessionUser }) {
  const [appointments, setAppointments] = useState<AppointmentLite[]>([]);
  const [camps, setCamps] = useState<CampSummary[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Each source is independent — one missing backend endpoint never blanks
    // the whole page. Pending follow-ups = not DONE/MISSED/CANCELLED.
    try {
      const day = new Date();
      const from = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      const results = await Promise.all([
        get<unknown>(`/api/appointments?from=${from}&to=${from}`).catch((e: unknown) => ({
          __err: e instanceof Error ? e.message : "Could not load appointments",
        })),
        get<unknown>("/api/medical-camps?upcoming=1&status=SCHEDULED,LIVE").catch((e: unknown) => ({
          __err: e instanceof Error ? e.message : "Could not load camps",
        })),
        get<unknown>("/api/follow-ups?status=PENDING").catch((e: unknown) => ({
          __err: e instanceof Error ? e.message : "Could not load follow-ups",
        })),
      ]);
      const [a, c, f] = results;
      setAppointments("__err" in (a as object) ? [] : asArray<AppointmentLite>(a));
      setCamps("__err" in (c as object) ? [] : asArray<CampSummary>(c));
      setFollowUps("__err" in (f as object) ? [] : asArray<FollowUpRow>(f));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // LIVE camps first, then by start date.
  const sortedCamps = [...camps].sort((x, y) => {
    if (x.status === "LIVE" && y.status !== "LIVE") return -1;
    if (y.status === "LIVE" && x.status !== "LIVE") return 1;
    return new Date(x.campDate).getTime() - new Date(y.campDate).getTime();
  });
  const liveCount = camps.filter((c) => c.status === "LIVE").length;
  const todayCount = appointments.filter(
    (a) => a.scheduledAt && new Date(a.scheduledAt).toDateString() === new Date().toDateString()
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Namaste, Dr. ${user.name.replace(/^Dr\.?\s+/i, "").split(" ")[0]}`}
        description="Your clinical day at a glance — camps, appointments and pending follow-ups."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 gap-1.5 sm:min-h-9"
            onClick={load}
            aria-label="Refresh overview"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Appointments today"
          value={loading ? "" : String(todayCount)}
          icon={<CalendarDays className="size-5" />}
          accent="emerald"
          loading={loading}
        />
        <StatCard
          label="Camps live now"
          value={loading ? "" : String(liveCount)}
          icon={<Stethoscope className="size-5" />}
          accent="teal"
          hint={liveCount > 0 ? "Head to Camps to open the queue" : "No camp running"}
          loading={loading}
        />
        <StatCard
          label="Pending follow-ups"
          value={loading ? "" : String(followUps.length)}
          icon={<CalendarClock className="size-5" />}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="Upcoming camps"
          value={loading ? "" : String(camps.length)}
          icon={<ClipboardPlus className="size-5" />}
          accent="lime"
          loading={loading}
        />
      </div>

      {/* Today's appointments */}
      <SectionCard
        title="Today's appointments"
        description="Scheduled consults for today"
        icon={<CalendarDays className="size-5" />}
      >
        {loading ? (
          <div className="space-y-3" aria-label="Loading appointments">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : appointments.length === 0 ? (
          <QuietEmpty
            icon={<CalendarDays className="size-5" />}
            title="No appointments today"
            hint="Appointments booked with you appear here once patients or the desk schedule them."
          />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto scrollbar-thin">
            {appointments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Users className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {a.beneficiary?.name ?? "Patient"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.scheduledAt ? formatDateTime(a.scheduledAt) : "Time to be confirmed"}
                    {a.notes ? ` · ${a.notes}` : ""}
                  </p>
                </div>
                <StatusBadge status={a.status} tone={medTone(a.status)} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Assigned camps */}
      <SectionCard
        title="My camps"
        description="Live camps first, then upcoming"
        icon={<Stethoscope className="size-5" />}
      >
        {loading ? (
          <div className="space-y-3" aria-label="Loading camps">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : sortedCamps.length === 0 ? (
          <QuietEmpty
            icon={<Stethoscope className="size-5" />}
            title="No camps assigned yet"
            hint="When you're rostered to a medical camp it will appear here."
          />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto scrollbar-thin">
            {sortedCamps.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                <span
                  className={
                    c.status === "LIVE"
                      ? "flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                  }
                >
                  <HeartPulse className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(c.campDate)}
                    {c.venue ? ` · ${c.venue}` : ""}
                  </p>
                </div>
                <StatusBadge status={c.status} tone={medTone(c.status)} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Pending follow-ups */}
      <SectionCard
        title="Pending follow-ups"
        description="Patients waiting to be called back"
        icon={<CalendarClock className="size-5" />}
      >
        {loading ? (
          <div className="space-y-3" aria-label="Loading follow-ups">
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : followUps.length === 0 ? (
          <QuietEmpty
            icon={<CalendarClock className="size-5" />}
            title="No pending follow-ups"
            hint="Follow-ups you or a nurse schedule will be listed here until they're done."
          />
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto scrollbar-thin">
            {followUps.slice(0, 10).map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {f.beneficiary?.name ?? "Patient"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Due {formatDate(f.dueDate)}
                    {f.notes ? ` · ${f.notes}` : ""}
                  </p>
                </div>
                <StatusBadge status={f.status} tone={medTone(f.status)} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Activity className="size-3.5" aria-hidden="true" />
        Prescriptions, lab orders and referrals live in their own tabs — everything you sign is logged.
        <Pill className="size-3.5" aria-hidden="true" />
      </p>
    </div>
  );
}
