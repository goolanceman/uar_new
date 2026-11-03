"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Coins,
  Download,
  FileBarChart,
  HandCoins,
  HandHeart,
  Package,
  Printer,
  RefreshCw,
  Siren,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import {
  formatDuration,
  formatINR,
  formatINRCompact,
  titleCase,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ---------------------------------- types ---------------------------------- */

interface ReportPayload {
  fy?: number;
  kpis?: {
    totalDonations?: number;
    donationCount?: number;
    avgDonation?: number;
    donorCount?: number;
    newDonorsThisFy?: number;
  };
  monthly?: { month: string; amount: number; count: number }[];
  categories?: { category: string; amount: number }[];
  topDonors?: { name: string; amount: number; count: number }[];
  programmes?: {
    kits?: { totalUnits?: number; scannedUnits?: number };
    pads?: { sessions?: number; pads?: number; girls?: number; schools?: number };
    corridor?: { missions?: number; events?: number; vehiclesAlerted?: number; timeSavedMin?: number };
    animals?: { available?: number; adopted?: number; activePledges?: number };
    medicine?: { total?: number; seeking?: number; adopted?: number; monthlyPledged?: number };
  };
  fyTotals?: { amount?: number; count?: number };
}

/* ----------------------------- chart palette ------------------------------- */

const PIE_COLORS = [
  "#10b981", // emerald
  "#14b8a6", // teal
  "#f59e0b", // amber
  "#f97316", // orange
  "#ec4899", // pink
  "#d946ef", // fuchsia
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#ef4444", // red
];

/* --------------------------------- helpers --------------------------------- */

function currentFyStart(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

function fyLabel(start: number): string {
  return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

/* ---------------------------------- view ----------------------------------- */

export default function ReportsView() {
  const thisFy = currentFyStart();
  const fyOptions = useMemo(
    () => [0, 1, 2, 3, 4].map((i) => thisFy - i),
    [thisFy]
  );
  const [fy, setFy] = useState<number>(thisFy);
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (year: number) => {
      setLoading(true);
      try {
        const res = await get<ReportPayload>(`/api/reports?fy=${year}`);
        setData(res ?? {});
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load report");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load(fy);
  }, [fy, load]);

  const k = data?.kpis ?? {};
  const p = data?.programmes ?? {};
  const kits = p.kits ?? {};
  const pads = p.pads ?? {};
  const corridor = p.corridor ?? {};
  const animals = p.animals ?? {};
  const medicine = p.medicine ?? {};

  const monthly = data?.monthly ?? [];
  const categories = data?.categories ?? [];
  const topDonors = data?.topDonors ?? [];

  const kitPct =
    kits.totalUnits && kits.totalUnits > 0
      ? Math.min(100, Math.round(((kits.scannedUnits ?? 0) / kits.totalUnits) * 100))
      : 0;

  const exportCsv = () => {
    const rows: string[] = [];
    rows.push(`United Angel Reach — Impact Report,${fyLabel(fy)}`);
    rows.push("");
    rows.push("Section,Metric,Value");
    rows.push(`KPIs,Total raised,${k.totalDonations ?? 0}`);
    rows.push(`KPIs,Donations,${k.donationCount ?? 0}`);
    rows.push(`KPIs,Average gift,${k.avgDonation ?? 0}`);
    rows.push(`KPIs,Active donors,${k.donorCount ?? 0}`);
    rows.push(`KPIs,New donors this FY,${k.newDonorsThisFy ?? 0}`);
    rows.push("");
    rows.push("Month,Amount (INR),Donations");
    for (const m of monthly) rows.push([csvEscape(m.month), m.amount, m.count].join(","));
    rows.push("");
    rows.push("Category,Amount (INR)");
    for (const c of categories) rows.push([csvEscape(c.category), c.amount].join(","));
    rows.push("");
    rows.push("Top donor,Amount (INR),Gifts");
    for (const d of topDonors) rows.push([csvEscape(d.name), d.amount, d.count].join(","));
    rows.push("");
    rows.push("Programme,Metric,Value");
    rows.push(`Ration kits,Total units,${kits.totalUnits ?? 0}`);
    rows.push(`Ration kits,Scanned units,${kits.scannedUnits ?? 0}`);
    rows.push(`Sanitary pads,Sessions,${pads.sessions ?? 0}`);
    rows.push(`Sanitary pads,Pads,${pads.pads ?? 0}`);
    rows.push(`Sanitary pads,Girls,${pads.girls ?? 0}`);
    rows.push(`Sanitary pads,Schools,${pads.schools ?? 0}`);
    rows.push(`Green corridor,Missions,${corridor.missions ?? 0}`);
    rows.push(`Green corridor,Events,${corridor.events ?? 0}`);
    rows.push(`Green corridor,Vehicles alerted,${corridor.vehiclesAlerted ?? 0}`);
    rows.push(`Green corridor,Time saved (min),${corridor.timeSavedMin ?? 0}`);
    rows.push(`Animals,Available,${animals.available ?? 0}`);
    rows.push(`Animals,Adopted,${animals.adopted ?? 0}`);
    rows.push(`Animals,Active pledges,${animals.activePledges ?? 0}`);
    rows.push(`Adopt-a-Medicine,Total causes,${medicine.total ?? 0}`);
    rows.push(`Adopt-a-Medicine,Seeking,${medicine.seeking ?? 0}`);
    rows.push(`Adopt-a-Medicine,Adopted,${medicine.adopted ?? 0}`);
    rows.push(`Adopt-a-Medicine,Monthly pledged (INR),${medicine.monthlyPledged ?? 0}`);

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `uar-impact-${fyLabel(fy).replace(/\s/g, "")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Report exported as CSV");
  };

  const empty = !loading && (!data || (data.fyTotals?.count ?? 0) === 0 && monthly.every((m) => !m.amount));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Consolidated fundraising and programme impact for the financial year (April → March)."
        icon={<FileBarChart className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Select
              value={String(fy)}
              onValueChange={(v) => setFy(Number(v))}
              disabled={loading}
            >
              <SelectTrigger className="w-36" aria-label="Financial year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fyOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {fyLabel(y)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={exportCsv} aria-label="Export report as CSV">
              <Download className="size-4" aria-hidden="true" /> Export CSV
            </Button>
            <Button variant="outline" onClick={() => window.print()} aria-label="Print report">
              <Printer className="size-4" aria-hidden="true" /> Print report
            </Button>
          </>
        }
      />

      {loading ? (
        <div className="space-y-4" aria-busy="true">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <StatCard key={i} label="Loading" value="" loading accent="emerald" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : empty ? (
        <EmptyState
          icon={<FileBarChart className="size-8" aria-hidden="true" />}
          title={`No activity recorded in ${fyLabel(fy)}`}
          hint="Donations, distributions and programme data for this financial year will appear here."
        />
      ) : (
        <div className="print-sheet space-y-6">
          {/* ============================== KPI ROW ============================== */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total raised"
              value={formatINRCompact(k.totalDonations ?? 0)}
              icon={<Coins className="size-5" aria-hidden="true" />}
              accent="emerald"
              hint={formatINR(k.totalDonations ?? 0)}
            />
            <StatCard
              label="Donations"
              value={(k.donationCount ?? 0).toLocaleString("en-IN")}
              icon={<Activity className="size-5" aria-hidden="true" />}
              accent="teal"
              hint={`${data?.fyTotals?.count ?? k.donationCount ?? 0} completed gifts`}
            />
            <StatCard
              label="Average gift"
              value={formatINR(k.avgDonation ?? 0)}
              icon={<TrendingUp className="size-5" aria-hidden="true" />}
              accent="amber"
              hint={fyLabel(fy)}
            />
            <StatCard
              label="Active donors"
              value={(k.donorCount ?? 0).toLocaleString("en-IN")}
              icon={<Users className="size-5" aria-hidden="true" />}
              accent="pink"
              hint={`+${k.newDonorsThisFy ?? 0} new this FY`}
            />
          </div>

          {/* =============================== CHARTS =============================== */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Monthly giving"
              description={`Donation inflow across ${fyLabel(fy)}`}
              icon={<TrendingUp className="size-4" aria-hidden="true" />}
            >
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis
                      yAxisId="amt"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => formatINRCompact(v)}
                      width={56}
                    />
                    <YAxis yAxisId="cnt" orientation="right" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
                    <Tooltip
                      formatter={(value, name) =>
                        name === "amount"
                          ? [formatINR(Number(value)), "Amount"]
                          : [String(value), "Gifts"]
                      }
                      contentStyle={{ borderRadius: 12, fontSize: 12 }}
                    />
                    <Bar yAxisId="amt" dataKey="amount" name="amount" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={38} />
                    <Line
                      yAxisId="cnt"
                      type="monotone"
                      dataKey="count"
                      name="count"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Bars: amount raised · Line: number of donations
              </p>
            </SectionCard>

            <SectionCard
              title="Giving by category"
              description="Where the money went, by donation category"
              icon={<HandHeart className="size-4" aria-hidden="true" />}
            >
              {categories.length === 0 ? (
                <div className="grid h-72 place-items-center text-sm text-muted-foreground">
                  No categorised donations this FY.
                </div>
              ) : (
                <>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categories}
                          dataKey="amount"
                          nameKey="category"
                          innerRadius={52}
                          outerRadius={86}
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {categories.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, name) => [formatINR(Number(value)), titleCase(String(name))]}
                          contentStyle={{ borderRadius: 12, fontSize: 12 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    {categories.map((c, i) => (
                      <li key={c.category} className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="truncate">{titleCase(c.category)}</span>
                        <span className="ml-auto font-medium">{formatINRCompact(c.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </SectionCard>
          </div>

          {/* =========================== PROGRAMME IMPACT ========================== */}
          <SectionCard
            title="Programme impact"
            description="Operations delivered across the flagship UAR programmes"
            icon={<HandCoins className="size-4" aria-hidden="true" />}
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {/* Ration kits */}
              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Package className="size-4" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold">Ration kits</p>
                  <Badge variant="outline" className="ml-auto">{kitPct}% scanned</Badge>
                </div>
                <Progress
                  value={kitPct}
                  className="mt-3 h-2 [&>div]:bg-emerald-600"
                  aria-label={`${kitPct}% of ration kits scanned`}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {kits.scannedUnits ?? 0} of {kits.totalUnits ?? 0} units assembled vs scanned
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniStat label="Assembled" value={(kits.totalUnits ?? 0).toLocaleString("en-IN")} />
                  <MiniStat label="Scanned" value={(kits.scannedUnits ?? 0).toLocaleString("en-IN")} />
                </div>
              </div>

              {/* Sanitary pads */}
              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-pink-500/10 text-pink-600 dark:text-pink-400">
                    <HandHeart className="size-4" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold">Sanitary pads</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniStat label="Sessions" value={(pads.sessions ?? 0).toLocaleString("en-IN")} />
                  <MiniStat label="Pads" value={(pads.pads ?? 0).toLocaleString("en-IN")} />
                  <MiniStat label="Girls reached" value={(pads.girls ?? 0).toLocaleString("en-IN")} />
                  <MiniStat label="Schools" value={(pads.schools ?? 0).toLocaleString("en-IN")} />
                </div>
              </div>

              {/* Green corridor */}
              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
                    <Siren className="size-4" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold">Green corridor</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniStat label="Missions" value={(corridor.missions ?? 0).toLocaleString("en-IN")} />
                  <MiniStat label="Corridor events" value={(corridor.events ?? 0).toLocaleString("en-IN")} />
                  <MiniStat label="Vehicles alerted" value={(corridor.vehiclesAlerted ?? 0).toLocaleString("en-IN")} />
                  <MiniStat
                    label="Time saved"
                    value={formatDuration((corridor.timeSavedMin ?? 0) * 60)}
                  />
                </div>
              </div>

              {/* Animals */}
              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-lime-500/10 text-lime-600 dark:text-lime-400">
                    <HandHeart className="size-4" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold">Animal welfare</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniStat label="Available" value={(animals.available ?? 0).toLocaleString("en-IN")} />
                  <MiniStat label="Adopted" value={(animals.adopted ?? 0).toLocaleString("en-IN")} />
                  <MiniStat label="Active pledges" value={(animals.activePledges ?? 0).toLocaleString("en-IN")} />
                </div>
              </div>

              {/* Adopt-a-Medicine */}
              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
                    <HandCoins className="size-4" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold">Adopt-a-Medicine</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniStat label="Total causes" value={(medicine.total ?? 0).toLocaleString("en-IN")} />
                  <MiniStat label="Seeking" value={(medicine.seeking ?? 0).toLocaleString("en-IN")} />
                  <MiniStat label="Adopted" value={(medicine.adopted ?? 0).toLocaleString("en-IN")} />
                  <MiniStat label="Monthly pledged" value={formatINR(medicine.monthlyPledged ?? 0)} />
                </div>
              </div>
            </div>
          </SectionCard>

          {/* ============================= TOP DONORS ============================= */}
          <SectionCard
            title="Top donors"
            description={`Highest contributing donors in ${fyLabel(fy)} (admin view)`}
            icon={<Users className="size-4" aria-hidden="true" />}
          >
            {topDonors.length === 0 ? (
              <EmptyState
                icon={<Users className="size-6" aria-hidden="true" />}
                title="No donors this FY"
                hint="Donor contributions will be ranked here once received."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Donor</TableHead>
                      <TableHead className="text-right">Gifts</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topDonors.map((d, i) => (
                      <TableRow key={`${d.name}-${i}`}>
                        <TableCell>
                          <span
                            className={cn(
                              "grid size-6 place-items-center rounded-full text-xs font-semibold",
                              i < 3
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {i + 1}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell className="text-right">{d.count}</TableCell>
                        <TableCell className="text-right font-semibold">{formatINR(d.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
