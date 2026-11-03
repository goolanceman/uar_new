"use client";

import { useEffect, useState } from "react";
import { get } from "@/lib/api-client";
import { formatNumber, titleCase } from "@/lib/utils";
import { formatINR, formatINRCompact, financialYear } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Coins,
  Flower2,
  HandHeart,
  Heart,
  HeartPulse,
  Info,
  PackageCheck,
  PawPrint,
  Printer,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* New consolidated reports contract                                   */
/* ------------------------------------------------------------------ */

interface FyReport {
  fy?: number;
  kpis?: {
    totalDonations?: number;
    donationCount?: number;
    avgDonation?: number;
    donorCount?: number;
    newDonorsThisFy?: number;
  };
  monthly?: { month?: string; amount?: number; count?: number }[];
  categories?: { category?: string; amount?: number }[];
  topDonors?: unknown[];
  programmes?: {
    kits?: { totalUnits?: number; scannedUnits?: number };
    pads?: { sessions?: number; pads?: number; girls?: number; schools?: number };
    corridor?: { missions?: number; events?: number; vehiclesAlerted?: number; timeSavedMin?: number };
    animals?: { available?: number; adopted?: number; activePledges?: number };
    medicine?: { total?: number; seeking?: number; adopted?: number; monthlyPledged?: number };
  };
  fyTotals?: { amount?: number; count?: number };
}

function lastThreeFyStarts(): number[] {
  const now = new Date();
  const y = now.getFullYear();
  const currentStart = now.getMonth() + 1 >= 4 ? y : y - 1;
  return [currentStart, currentStart - 1, currentStart - 2];
}

/* ================================================================== */

export function ImpactPage() {
  const fyOptions = lastThreeFyStarts();
  const [fy, setFy] = useState<number>(fyOptions[0]);
  const [report, setReport] = useState<FyReport | null>(null);
  const [reportFailed, setReportFailed] = useState(false);
  const [loadedFy, setLoadedFy] = useState<number | null>(null);
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    let alive = true;
    get<FyReport>(`/api/reports?fy=${fy}`)
      .then((d) => {
        if (!alive) return;
        setReport(d && typeof d === "object" ? d : {});
        setReportFailed(false);
        setLoadedFy(fy);
      })
      .catch(() => {
        if (!alive) return;
        setReport({});
        setReportFailed(true);
        setLoadedFy(fy);
      });
    return () => {
      alive = false;
    };
  }, [fy]);

  useEffect(() => {
    let alive = true;
    get<unknown>("/api/stats")
      .then((d) => alive && setStats(pickStats(d)))
      .catch(() => alive && setStats(pickStats(null)));
    return () => {
      alive = false;
    };
  }, []);

  const reportPending = loadedFy !== fy;

  const kpis = report?.kpis;
  const fyTotals = report?.fyTotals;
  const monthly = (report?.monthly ?? [])
    .map((m) => ({ month: m.month ?? "—", amount: Number(m.amount ?? 0) }))
    .filter((m) => Number.isFinite(m.amount));
  const categories = (report?.categories ?? [])
    .map((c) => ({ name: titleCase(c.category ?? "—"), value: Number(c.amount ?? 0) }))
    .filter((c) => c.value > 0);

  const prog = report?.programmes ?? {};

  /* KPI values with stats fallback */
  const raised =
    fyTotals?.amount ?? kpis?.totalDonations ?? stats?.raised ?? 0;
  const donationCount =
    fyTotals?.count ?? kpis?.donationCount ?? stats?.donations ?? 0;
  const avgDonation =
    kpis?.avgDonation ?? (donationCount > 0 ? Math.round(raised / donationCount) : 0);
  const donorCount = kpis?.donorCount ?? null;
  const newDonors = kpis?.newDonorsThisFy ?? null;

  return (
    <div className="print-sheet">
      {/* KPIs + controls */}
      <Section
        title="Impact, measured"
        subtitle="Every figure below is an aggregate — no personal data leaves the platform."
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          <Select value={String(fy)} onValueChange={(v) => setFy(Number(v))}>
            <SelectTrigger className="h-10 w-[150px]" aria-label="Select financial year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fyOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {financialYear(new Date(y, 3, 1))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="min-h-[40px]"
            onClick={() => window.print()}
            aria-label="Print this impact report"
          >
            <Printer className="size-4" aria-hidden /> Print
          </Button>
        </div>
        {report === null && stats === null ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[74px] rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              icon={Heart}
              value={formatINR(raised)}
              label={`Raised in ${financialYear(new Date(fy, 3, 1))}`}
              accent="emerald"
            />
            <Stat
              icon={BadgeCheck}
              value={formatNumber(donationCount)}
              label="Donations recorded"
              accent="pink"
            />
            <Stat
              icon={Coins}
              value={formatINR(avgDonation)}
              label="Average gift"
              accent="teal"
            />
            <Stat
              icon={Users}
              value={
                donorCount !== null
                  ? formatNumber(donorCount)
                  : formatNumber(stats?.beneficiaries ?? 0)
              }
              label={
                donorCount !== null
                  ? newDonors !== null
                    ? `Donors · ${formatNumber(newDonors)} new`
                    : "Donors"
                  : "Beneficiaries reached"
              }
              accent="orange"
            />
          </div>
        )}

        {reportFailed && (
          <Card className="mt-4 border-amber-500/25 bg-amber-500/10 p-4">
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              Detailed FY analytics are syncing — headline KPIs above come from the live public
              snapshot. Sign in as an admin for the full breakdown meanwhile.
            </p>
          </Card>
        )}
      </Section>

      {/* Charts */}
      <Section className="pt-0">
        <div className="grid gap-4 lg:grid-cols-2">
          {report === null || reportPending ? (
            <>
              <Skeleton className="h-80 rounded-xl" />
              <Skeleton className="h-80 rounded-xl" />
            </>
          ) : monthly.length > 0 ? (
            <ChartBox
              title={`Monthly giving — ${financialYear(new Date(fy, 3, 1))}`}
              desc="One-time and monthly gifts combined, April → March."
              type="bar"
              data={monthly}
              xKey="month"
              nameKey="month"
              valueKey="amount"
              colors={["#10b981"]}
            />
          ) : (
            <EmptyState
              icon={TrendingUp}
              title="No giving recorded this FY yet"
              hint="Monthly bars appear as soon as the first donations of the financial year land."
              className="lg:col-span-1"
            />
          )}

          {categories.length > 0 ? (
            <ChartBox
              title="Where the money went"
              desc="Funds raised by programme category."
              type="pie"
              data={categories}
              nameKey="name"
              valueKey="value"
            />
          ) : report !== null ? (
            <EmptyState
              icon={Coins}
              title="Category split pending"
              hint="Once donations are tagged to programmes this FY, the split appears here."
              className="lg:col-span-1"
            />
          ) : null}
        </div>
      </Section>

      {/* Programme scoreboards */}
      <Section title="Programme scoreboards" className="bg-muted/40">
        {report === null || reportPending ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {/* Kits */}
            <Card className="p-6">
              <h3 className="flex items-center gap-2 font-semibold">
                <PackageCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />{" "}
                QR ration kits
              </h3>
              {prog.kits && (prog.kits.totalUnits || prog.kits.scannedUnits) ? (
                <>
                  <div className="mt-4 flex items-baseline justify-between">
                    <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      {formatNumber(Number(prog.kits.scannedUnits ?? 0))}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      scanned of {formatNumber(Number(prog.kits.totalUnits ?? 0))} produced
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Every kit is scanned at the beneficiary&rsquo;s door; unscanned units trigger
                    an audit, never a shrug.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Kit batch data appears once this cycle&rsquo;s assembly day is closed.
                </p>
              )}
            </Card>

            {/* Pads */}
            <Card className="p-6">
              <h3 className="flex items-center gap-2 font-semibold">
                <Flower2 className="size-5 text-pink-600 dark:text-pink-400" aria-hidden />{" "}
                Pad banks & sessions
              </h3>
              {prog.pads && (prog.pads.pads || prog.pads.sessions) ? (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-center">
                  {[
                    { label: "pads distributed", v: prog.pads.pads ?? 0 },
                    { label: "awareness sessions", v: prog.pads.sessions ?? 0 },
                    { label: "girls reached", v: prog.pads.girls ?? 0 },
                    { label: "schools served", v: prog.pads.schools ?? 0 },
                  ].map((x) => (
                    <div key={x.label} className="rounded-lg border p-3">
                      <p className="text-lg font-bold text-pink-600 dark:text-pink-400">
                        {formatNumber(Number(x.v))}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{x.label}</p>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Pad-bank refill logs appear after the first school restock of the cycle.
                </p>
              )}
            </Card>

            {/* Corridor */}
            <Card className="p-6">
              <h3 className="flex items-center gap-2 font-semibold">
                <Ambulance className="size-5 text-red-600 dark:text-red-400" aria-hidden />{" "}
                Green corridor
              </h3>
              {prog.corridor && (prog.corridor.missions || prog.corridor.timeSavedMin) ? (
                <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg border p-3">
                    <Timer className="mx-auto size-4 text-red-600 dark:text-red-400" aria-hidden />
                    <p className="mt-1 text-lg font-bold">
                      {formatNumber(Number(prog.corridor.timeSavedMin ?? 0))}
                    </p>
                    <p className="text-[11px] text-muted-foreground">minutes saved</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <Users className="mx-auto size-4 text-red-600 dark:text-red-400" aria-hidden />
                    <p className="mt-1 text-lg font-bold">
                      {formatNumber(Number(prog.corridor.vehiclesAlerted ?? 0))}
                    </p>
                    <p className="text-[11px] text-muted-foreground">vehicles alerted</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <Ambulance className="mx-auto size-4 text-red-600 dark:text-red-400" aria-hidden />
                    <p className="mt-1 text-lg font-bold">
                      {formatNumber(Number(prog.corridor.missions ?? 0))}
                    </p>
                    <p className="text-[11px] text-muted-foreground">missions</p>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Corridor counters appear after the first logged missions — see the live demo on
                  the programme page.
                </p>
              )}
            </Card>

            {/* Animals */}
            <Card className="p-6">
              <h3 className="flex items-center gap-2 font-semibold">
                <PawPrint className="size-5 text-lime-600 dark:text-lime-400" aria-hidden />{" "}
                Animal welfare
              </h3>
              {prog.animals && (prog.animals.available || prog.animals.adopted) ? (
                <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg border p-3">
                    <p className="text-lg font-bold text-lime-600 dark:text-lime-400">
                      {formatNumber(Number(prog.animals.available ?? 0))}
                    </p>
                    <p className="text-[11px] text-muted-foreground">available</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-lg font-bold text-lime-600 dark:text-lime-400">
                      {formatNumber(Number(prog.animals.adopted ?? 0))}
                    </p>
                    <p className="text-[11px] text-muted-foreground">adopted</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-lg font-bold text-lime-600 dark:text-lime-400">
                      {formatNumber(Number(prog.animals.activePledges ?? 0))}
                    </p>
                    <p className="text-[11px] text-muted-foreground">active pledges</p>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Rescue-board numbers appear once the shelter roster syncs this cycle.
                </p>
              )}
            </Card>

            {/* Medicine */}
            <Card className="p-6">
              <h3 className="flex items-center gap-2 font-semibold">
                <HeartPulse className="size-5 text-teal-600 dark:text-teal-400" aria-hidden />{" "}
                Adopt-a-Medicine
              </h3>
              {prog.medicine && (prog.medicine.total || prog.medicine.monthlyPledged) ? (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                  {[
                    { label: "causes", v: prog.medicine.total ?? 0 },
                    { label: "seeking", v: prog.medicine.seeking ?? 0 },
                    { label: "adopted", v: prog.medicine.adopted ?? 0 },
                    { label: "pledged / mo", v: prog.medicine.monthlyPledged ?? 0, money: true },
                  ].map((x) => (
                    <div key={x.label} className="rounded-lg border p-3">
                      <p className="text-lg font-bold text-teal-600 dark:text-teal-400">
                        {x.money ? formatINRCompact(Number(x.v)) : formatNumber(Number(x.v))}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{x.label}</p>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Adoption ledger numbers appear after the first verified cause is listed.
                </p>
              )}
            </Card>

            {/* Volunteer engagement */}
            <Card className="p-6">
              <h3 className="flex items-center gap-2 font-semibold">
                <HandHeart className="size-5 text-orange-600 dark:text-orange-400" aria-hidden />{" "}
                People powering it
              </h3>
              <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                <div className="rounded-lg border p-3">
                  <p className="text-lg font-bold text-orange-600 dark:text-orange-400">
                    {formatNumber(stats?.volunteers ?? 0)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">active volunteers</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-lg font-bold text-orange-600 dark:text-orange-400">
                    {formatNumber(stats?.campaigns ?? 0)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">active campaigns</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Volunteers run every distribution lane, pad-bank restock and corridor drill —
                two hours a month is all it takes to join them.
              </p>
            </Card>
          </div>
        )}
      </Section>

      {/* Your ₹ at work */}
      <Section title="Your ₹ at work" subtitle="The split we publish — and audit — every single year.">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartBox
            title="Where every ₹100 goes"
            desc="Programmes first. The lean ops desk keeps the lights on and the audits clean."
            type="pie"
            data={[
              { name: "Programmes", value: 92 },
              { name: "Ops & admin", value: 5 },
              { name: "Fundraising & audit", value: 3 },
            ]}
            nameKey="name"
            valueKey="value"
            colors={["#10b981", "#f59e0b", "#84cc16"]}
          />
          <Card className="p-6">
            <h3 className="flex items-center gap-2 font-semibold">
              <Info className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden /> How to
              read these numbers
            </h3>
            <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
              <li>
                • <strong className="text-foreground">Money</strong> is counted when a donation is
                recorded, not when promised; refunds are subtracted.
              </li>
              <li>
                • <strong className="text-foreground">Beneficiaries</strong> are unique people
                served through verified distributions — QR scans, pad-bank logs and medicine
                deliveries.
              </li>
              <li>
                • <strong className="text-foreground">Corridor savings</strong> come from
                per-segment timestamps: crossing time minus the corridor baseline for the same
                congestion level.
              </li>
              <li>
                • <strong className="text-foreground">Privacy</strong>: this page is fully
                aggregate — the public report never shows personal donor or beneficiary data.
              </li>
              <li>
                • Administration stays under 8%; the split is published in the annual audit
                (80G · 12A registered).
              </li>
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">
              Categories tracked: {["FOOD_DISTRIBUTION", "SANITARY_PADS", "MEDICAL", "SAFETY", "ANIMAL", "MOBILITY", "AWARENESS"].map((c) => titleCase(c)).join(" · ")}
            </p>
          </Card>
        </div>
      </Section>
    </div>
  );
}
