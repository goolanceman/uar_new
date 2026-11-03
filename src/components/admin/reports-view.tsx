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
  Landmark,
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
  formatDate,
  formatDuration,
  formatINR,
  formatINRCompact,
  titleCase,
} from "@/lib/format";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

type ReportTab = "impact" | "donations" | "distributions" | "finance";

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

interface DonationRow {
  id: string;
  donorName: string;
  donorEmail?: string | null;
  amount: number;
  fees?: number | null;
  netAmount?: number | null;
  settlementDate?: string | null;
  refundAmount?: number | null;
  paymentMethod: string;
  paymentStatus: string;
  paymentProvider?: string | null;
  receiptNumber?: string | null;
  createdAt: string;
}

interface DistributionRow {
  id: string;
  type: string;
  quantity: number;
  value?: number | null;
  location?: string | null;
  distributedAt: string;
  volunteer?: { user?: { name?: string } | null } | null;
}

interface PadRow {
  id: string;
  schoolName?: string | null;
  area: string;
  girlsCount: number;
  padsDistributed: number;
  awarenessSession: boolean;
  sessionAttendees?: number | null;
  distributionDate: string;
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

interface CsvSection {
  title: string;
  header: string[];
  rows: Array<Array<string | number>>;
}

function downloadSectionedCsv(filename: string, reportTitle: string, sections: CsvSection[]) {
  const lines: string[] = [csvEscape(reportTitle), ""];
  for (const s of sections) {
    lines.push(csvEscape(s.title));
    lines.push(s.header.map(csvEscape).join(","));
    for (const r of s.rows) lines.push(r.map(csvEscape).join(","));
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast.success("Report exported as CSV");
}

/** 12 month buckets of the FY (Apr → Mar). */
const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

function fyMonthBuckets(fyStart: number) {
  return FY_MONTHS.map((month, i) => {
    const y = i < 9 ? fyStart : fyStart + 1;
    return { month: `${month} ${String(y).slice(2)}`, amount: 0, count: 0 };
  });
}

function fyBucketIndex(dateStr: string | Date, fyStart: number): number {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  if (Number.isNaN(d.getTime())) return -1;
  const monthsSinceApr = (d.getFullYear() - fyStart) * 12 + (d.getMonth() + 1 - 4);
  return monthsSinceApr >= 0 && monthsSinceApr <= 11 ? monthsSinceApr : -1;
}

function inFy(dateStr: string | Date | null | undefined, fyStart: number): boolean {
  if (!dateStr) return false;
  return fyBucketIndex(dateStr, fyStart) >= 0;
}

function netOf(d: DonationRow): number {
  if (d.netAmount !== null && d.netAmount !== undefined) return Number(d.netAmount);
  return Number(d.amount) - Number(d.fees ?? 0);
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

function TabSkeleton() {
  return (
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
      <Skeleton className="h-64 rounded-xl" />
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
  const [activeTab, setActiveTab] = useState<ReportTab>("impact");

  /* impact (consolidated report) */
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);

  /* raw donation rows — shared by the Donations and Finance tabs */
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const [donationsLoading, setDonationsLoading] = useState(false);

  /* distributions + pad drives */
  const [distributions, setDistributions] = useState<DistributionRow[]>([]);
  const [pads, setPads] = useState<PadRow[]>([]);
  const [distLoading, setDistLoading] = useState(false);

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

  const loadDonations = useCallback(async () => {
    setDonationsLoading(true);
    try {
      const from = `${fy}-04-01`;
      const to = `${fy + 1}-03-31`;
      const res = await get<{ items?: DonationRow[] } | DonationRow[]>(
        `/api/donations?from=${from}&to=${to}&limit=500`
      );
      const items = Array.isArray(res) ? res : (res.items ?? []);
      setDonations(items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load donations");
      setDonations([]);
    } finally {
      setDonationsLoading(false);
    }
  }, [fy]);

  const loadDistributions = useCallback(async () => {
    setDistLoading(true);
    try {
      const [distRaw, padRaw] = await Promise.all([
        get<DistributionRow[] | { items?: DistributionRow[] }>("/api/distributions?limit=200"),
        get<PadRow[] | { items?: PadRow[] }>("/api/pad-distributions"),
      ]);
      const dist = Array.isArray(distRaw) ? distRaw : (distRaw.items ?? []);
      const pad = Array.isArray(padRaw) ? padRaw : (padRaw.items ?? []);
      // server endpoints don't take FY filters — narrow client-side
      setDistributions(dist.filter((d) => inFy(d.distributedAt, fy)));
      setPads(pad.filter((p) => inFy(p.distributionDate, fy)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load distributions");
      setDistributions([]);
      setPads([]);
    } finally {
      setDistLoading(false);
    }
  }, [fy]);

  // lazy-load per tab; refetch when the FY changes
  useEffect(() => {
    if (activeTab === "donations" || activeTab === "finance") void loadDonations();
    if (activeTab === "distributions") void loadDistributions();
  }, [activeTab, fy, loadDonations, loadDistributions]);

  /* ------------------------------ impact data ------------------------------ */

  const k = data?.kpis ?? {};
  const p = data?.programmes ?? {};
  const kits = p.kits ?? {};
  const padsP = p.pads ?? {};
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

  /* ----------------------------- donations data ---------------------------- */

  const donationAgg = useMemo(() => {
    const completed = donations.filter((d) => d.paymentStatus === "COMPLETED");
    const issues = donations.filter(
      (d) =>
        d.paymentStatus === "FAILED" ||
        d.paymentStatus === "REFUNDED" ||
        d.paymentStatus === "CANCELLED" ||
        (Number(d.refundAmount ?? 0) > 0 && d.paymentStatus !== "COMPLETED")
    );
    const refunds = donations.filter((d) => Number(d.refundAmount ?? 0) > 0);

    const byMethodMap = new Map<string, { method: string; count: number; amount: number }>();
    for (const d of donations) {
      const key = d.paymentMethod || "UNKNOWN";
      const row = byMethodMap.get(key) ?? { method: key, count: 0, amount: 0 };
      row.count += 1;
      if (d.paymentStatus === "COMPLETED") row.amount += Number(d.amount);
      byMethodMap.set(key, row);
    }

    const byStatusMap = new Map<string, { status: string; count: number; amount: number }>();
    for (const d of donations) {
      const key = d.paymentStatus || "UNKNOWN";
      const row = byStatusMap.get(key) ?? { status: key, count: 0, amount: 0 };
      row.count += 1;
      row.amount += Number(d.amount);
      byStatusMap.set(key, row);
    }

    const buckets = fyMonthBuckets(fy);
    for (const d of donations) {
      const idx = fyBucketIndex(d.createdAt, fy);
      if (idx < 0) continue;
      buckets[idx].count += 1;
      if (d.paymentStatus === "COMPLETED") buckets[idx].amount += Number(d.amount);
    }

    return {
      completed,
      issues,
      refunds,
      raised: completed.reduce((s, d) => s + Number(d.amount), 0),
      byMethod: Array.from(byMethodMap.values()).sort((a, b) => b.amount - a.amount || b.count - a.count),
      byStatus: Array.from(byStatusMap.values()).sort((a, b) => b.count - a.count),
      trend: buckets,
    };
  }, [donations, fy]);

  /* --------------------------- distributions data --------------------------- */

  const distAgg = useMemo(() => {
    const byTypeMap = new Map<string, { type: string; count: number; quantity: number; value: number }>();
    const byLocMap = new Map<string, { location: string; count: number; quantity: number; value: number }>();
    for (const d of distributions) {
      const t = byTypeMap.get(d.type) ?? { type: d.type, count: 0, quantity: 0, value: 0 };
      t.count += 1;
      t.quantity += Number(d.quantity ?? 0);
      t.value += Number(d.value ?? 0);
      byTypeMap.set(d.type, t);

      const loc = (d.location ?? "").trim() || "Unspecified";
      const l = byLocMap.get(loc) ?? { location: loc, count: 0, quantity: 0, value: 0 };
      l.count += 1;
      l.quantity += Number(d.quantity ?? 0);
      l.value += Number(d.value ?? 0);
      byLocMap.set(loc, l);
    }

    const byAreaMap = new Map<string, { area: string; sessions: number; pads: number; girls: number }>();
    for (const pd of pads) {
      const a = byAreaMap.get(pd.area) ?? { area: pd.area, sessions: 0, pads: 0, girls: 0 };
      a.sessions += 1;
      a.pads += Number(pd.padsDistributed ?? 0);
      a.girls += Number(pd.girlsCount ?? 0);
      byAreaMap.set(pd.area, a);
    }

    const totalValue = distributions.reduce((s, d) => s + Number(d.value ?? 0), 0);
    const totalQty = distributions.reduce((s, d) => s + Number(d.quantity ?? 0), 0);
    const totalPads = pads.reduce((s, x) => s + Number(x.padsDistributed ?? 0), 0);
    const totalGirls = pads.reduce((s, x) => s + Number(x.girlsCount ?? 0), 0);
    const sessions = pads.filter((x) => x.awarenessSession).length;

    return {
      byType: Array.from(byTypeMap.values()).sort((a, b) => b.quantity - a.quantity),
      byLocation: Array.from(byLocMap.values()).sort((a, b) => b.count - a.count || b.quantity - a.quantity).slice(0, 10),
      byArea: Array.from(byAreaMap.values()).sort((a, b) => b.pads - a.pads).slice(0, 10),
      totalValue,
      totalQty,
      totalPads,
      totalGirls,
      sessions,
    };
  }, [distributions, pads]);

  /* ------------------------------- finance data ----------------------------- */

  const financeAgg = useMemo(() => {
    const completed = donations.filter((d) => d.paymentStatus === "COMPLETED");
    const gross = completed.reduce((s, d) => s + Number(d.amount), 0);
    const fees = completed.reduce((s, d) => s + Number(d.fees ?? 0), 0);
    const netRecorded = completed.reduce(
      (s, d) => s + (d.netAmount !== null && d.netAmount !== undefined ? Number(d.netAmount) : 0),
      0
    );
    const expectedNet = gross - fees;
    const variance = expectedNet - netRecorded;
    const refundTotal = donations.reduce((s, d) => s + Number(d.refundAmount ?? 0), 0);
    const settled = completed.filter((d) => Boolean(d.settlementDate));
    const coverage = completed.length > 0 ? Math.round((settled.length / completed.length) * 100) : 0;

    const byProviderMap = new Map<string, { provider: string; count: number; gross: number; fees: number; net: number; settled: number }>();
    for (const d of completed) {
      const key = (d.paymentProvider || d.paymentMethod || "UNKNOWN").toUpperCase();
      const row = byProviderMap.get(key) ?? { provider: key, count: 0, gross: 0, fees: 0, net: 0, settled: 0 };
      row.count += 1;
      row.gross += Number(d.amount);
      row.fees += Number(d.fees ?? 0);
      row.net += netOf(d);
      if (d.settlementDate) row.settled += 1;
      byProviderMap.set(key, row);
    }

    return {
      completedCount: completed.length,
      gross,
      fees,
      netRecorded,
      expectedNet,
      variance,
      refundTotal,
      settledCount: settled.length,
      coverage,
      unsettled: completed.length - settled.length,
      byProvider: Array.from(byProviderMap.values()).sort((a, b) => b.gross - a.gross),
    };
  }, [donations]);

  /* -------------------------------- exports --------------------------------- */

  const exportImpact = () => {
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
    rows.push(`Sanitary pads,Sessions,${padsP.sessions ?? 0}`);
    rows.push(`Sanitary pads,Pads,${padsP.pads ?? 0}`);
    rows.push(`Sanitary pads,Girls,${padsP.girls ?? 0}`);
    rows.push(`Sanitary pads,Schools,${padsP.schools ?? 0}`);
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

  const exportDonations = () => {
    downloadSectionedCsv(`uar-donations-${fyLabel(fy).replace(/\s/g, "")}`, `United Angel Reach — Donations Report ${fyLabel(fy)}`, [
      {
        title: "By payment method",
        header: ["Method", "Gifts", "Amount completed (INR)"],
        rows: donationAgg.byMethod.map((m) => [titleCase(m.method), m.count, m.amount]),
      },
      {
        title: "By status",
        header: ["Status", "Gifts", "Amount (INR)"],
        rows: donationAgg.byStatus.map((s) => [titleCase(s.status), s.count, s.amount]),
      },
      {
        title: "Monthly trend",
        header: ["Month", "Amount completed (INR)", "Gifts"],
        rows: donationAgg.trend.map((t) => [t.month, t.amount, t.count]),
      },
      {
        title: "Failed / refunded donations",
        header: ["Date", "Donor", "Amount (INR)", "Status", "Method", "Receipt"],
        rows: donationAgg.issues.map((d) => [
          formatDate(d.createdAt),
          d.donorName,
          Number(d.amount),
          d.paymentStatus,
          titleCase(d.paymentMethod),
          d.receiptNumber ?? "",
        ]),
      },
    ]);
  };

  const exportDistributions = () => {
    downloadSectionedCsv(`uar-distributions-${fyLabel(fy).replace(/\s/g, "")}`, `United Angel Reach — Distributions Report ${fyLabel(fy)}`, [
      {
        title: "Totals by type",
        header: ["Type", "Drives", "Units", "Value (INR)"],
        rows: distAgg.byType.map((t) => [titleCase(t.type), t.count, t.quantity, t.value]),
      },
      {
        title: "Top locations",
        header: ["Location", "Drives", "Units", "Value (INR)"],
        rows: distAgg.byLocation.map((l) => [l.location, l.count, l.quantity, l.value]),
      },
      {
        title: "Pad drives by area",
        header: ["Area", "Sessions", "Pads", "Girls"],
        rows: distAgg.byArea.map((a) => [a.area, a.sessions, a.pads, a.girls]),
      },
    ]);
  };

  const exportFinance = () => {
    downloadSectionedCsv(`uar-finance-${fyLabel(fy).replace(/\s/g, "")}`, `United Angel Reach — Finance Reconciliation ${fyLabel(fy)}`, [
      {
        title: "Reconciliation summary",
        header: ["Metric", "Value"],
        rows: [
          ["Completed donations", financeAgg.completedCount],
          ["Gross collected (INR)", financeAgg.gross],
          ["Gateway fees (INR)", financeAgg.fees],
          ["Expected net = gross − fees (INR)", financeAgg.expectedNet],
          ["Recorded net (INR)", financeAgg.netRecorded],
          ["Unreconciled variance (INR)", financeAgg.variance],
          ["Refund total (INR)", financeAgg.refundTotal],
          ["Settled donations", financeAgg.settledCount],
          ["Unsettled donations", financeAgg.unsettled],
          ["Settlement coverage (%)", financeAgg.coverage],
        ],
      },
      {
        title: "By provider / method",
        header: ["Provider", "Gifts", "Gross (INR)", "Fees (INR)", "Net (INR)", "Settled"],
        rows: financeAgg.byProvider.map((r) => [titleCase(r.provider), r.count, r.gross, r.fees, r.net, r.settled]),
      },
    ]);
  };

  const exportActive = () => {
    switch (activeTab) {
      case "donations":
        if (donations.length === 0) return toast.info("No donations to export for this FY yet");
        return exportDonations();
      case "distributions":
        if (distributions.length === 0 && pads.length === 0) return toast.info("No distributions to export for this FY yet");
        return exportDistributions();
      case "finance":
        if (donations.length === 0) return toast.info("No donations to reconcile for this FY yet");
        return exportFinance();
      default:
        return exportImpact();
    }
  };

  const impactEmpty =
    !loading && (!data || ((data.fyTotals?.count ?? 0) === 0 && monthly.every((m) => !m.amount)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Consolidated fundraising, programme and finance reporting for the financial year (April → March)."
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
            <Button variant="outline" onClick={exportActive} aria-label={`Export ${activeTab} report as CSV`}>
              <Download className="size-4" aria-hidden="true" /> Export CSV
            </Button>
            <Button variant="outline" onClick={() => window.print()} aria-label="Print report">
              <Printer className="size-4" aria-hidden="true" /> Print
            </Button>
          </>
        }
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReportTab)}>
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="impact">Impact</TabsTrigger>
          <TabsTrigger value="donations">Donations</TabsTrigger>
          <TabsTrigger value="distributions">Distributions</TabsTrigger>
          <TabsTrigger value="finance">Finance</TabsTrigger>
        </TabsList>

        {/* ============================== IMPACT ============================== */}
        <TabsContent value="impact" className="mt-4">
          {loading ? (
            <TabSkeleton />
          ) : impactEmpty ? (
            <EmptyState
              icon={<FileBarChart className="size-8" aria-hidden="true" />}
              title={`No activity recorded in ${fyLabel(fy)}`}
              hint="Donations, distributions and programme data for this financial year will appear here."
            />
          ) : (
            <div className="print-sheet space-y-6">
              {/* ============================ KPI ROW ============================ */}
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

              {/* ============================== CHARTS ============================= */}
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
                      <MiniStat label="Sessions" value={(padsP.sessions ?? 0).toLocaleString("en-IN")} />
                      <MiniStat label="Pads" value={(padsP.pads ?? 0).toLocaleString("en-IN")} />
                      <MiniStat label="Girls reached" value={(padsP.girls ?? 0).toLocaleString("en-IN")} />
                      <MiniStat label="Schools" value={(padsP.schools ?? 0).toLocaleString("en-IN")} />
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
        </TabsContent>

        {/* ============================= DONATIONS ============================= */}
        <TabsContent value="donations" className="mt-4">
          {donationsLoading ? (
            <TabSkeleton />
          ) : donations.length === 0 ? (
            <EmptyState
              icon={<HandCoins className="size-8" aria-hidden="true" />}
              title={`No donations recorded in ${fyLabel(fy)}`}
              hint="Gifts made during this financial year (any status) will be grouped here."
            />
          ) : (
            <div className="print-sheet space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Gifts recorded"
                  value={donations.length.toLocaleString("en-IN")}
                  icon={<HandCoins className="size-5" aria-hidden="true" />}
                  accent="emerald"
                  hint={`${donationAgg.completed.length} completed`}
                />
                <StatCard
                  label="Raised (completed)"
                  value={formatINRCompact(donationAgg.raised)}
                  icon={<Coins className="size-5" aria-hidden="true" />}
                  accent="teal"
                  hint={formatINR(donationAgg.raised)}
                />
                <StatCard
                  label="Failed / cancelled"
                  value={donationAgg.byStatus
                    .filter((s) => s.status === "FAILED" || s.status === "CANCELLED")
                    .reduce((sum, s) => sum + s.count, 0)
                    .toLocaleString("en-IN")}
                  icon={<Activity className="size-5" aria-hidden="true" />}
                  accent="red"
                  hint="Excluded from raised totals"
                />
                <StatCard
                  label="Refunded"
                  value={formatINRCompact(donationAgg.refunds.reduce((s, d) => s + Number(d.refundAmount ?? 0), 0))}
                  icon={<RefreshCw className="size-5" aria-hidden="true" />}
                  accent="amber"
                  hint={`${donationAgg.refunds.length} refund${donationAgg.refunds.length === 1 ? "" : "s"}`}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard
                  title="Monthly trend"
                  description={`Donations across ${fyLabel(fy)}`}
                  icon={<TrendingUp className="size-4" aria-hidden="true" />}
                >
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={donationAgg.trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} angle={-35} textAnchor="end" height={44} />
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
                              ? [formatINR(Number(value)), "Amount (completed)"]
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
                    Bars: completed amount · Line: gifts recorded
                  </p>
                </SectionCard>

                <SectionCard
                  title="By payment method"
                  description="Gift count and completed amount per channel"
                  icon={<Coins className="size-4" aria-hidden="true" />}
                >
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Method</TableHead>
                          <TableHead className="text-right">Gifts</TableHead>
                          <TableHead className="text-right">Amount (completed)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {donationAgg.byMethod.map((m) => (
                          <TableRow key={m.method}>
                            <TableCell className="font-medium">{titleCase(m.method)}</TableCell>
                            <TableCell className="text-right">{m.count}</TableCell>
                            <TableCell className="text-right font-semibold">{formatINR(m.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </SectionCard>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard
                  title="By status"
                  description="Lifecycle of every gift recorded this FY"
                  icon={<Activity className="size-4" aria-hidden="true" />}
                >
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Gifts</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {donationAgg.byStatus.map((s) => (
                          <TableRow key={s.status}>
                            <TableCell>
                              <StatusBadge status={s.status} />
                            </TableCell>
                            <TableCell className="text-right">{s.count}</TableCell>
                            <TableCell className="text-right font-semibold">{formatINR(s.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </SectionCard>

                <SectionCard
                  title="Failed &amp; refunded"
                  description="Gifts that need follow-up or were returned"
                  icon={<RefreshCw className="size-4" aria-hidden="true" />}
                >
                  {donationAgg.issues.length === 0 ? (
                    <EmptyState
                      icon={<HandCoins className="size-6" aria-hidden="true" />}
                      title="Nothing to chase"
                      hint="No failed, cancelled or refunded donations this FY."
                    />
                  ) : (
                    <div className="max-h-80 overflow-auto rounded-lg border scrollbar-thin">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background">
                          <TableRow>
                            <TableHead>Donor</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="hidden sm:table-cell">Date</TableHead>
                            <TableHead className="hidden md:table-cell">Receipt</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {donationAgg.issues.map((d) => (
                            <TableRow key={d.id}>
                              <TableCell className="max-w-40 truncate font-medium">{d.donorName}</TableCell>
                              <TableCell>
                                <StatusBadge status={d.paymentStatus} />
                              </TableCell>
                              <TableCell className="text-right font-semibold">{formatINR(Number(d.refundAmount ?? d.amount))}</TableCell>
                              <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                                {formatDate(d.createdAt)}
                              </TableCell>
                              <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                                {d.receiptNumber ?? "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>
          )}
        </TabsContent>

        {/* =========================== DISTRIBUTIONS =========================== */}
        <TabsContent value="distributions" className="mt-4">
          {distLoading ? (
            <TabSkeleton />
          ) : distributions.length === 0 && pads.length === 0 ? (
            <EmptyState
              icon={<Package className="size-8" aria-hidden="true" />}
              title={`No distributions recorded in ${fyLabel(fy)}`}
              hint="Field distributions and pad drives for this financial year will be summarised here."
            />
          ) : (
            <div className="print-sheet space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Distribution drives"
                  value={distributions.length.toLocaleString("en-IN")}
                  icon={<Package className="size-5" aria-hidden="true" />}
                  accent="emerald"
                  hint="Field records this FY"
                />
                <StatCard
                  label="Units distributed"
                  value={distAgg.totalQty.toLocaleString("en-IN")}
                  icon={<HandHeart className="size-5" aria-hidden="true" />}
                  accent="teal"
                  hint={`${distAgg.byType.length} type${distAgg.byType.length === 1 ? "" : "s"}`}
                />
                <StatCard
                  label="Pads distributed"
                  value={distAgg.totalPads.toLocaleString("en-IN")}
                  icon={<HandCoins className="size-5" aria-hidden="true" />}
                  accent="pink"
                  hint={`${pads.length} pad drive${pads.length === 1 ? "" : "s"}`}
                />
                <StatCard
                  label="Girls reached"
                  value={distAgg.totalGirls.toLocaleString("en-IN")}
                  icon={<Users className="size-5" aria-hidden="true" />}
                  accent="amber"
                  hint={`${distAgg.sessions} awareness session${distAgg.sessions === 1 ? "" : "s"}`}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard
                  title="Share by type"
                  description="Units distributed per programme type"
                  icon={<Package className="size-4" aria-hidden="true" />}
                >
                  {distAgg.byType.length === 0 ? (
                    <div className="grid h-56 place-items-center text-sm text-muted-foreground">
                      No distribution data this FY.
                    </div>
                  ) : (
                    <>
                      <div className="h-56 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={distAgg.byType}
                              dataKey="quantity"
                              nameKey="type"
                              innerRadius={52}
                              outerRadius={86}
                              paddingAngle={2}
                              strokeWidth={0}
                            >
                              {distAgg.byType.map((_, i) => (
                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value, name) => [`${value} units`, titleCase(String(name))]}
                              contentStyle={{ borderRadius: 12, fontSize: 12 }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        {distAgg.byType.map((t, i) => (
                          <li key={t.type} className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                            />
                            <span className="truncate">{titleCase(t.type)}</span>
                            <span className="ml-auto font-medium">{t.quantity.toLocaleString("en-IN")}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </SectionCard>

                <SectionCard
                  title="Totals by type"
                  description="Drives, units and estimated value per type"
                  icon={<HandHeart className="size-4" aria-hidden="true" />}
                >
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Drives</TableHead>
                          <TableHead className="text-right">Units</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {distAgg.byType.map((t) => (
                          <TableRow key={t.type}>
                            <TableCell className="font-medium">{titleCase(t.type)}</TableCell>
                            <TableCell className="text-right">{t.count}</TableCell>
                            <TableCell className="text-right">{t.quantity.toLocaleString("en-IN")}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {t.value > 0 ? formatINR(t.value) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </SectionCard>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard
                  title="Top locations"
                  description="Where the field work happened (top 10 by drives)"
                  icon={<Landmark className="size-4" aria-hidden="true" />}
                >
                  {distAgg.byLocation.length === 0 ? (
                    <EmptyState
                      icon={<Landmark className="size-6" aria-hidden="true" />}
                      title="No locations yet"
                      hint="Distribution records with a location will be ranked here."
                    />
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>Location</TableHead>
                            <TableHead className="text-right">Drives</TableHead>
                            <TableHead className="text-right">Units</TableHead>
                            <TableHead className="text-right">Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {distAgg.byLocation.map((l, i) => (
                            <TableRow key={l.location}>
                              <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                              <TableCell className="max-w-48 truncate font-medium">{l.location}</TableCell>
                              <TableCell className="text-right">{l.count}</TableCell>
                              <TableCell className="text-right">{l.quantity.toLocaleString("en-IN")}</TableCell>
                              <TableCell className="text-right font-semibold">
                                {l.value > 0 ? formatINR(l.value) : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  title="Pad drives by area"
                  description="School pads programme — top areas this FY"
                  icon={<HandCoins className="size-4" aria-hidden="true" />}
                >
                  {distAgg.byArea.length === 0 ? (
                    <EmptyState
                      icon={<HandCoins className="size-6" aria-hidden="true" />}
                      title="No pad drives this FY"
                      hint="Pad distribution records will be grouped by area here."
                    />
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Area</TableHead>
                            <TableHead className="text-right">Sessions</TableHead>
                            <TableHead className="text-right">Pads</TableHead>
                            <TableHead className="text-right">Girls</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {distAgg.byArea.map((a) => (
                            <TableRow key={a.area}>
                              <TableCell className="max-w-48 truncate font-medium">{a.area}</TableCell>
                              <TableCell className="text-right">{a.sessions}</TableCell>
                              <TableCell className="text-right">{a.pads.toLocaleString("en-IN")}</TableCell>
                              <TableCell className="text-right font-semibold">{a.girls.toLocaleString("en-IN")}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>
          )}
        </TabsContent>

        {/* =============================== FINANCE ============================== */}
        <TabsContent value="finance" className="mt-4">
          {donationsLoading ? (
            <TabSkeleton />
          ) : donations.length === 0 ? (
            <EmptyState
              icon={<Landmark className="size-8" aria-hidden="true" />}
              title={`Nothing to reconcile for ${fyLabel(fy)}`}
              hint="Gateway fees, settlements and refunds appear once donations exist for this FY."
            />
          ) : (
            <div className="print-sheet space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Gross collected"
                  value={formatINRCompact(financeAgg.gross)}
                  icon={<Coins className="size-5" aria-hidden="true" />}
                  accent="emerald"
                  hint={`${financeAgg.completedCount} completed gifts`}
                />
                <StatCard
                  label="Gateway fees"
                  value={formatINR(financeAgg.fees)}
                  icon={<Activity className="size-5" aria-hidden="true" />}
                  accent="amber"
                  hint={`Net expected ${formatINR(financeAgg.expectedNet)}`}
                />
                <StatCard
                  label="Refund total"
                  value={formatINRCompact(financeAgg.refundTotal)}
                  icon={<RefreshCw className="size-5" aria-hidden="true" />}
                  accent="red"
                  hint="Across all donations this FY"
                />
                <StatCard
                  label="Settlement coverage"
                  value={`${financeAgg.coverage}%`}
                  icon={<Landmark className="size-5" aria-hidden="true" />}
                  accent="teal"
                  hint={`${financeAgg.settledCount} of ${financeAgg.completedCount} settled`}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard
                  title="Reconciliation summary"
                  description={`Gross → fees → net for ${fyLabel(fy)}`}
                  icon={<Landmark className="size-4" aria-hidden="true" />}
                >
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Metric</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell>Gross collected (completed)</TableCell>
                          <TableCell className="text-right font-semibold">{formatINR(financeAgg.gross)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Gateway fees</TableCell>
                          <TableCell className="text-right font-semibold text-amber-700 dark:text-amber-400">
                            − {formatINR(financeAgg.fees)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Expected net (gross − fees)</TableCell>
                          <TableCell className="text-right font-semibold">{formatINR(financeAgg.expectedNet)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Recorded net amount</TableCell>
                          <TableCell className="text-right font-semibold">{formatINR(financeAgg.netRecorded)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Unreconciled variance</TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-semibold",
                              Math.abs(financeAgg.variance) < 0.01
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-red-700 dark:text-red-400"
                            )}
                          >
                            {formatINR(financeAgg.variance)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Refund total</TableCell>
                          <TableCell className="text-right font-semibold">{formatINR(financeAgg.refundTotal)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Settled vs unsettled</TableCell>
                          <TableCell className="text-right font-semibold">
                            {financeAgg.settledCount} / {financeAgg.unsettled} unsettled
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                  <Progress
                    value={financeAgg.coverage}
                    className="mt-4 h-2 [&>div]:bg-teal-600"
                    aria-label={`${financeAgg.coverage}% of completed donations settled`}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {financeAgg.coverage}% of completed donations have a settlement date recorded.
                  </p>
                </SectionCard>

                <SectionCard
                  title="By provider / method"
                  description="Where the money moved, per gateway or channel"
                  icon={<Coins className="size-4" aria-hidden="true" />}
                >
                  {financeAgg.byProvider.length === 0 ? (
                    <EmptyState
                      icon={<Coins className="size-6" aria-hidden="true" />}
                      title="No completed donations"
                      hint="Provider-level reconciliation appears once gifts complete."
                    />
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Provider</TableHead>
                            <TableHead className="text-right">Gifts</TableHead>
                            <TableHead className="text-right">Gross</TableHead>
                            <TableHead className="text-right">Fees</TableHead>
                            <TableHead className="text-right">Net</TableHead>
                            <TableHead className="text-right">Settled</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {financeAgg.byProvider.map((r) => (
                            <TableRow key={r.provider}>
                              <TableCell className="font-medium">{titleCase(r.provider)}</TableCell>
                              <TableCell className="text-right">{r.count}</TableCell>
                              <TableCell className="text-right">{formatINR(r.gross)}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{formatINR(r.fees)}</TableCell>
                              <TableCell className="text-right font-semibold">{formatINR(r.net)}</TableCell>
                              <TableCell className="text-right">
                                {r.settled}/{r.count}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Net falls back to gross − fees when a donation has no recorded netAmount.
                  </p>
                </SectionCard>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
