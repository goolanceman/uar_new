"use client";

import { useEffect, useState } from "react";
import { get } from "@/lib/api-client";
import { formatINR, formatNumber, titleCase } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Section,
  Stat,
  ChartBox,
  EmptyState,
  pickStats,
  type PublicStats,
} from "@/components/public/shared";
import {
  Ambulance,
  BadgeCheck,
  HandHeart,
  Heart,
  Info,
  PackageCheck,
  Timer,
  Users,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Defensive report shapes                                             */
/* ------------------------------------------------------------------ */

interface OverviewReport {
  monthly?: { month?: string; raised?: number; beneficiaries?: number }[];
  byCampaign?: { name?: string; value?: number; raised?: number }[];
  byRole?: { name?: string; value?: number }[];
  distributionTypes?: { name?: string; value?: number }[];
  kits?: { totalUnits?: number; scannedUnits?: number; batches?: number } | { totalUnits?: number; scannedUnits?: number; batches?: number }[];
  corridor?: {
    missions?: number;
    timeSavedSec?: number;
    timeSavedMin?: number;
    vehiclesAlerted?: number;
  };
}

function asObject(raw: unknown): Record<string, unknown> {
  return (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> ?? {};
}

function numArr(
  arr: { name?: string; value?: number; raised?: number }[] | undefined,
  valueKey: "value" | "raised"
): Record<string, unknown>[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((d) => ({ name: d.name ?? "—", value: Number(d[valueKey] ?? d.value ?? 0) }))
    .filter((d) => Number.isFinite(d.value));
}

/* ================================================================== */

export function ImpactPage() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [report, setReport] = useState<OverviewReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    get<unknown>("/api/stats")
      .then((d) => alive && setStats(pickStats(d)))
      .catch(() => alive && setStats(pickStats(null)));
    get<unknown>("/api/reports?type=overview")
      .then((d) => {
        if (!alive) return;
        const o = asObject(d) as OverviewReport;
        setReport(o);
      })
      .catch(() => {
        if (alive) {
          setReport({});
          setFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const monthly = Array.isArray(report?.monthly)
    ? report!.monthly!.map((m) => ({
        month: m.month ?? "—",
        raised: Number(m.raised ?? 0),
      }))
    : [];
  const byCampaign = numArr(report?.byCampaign, "raised").slice(0, 8);
  const byRole = numArr(report?.byRole, "value");
  const distTypes = numArr(report?.distributionTypes, "value");

  const kitsRaw = report?.kits;
  const kits = Array.isArray(kitsRaw) ? kitsRaw[0] : kitsRaw;
  const kitTotal = Number(kits?.totalUnits ?? 0);
  const kitScanned = Number(kits?.scannedUnits ?? 0);
  const kitPct = kitTotal > 0 ? Math.min(100, Math.round((kitScanned / kitTotal) * 100)) : 0;

  const corridor = report?.corridor;
  const corridorMin =
    Number(corridor?.timeSavedMin ?? 0) || Math.round(Number(corridor?.timeSavedSec ?? 0) / 60);

  return (
    <>
      {/* KPIs */}
      <Section
        title="Impact, measured"
        subtitle="Live numbers from the platform — donations, distributions and corridor events, updated as they happen."
      >
        {stats === null ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[74px] rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={Heart} value={formatINR(stats.raised)} label="Total raised" accent="emerald" />
            <Stat icon={Users} value={formatNumber(stats.beneficiaries)} label="Beneficiaries reached" accent="orange" />
            <Stat icon={HandHeart} value={formatNumber(stats.volunteers)} label="Volunteers engaged" accent="teal" />
            <Stat icon={BadgeCheck} value={formatNumber(stats.donations)} label="Donations recorded" accent="pink" />
          </div>
        )}
      </Section>

      {failed && (
        <Section className="pt-0">
          <Card className="border-amber-200 bg-amber-50/60 p-4">
            <p className="flex items-start gap-2 text-sm text-amber-800">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              Detailed reports are syncing — some charts below may be waiting on their first data
              cycle. KPIs above are live.
            </p>
          </Card>
        </Section>
      )}

      {/* Charts */}
      <Section className="pt-4">
        <div className="grid gap-4 lg:grid-cols-2">
          {monthly.length > 0 ? (
            <ChartBox
              title="Funds raised by month"
              desc="All programmes combined — one-time and recurring gifts."
              type="area"
              data={monthly}
              xKey="month"
              nameKey="month"
              valueKey="raised"
              colors={["#10b981"]}
            />
          ) : report === null ? (
            <Skeleton className="h-80 rounded-xl" />
          ) : null}

          {byCampaign.length > 0 ? (
            <ChartBox
              title="Raised by programme"
              desc="Top campaigns by funds raised to date."
              type="bar"
              data={byCampaign}
              xKey="name"
              nameKey="name"
              valueKey="value"
            />
          ) : report === null ? (
            <Skeleton className="h-80 rounded-xl" />
          ) : null}

          {byRole.length > 0 && (
            <ChartBox
              title="Community by role"
              desc="Who powers UAR — donors, volunteers and staff on the platform."
              type="pie"
              data={byRole}
              nameKey="name"
              valueKey="value"
              colors={["#10b981", "#f97316", "#d946ef", "#f59e0b", "#14b8a6"]}
            />
          )}

          {distTypes.length > 0 && (
            <ChartBox
              title="Distributions by type"
              desc="What actually left our hubs — kits, pads, medicine, animal feed."
              type="bar"
              data={distTypes}
              xKey="name"
              nameKey="name"
              valueKey="value"
              colors={["#14b8a6", "#ec4899", "#f59e0b", "#84cc16", "#06b6d4"]}
            />
          )}

          {report !== null &&
            monthly.length === 0 &&
            byCampaign.length === 0 &&
            byRole.length === 0 &&
            distTypes.length === 0 && (
              <EmptyState
                icon={PackageCheck}
                title="Charts are filling up"
                hint="As donations and distributions are recorded this cycle, the monthly and programme charts appear here."
                className="lg:col-span-2"
              />
            )}
        </div>
      </Section>

      {/* Kits + corridor */}
      <Section title="Programme scoreboards" className="bg-muted/40">
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Kit progress */}
          <Card className="p-6">
            <h3 className="flex items-center gap-2 font-semibold">
              <PackageCheck className="size-5 text-emerald-600" aria-hidden /> QR ration kits
            </h3>
            {kitTotal > 0 ? (
              <>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-2xl font-bold text-emerald-700">
                    {formatNumber(kitScanned)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    scanned of {formatNumber(kitTotal)} produced
                  </span>
                </div>
                <Progress value={kitPct} className="mt-3 h-2.5" aria-label={`${kitPct}% kits scanned`} />
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {kitPct}% of produced kits have a doorstep scan — the rest are in transit or
                  scheduled for this week&rsquo;s lanes. Unscanned units trigger an audit, never a shrug.
                </p>
                {kits?.batches ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatNumber(Number(kits.batches))} active batches
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Kit batch data appears once the first assembly day of the cycle is closed.
              </p>
            )}
          </Card>

          {/* Corridor savings */}
          <Card className="p-6">
            <h3 className="flex items-center gap-2 font-semibold">
              <Ambulance className="size-5 text-red-600" aria-hidden /> Green corridor savings
            </h3>
            {corridor && (corridor.missions || corridorMin || corridor.vehiclesAlerted) ? (
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <Timer className="mx-auto size-4 text-red-600" aria-hidden />
                  <p className="mt-1 text-lg font-bold">{formatNumber(corridorMin)}</p>
                  <p className="text-[11px] text-muted-foreground">minutes saved</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <Users className="mx-auto size-4 text-red-600" aria-hidden />
                  <p className="mt-1 text-lg font-bold">
                    {formatNumber(Number(corridor.vehiclesAlerted ?? 0))}
                  </p>
                  <p className="text-[11px] text-muted-foreground">vehicles alerted</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <Ambulance className="mx-auto size-4 text-red-600" aria-hidden />
                  <p className="mt-1 text-lg font-bold">{formatNumber(Number(corridor.missions ?? 0))}</p>
                  <p className="text-[11px] text-muted-foreground">corridor missions</p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Corridor counters appear after the first logged missions. Every corridor event is
                timestamped per segment — see the live demo on the programme page.
              </p>
            )}
          </Card>
        </div>
      </Section>

      {/* Transparency note */}
      <Section>
        <Card className="mx-auto max-w-3xl border-emerald-200 bg-emerald-50/60 p-6">
          <h3 className="flex items-center gap-2 font-semibold text-emerald-900">
            <Info className="size-5 text-emerald-700" aria-hidden /> How to read these numbers
          </h3>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-emerald-900/80">
            <li>
              • <strong>Money</strong> is counted when a donation is recorded, not when promised;
              refunds are subtracted.
            </li>
            <li>
              • <strong>Beneficiaries</strong> are unique people served through verified
              distributions — QR scans, pad-bank logs and medicine deliveries.
            </li>
            <li>
              • <strong>Corridor savings</strong> come from per-segment timestamps: crossing time
              minus the corridor baseline for the same congestion level.
            </li>
            <li>
              • Administration stays under 8%; the split is published in the annual audit
              (80G · 12A registered).
            </li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Categories shown across reports: {["FOOD_DISTRIBUTION", "SANITARY_PADS", "MEDICAL", "SAFETY", "ANIMAL", "MOBILITY", "AWARENESS"].map((c) => titleCase(c)).join(" · ")}
          </p>
        </Card>
      </Section>
    </>
  );
}
