"use client";

/**
 * Health Programme — Overview tab.
 *
 * KPI StatCards (upcoming/live camps, registrations, checked-in proxy,
 * encounters, prescriptions, pending labs, overdue follow-ups, verified
 * partners, active doctors, healthcare-category donations), a recent camps
 * list and a pending-actions card. Every KPI loads via Promise.allSettled so
 * a missing backend endpoint degrades to "—" instead of an error page.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  ClipboardPlus,
  FileHeart,
  FlaskConical,
  Hospital,
  Pill,
  Stethoscope,
  Tent,
  TriangleAlert,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { get } from "@/lib/api-client";
import { formatDateTime, formatINR } from "@/lib/format";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { asItems, asPaged, CampStatusBadge, type FollowUpRow, type HealthOrg, type MedicalCamp, type Professional } from "./shared";

export interface TabProps {
  revision: number;
  isAdmin: boolean;
  onNavigate?: (tab: string) => void;
}

interface CategoryAmount {
  category?: string;
  amount?: number;
}

function totalOf(data: unknown): number {
  const d = data as { total?: number } | null;
  if (typeof d?.total === "number") return d.total;
  const arr = asItems<unknown>(data);
  return arr.length;
}

export default function OverviewTab({ revision, onNavigate }: TabProps) {
  const [kpis, setKpis] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [camps, setCamps] = useState<MedicalCamp[]>([]);
  const [overdue, setOverdue] = useState<FollowUpRow[]>([]);
  const [pendingOrgs, setPendingOrgs] = useState<HealthOrg[]>([]);
  const [pendingPros, setPendingPros] = useState<Professional[]>([]);
  const [medicalDonations, setMedicalDonations] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const set = (k: string, v: number | null) => setKpis((p) => ({ ...p, [k]: v }));

    const totals: Array<[string, string]> = [
      ["upcoming", "/api/medical-camps?upcoming=1&limit=1"],
      ["live", "/api/medical-camps?status=LIVE&limit=1"],
      ["registrations", "/api/camp-registrations?limit=1"],
      ["encounters", "/api/encounters?limit=1"],
      ["prescriptions", "/api/prescriptions?limit=1"],
      ["pendingLabs", "/api/lab-orders?status=PENDING&limit=1"],
      ["followUps", "/api/follow-ups?status=PENDING&limit=1"],
      ["partners", "/api/health-orgs?status=VERIFIED&limit=1"],
      ["doctors", "/api/health-professionals?kind=DOCTOR&verificationStatus=VERIFIED&limit=1"],
    ];

    await Promise.allSettled([
      Promise.all(
        totals.map(([k, url]) =>
          get<unknown>(url)
            .then((d) => set(k, totalOf(d)))
            .catch(() => set(k, null))
        )
      ),
      get<unknown>("/api/medical-camps?limit=6&withCounts=1")
        .then((d) => setCamps(asPaged<MedicalCamp>(d).items))
        .catch(() => setCamps([])),
      get<unknown>("/api/follow-ups?overdue=1&limit=4")
        .then((d) => setOverdue(asItems<FollowUpRow>(d).slice(0, 4)))
        .catch(() => setOverdue([])),
      get<unknown>("/api/health-orgs?status=PENDING&limit=4")
        .then((d) => setPendingOrgs(asItems<HealthOrg>(d).slice(0, 4)))
        .catch(() => setPendingOrgs([])),
      get<unknown>("/api/health-professionals?verificationStatus=PENDING&limit=4")
        .then((d) => setPendingPros(asItems<Professional>(d).slice(0, 4)))
        .catch(() => setPendingPros([])),
      get<unknown>("/api/stats")
        .then((d) => {
          const cats = (d as { categories?: CategoryAmount[] })?.categories ?? [];
          const med = cats.find((c) => c.category === "MEDICAL");
          setMedicalDonations(med && typeof med.amount === "number" ? med.amount : null);
        })
        .catch(() => setMedicalDonations(null)),
    ]);

    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, revision]);

  const pendingCount = overdue.length + pendingOrgs.length + pendingPros.length;
  const liveCamp = camps.find((c) => c.status === "LIVE");

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPI grid */}
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-5">
        <StatCard
          label="Upcoming camps"
          value={kpis.upcoming ?? "—"}
          icon={<CalendarPlus className="size-5" aria-hidden="true" />}
          accent="emerald"
          loading={loading}
          hint="Scheduled & draft ahead"
        />
        <StatCard
          label="Live right now"
          value={kpis.live ?? "—"}
          icon={<Tent className="size-5" aria-hidden="true" />}
          accent="teal"
          loading={loading}
          hint="Camps currently on"
        />
        <StatCard
          label="Camp registrations"
          value={kpis.registrations ?? "—"}
          icon={<Users className="size-5" aria-hidden="true" />}
          accent="cyan"
          loading={loading}
          hint="All camps, all time"
        />
        <StatCard
          label="Consultations"
          value={kpis.encounters ?? "—"}
          icon={<Stethoscope className="size-5" aria-hidden="true" />}
          accent="lime"
          loading={loading}
          hint="Doctor encounters logged"
        />
        <StatCard
          label="Prescriptions"
          value={kpis.prescriptions ?? "—"}
          icon={<Pill className="size-5" aria-hidden="true" />}
          accent="pink"
          loading={loading}
        />
        <StatCard
          label="Pending lab orders"
          value={kpis.pendingLabs ?? "—"}
          icon={<FlaskConical className="size-5" aria-hidden="true" />}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="Open follow-ups"
          value={kpis.followUps ?? "—"}
          icon={<CalendarCheck className="size-5" aria-hidden="true" />}
          accent="orange"
          loading={loading}
          hint="Pending or overdue"
        />
        <StatCard
          label="Verified partners"
          value={kpis.partners ?? "—"}
          icon={<Hospital className="size-5" aria-hidden="true" />}
          accent="emerald"
          loading={loading}
          hint="Hospitals, clinics, labs"
        />
        <StatCard
          label="Verified doctors"
          value={kpis.doctors ?? "—"}
          icon={<UserRoundCheck className="size-5" aria-hidden="true" />}
          accent="teal"
          loading={loading}
        />
        <StatCard
          label="Healthcare donations"
          value={medicalDonations === null ? "—" : formatINR(medicalDonations)}
          icon={<FileHeart className="size-5" aria-hidden="true" />}
          accent="pink"
          loading={loading}
          hint="MEDICAL category, completed"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent camps */}
        <SectionCard
          title="Recent camps"
          description="Latest medical camps by date."
          className="lg:col-span-2"
          actions={
            <Button variant="outline" size="sm" className="min-h-9" onClick={() => onNavigate?.("camps")}>
              All camps <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          }
        >
          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : camps.length === 0 ? (
            <EmptyState
              icon={<Tent className="size-7" aria-hidden="true" />}
              title="No camps yet"
              hint="Create the first medical camp from the Camps tab — schedule it, invite partners and open the check-in desk on camp day."
            >
              <Button size="sm" className="min-h-11" onClick={() => onNavigate?.("camps")}>
                <CalendarPlus className="size-4" aria-hidden="true" /> Go to camps
              </Button>
            </EmptyState>
          ) : (
            <ul className="divide-y" aria-label="Recent camps">
              {camps.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {c.title} <span className="ml-1 font-mono text-[10px] text-muted-foreground/70">{c.code}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[formatDateTime(c.campDate).split(",")[0], c.venue, c.city].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {c.counts ? (
                    <Badge variant="outline" className="tabular-nums" title="Registrations / checked-in / completed">
                      {c.counts.registrations ?? 0} reg · {c.counts.checkedIn ?? 0} in · {c.counts.completed ?? 0} done
                    </Badge>
                  ) : null}
                  <CampStatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Pending actions */}
        <SectionCard
          title="Needs attention"
          description="Queue of verifications and overdue work."
          icon={<TriangleAlert className="size-4" aria-hidden="true" />}
          actions={
            <Badge
              variant="outline"
              className={
                pendingCount > 0
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              }
            >
              {pendingCount} pending
            </Badge>
          }
        >
          {loading ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          ) : pendingCount === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="size-7" aria-hidden="true" />}
              title="All clear"
              hint="No overdue follow-ups and no pending partner or professional verifications."
            />
          ) : (
            <div className="space-y-4">
              {liveCamp ? (
                <button
                  type="button"
                  onClick={() => onNavigate?.("camps")}
                  className="flex w-full items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-left transition-colors hover:bg-emerald-500/15"
                >
                  <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      “{liveCamp.title}” is live
                    </span>
                    <span className="block text-xs text-muted-foreground">Open the camp desk to manage the queue</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                </button>
              ) : null}

              {overdue.length > 0 ? (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <ClipboardPlus className="size-3.5" aria-hidden="true" /> Overdue follow-ups
                  </p>
                  <ul className="space-y-1.5">
                    {overdue.map((f) => (
                      <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                        <span className="min-w-0 truncate text-sm">{f.beneficiary?.name ?? "Beneficiary"}</span>
                        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                          Overdue
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  <Button variant="link" size="sm" className="mt-1 h-8 px-0" onClick={() => onNavigate?.("referrals")}>
                    Review follow-ups <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}

              {pendingOrgs.length > 0 || pendingPros.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Verifications waiting
                  </p>
                  <ul className="space-y-1.5">
                    {pendingOrgs.map((o) => (
                      <li key={o.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                        <span className="min-w-0 truncate text-sm">{o.name}</span>
                        <Badge variant="outline" className="shrink-0">{o.type}</Badge>
                      </li>
                    ))}
                    {pendingPros.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                        <span className="min-w-0 truncate text-sm">{p.name}</span>
                        <Badge variant="outline" className="shrink-0">{p.kind}</Badge>
                      </li>
                    ))}
                  </ul>
                  <Button variant="link" size="sm" className="mt-1 h-8 px-0" onClick={() => onNavigate?.("partners")}>
                    Open verifications <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
