"use client";

/**
 * Food Security — Overview tab.
 * KPI StatCards computed from live module data, upcoming distribution events,
 * pending applications worklist and a one-click CSV impact report. Every
 * figure comes from /api/food/* — nothing hardcoded.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Apple, ArrowRight, CalendarClock, ClipboardPlus, HandHeart, PackageCheck,
  PackageOpen, ScanLine, Timer, TriangleAlert, Users,
} from "lucide-react";
import { get } from "@/lib/api-client";
import { formatDate, formatDateTime, formatINR, formatNumber } from "@/lib/format";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { buildCsv } from "@/components/shared/csv";
import { asArray, labelOf, FOOD_PROGRAMME_CATEGORIES, type FoodEvent, type FoodApplication } from "./shared";

interface PublicStats {
  stats: {
    familiesSupported: number;
    individualsReached: number;
    kitsDistributed: number;
    mealsServed: number;
    distributionLocations: number;
    eventsCompleted: number;
    eventsOpen: number;
    activeProgrammes: number;
    activeVolunteers: number;
    totalDonations: number;
  };
  reportingPeriod?: string;
  lastUpdated: string;
}

export default function OverviewTab({ revision, onNavigate }: { revision: number; isAdmin: boolean; onNavigate?: (t: string) => void }) {
  const [data, setData] = useState<PublicStats | null>(null);
  const [events, setEvents] = useState<FoodEvent[]>([]);
  const [applications, setApplications] = useState<FoodApplication[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [stats, evts, apps] = await Promise.all([
        get<PublicStats>("/api/food/public"),
        get<unknown>("/api/food/events"),
        get<unknown>("/api/food/applications?status=PENDING"),
      ]);
      setData(stats);
      setEvents(asArray<FoodEvent>(evts).slice(0, 6));
      setApplications(asArray<FoodApplication>(apps).slice(0, 6));
    } catch {
      // cards degrade to placeholders — keep any previously loaded data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, revision]);

  const s = data?.stats;
  const exportImpact = () => {
    if (!s) return;
    const rows = Object.entries(s).map(([metric, value]) => ({ metric, value: value as string | number }));
    const blob = new Blob(
      [buildCsv(
        [{ header: "Metric", value: (r: { metric: string; value: string | number }) => r.metric }, { header: "Value", value: (r: { metric: string; value: string | number }) => r.value }],
        rows
      )],
      { type: "text/csv;charset=utf-8" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `uar-food-impact-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const upcoming = events
    .filter((e) => !["COMPLETED", "RECONCILED", "CLOSED", "CANCELLED"].includes(e.status))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Families supported"
          value={s ? formatNumber(s.familiesSupported) : ""}
          icon={<Users className="size-5" />}
          accent="emerald"
          loading={loading}
          hint={s ? `${formatNumber(s.individualsReached)} individuals reached` : ""}
        />
        <StatCard
          label="Food kits distributed"
          value={s ? formatNumber(s.kitsDistributed) : ""}
          icon={<PackageCheck className="size-5" />}
          accent="orange"
          loading={loading}
          hint={s ? `${formatNumber(s.mealsServed)} meals served` : ""}
        />
        <StatCard
          label="Active programmes"
          value={s ? formatNumber(s.activeProgrammes) : ""}
          icon={<Apple className="size-5" />}
          accent="cyan"
          loading={loading}
          hint={s ? `${formatNumber(s.eventsOpen)} distributions open for registration` : ""}
        />
        <StatCard
          label="Food donations"
          value={s ? formatINR(s.totalDonations) : ""}
          icon={<HandHeart className="size-5" />}
          accent="amber"
          loading={loading}
          hint={s ? `${formatNumber(s.activeVolunteers)} active food volunteers` : ""}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Upcoming distribution events"
          description="Next events across all food programmes"
          icon={<CalendarClock className="size-4" />}
          actions={
            <Button variant="ghost" size="sm" onClick={() => onNavigate?.("events")}>
              All events <ArrowRight className="size-4" />
            </Button>
          }
        >
          {loading ? (
            <div className="space-y-2 px-5 pb-4">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : upcoming.length === 0 ? (
            <EmptyState
              icon={<PackageOpen className="size-8" />}
              title="No upcoming distributions"
              hint="Create a distribution event to get food moving."
              className="border-0"
            >
              <Button size="sm" onClick={() => onNavigate?.("events")}>Create event</Button>
            </EmptyState>
          ) : (
            <ul className="divide-y px-5 pb-4">
              {upcoming.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ScanLine className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDate(e.eventDate)} · {e.venue}{e.city ? `, ${e.city}` : ""} · {e._count?.registrations ?? 0} registered
                    </p>
                  </div>
                  <StatusBadge status={e.status} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Pending applications"
          description="Food assistance requests awaiting review"
          icon={<ClipboardPlus className="size-4" />}
          actions={
            <Button variant="ghost" size="sm" onClick={() => onNavigate?.("applications")}>
              Review <ArrowRight className="size-4" />
            </Button>
          }
        >
          {loading ? (
            <div className="space-y-2 px-5 pb-4">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : applications.length === 0 ? (
            <EmptyState
              icon={<ClipboardPlus className="size-8" />}
              title="No pending applications"
              hint="New public food assistance requests will appear here."
              className="border-0"
            />
          ) : (
            <ul className="divide-y px-5 pb-4">
              {applications.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${a.urgency === "CRITICAL" || a.urgency === "HIGH" ? "bg-red-500/10 text-red-600" : "bg-amber-500/10 text-amber-600"}`}>
                    <Timer className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.refCode} · {a.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.city ?? "—"} · {labelOf(FOOD_PROGRAMME_CATEGORIES, a.category)} · {formatDateTime(a.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={a.urgency} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Transparency snapshot"
        description="Live operational figures for board & donor reporting"
        icon={<TriangleAlert className="size-4 hidden" />}
        actions={
          <Button variant="outline" size="sm" onClick={exportImpact} disabled={!s}>
            Export CSV
          </Button>
        }
      >
        <dl className="grid gap-3 px-5 pb-5 sm:grid-cols-3 lg:grid-cols-4">
          {s && (Object.entries(s) as Array<[string, number]>).map(([k, v]) => (
            <div key={k} className="rounded-lg border bg-muted/30 p-3">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
              </dt>
              <dd className="mt-0.5 text-lg font-semibold">{k === "totalDonations" ? formatINR(v) : formatNumber(v)}</dd>
            </div>
          ))}
        </dl>
        {data?.lastUpdated ? (
          <p className="px-5 pb-4 text-xs text-muted-foreground">
            Reporting period: {data.reportingPeriod ?? "All time"} · Last updated {formatDate(data.lastUpdated)}
          </p>
        ) : null}
      </SectionCard>
    </div>
  );
}
