"use client";

/**
 * Reports — trust reporting module (admin).
 *
 * Sections (tabs):
 *  1. Donations & receipts register — filterable DataTable + totals + CSV
 *  2. Fund utilisation — giving-by-category donut, monthly inflow bar,
 *     campaign utilisation progress table
 *  3. Programme impact — kits, pads, adopt-a-medicine, animals, green corridor
 *  4. Donor & volunteer insights — new vs repeat, top donors, volunteer
 *     funnel, beneficiaries, distribution type mix
 *  5. Compliance snapshot — 80G receipts issued, monthly receipt bar,
 *     trust registration block (80G / 12A / PAN / Darpan)
 *
 * Every number is a live aggregate from GET /api/reports?from&to&compare=1.
 * Period controls: FY selector (FY 2024-25 → current), custom date range,
 * and a compare toggle that surfaces Δ% chips on the KPI strip.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  BadgeCheck,
  ClipboardList,
  Coins,
  FileBarChart,
  HandCoins,
  HandHeart,
  Landmark,
  Package,
  PawPrint,
  Pill,
  Printer,
  RefreshCw,
  ShieldCheck,
  Siren,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import {
  formatDate,
  formatDateLong,
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
import { StatusBadge } from "@/components/shared/status-badge";
import { DataField } from "@/components/shared/data-field";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ═══════════════════════════════ types ═══════════════════════════════ */

interface Kpis {
  fundsRaised: number;
  donationCount: number;
  avgDonation: number;
  receiptsIssued: number;
  receiptedSum: number;
  fundsDisbursed: number;
  distributionCount: number;
  distributionQuantity: number;
  beneficiariesServed: number;
  servedViaDistributions: number;
  padGirls: number;
  panCoveragePct: number;
  panReceipts: number;
  donorCount: number;
}

interface MonthBucket {
  key: string;
  label: string;
  amount: number;
  count: number;
  receipts: number;
}

interface CategorySlice {
  category: string;
  amount: number;
  count: number;
}

interface RegisterRow {
  id: string;
  createdAt: string;
  receiptNumber: string;
  donorName: string;
  donorEmail: string;
  donorPhone: string | null;
  isAnonymous: boolean;
  pan: string | null;
  amount: number;
  fees: number;
  type: string;
  category: string;
  paymentMethod: string;
  paymentStatus: string;
  receiptStatus: string;
  campaignId: string | null;
  campaignTitle: string | null;
  eligible80g: boolean;
}

interface CampaignRow {
  id: string;
  title: string;
  category: string;
  status: string;
  raised: number;
  target: number;
  pct: number;
  raisedInRange: number;
  beneficiaries: number;
}

interface TopDonorRow {
  name: string;
  amount: number;
  count: number;
}

interface TypeMixRow {
  type: string;
  count: number;
  quantity: number;
  value: number;
}

interface MonthlyReceiptRow {
  label: string;
  count: number;
  sum: number;
}

interface Aggregates {
  kpis: Kpis;
  monthly: MonthBucket[];
  categories: CategorySlice[];
  register: RegisterRow[];
  campaigns: CampaignRow[];
  utilization: {
    disbursedValue: number;
    disbursedQuantity: number;
    disbursedCount: number;
    byType: TypeMixRow[];
  };
  programmes: {
    kits: { totalUnits: number; scannedUnits: number; scannedInRange: number };
    pads: { drives: number; pads: number; girls: number; sessions: number; schools: number; avgPerGirl: number };
    medicine: { total: number; seeking: number; partial: number; adopted: number; paused: number; activePledges: number; monthlyPledged: number };
    animals: { total: number; available: number; fostered: number; adopted: number; critical: number; activePledges: number };
    corridor: { missions: number; missionsCompleted: number; events: number; vehiclesAlerted: number; timeSavedSec: number; avgTimeSavedSec: number };
  };
  people: {
    donors: { total: number; new: number; repeat: number };
    topDonors: TopDonorRow[];
    volunteerApplications: { total: number; pending: number; approved: number; rejected: number };
    beneficiaries: {
      total: number;
      onboardedInRange: number;
      byCategory: { category: string; count: number }[];
      byUrgency: { urgency: string; count: number }[];
    };
  };
  compliance: {
    receiptCount: number;
    receiptSum: number;
    monthlyReceipts: MonthlyReceiptRow[];
    ineligible80g: { count: number; sum: number };
    panReceipts: { count: number; sum: number };
  };
}

interface ReportsPayload {
  range: { from: string; to: string };
  compare: boolean;
  previousRange: { from: string | null; to: string | null } | null;
  current: Aggregates;
  previous: Aggregates | null;
}

interface OrgSettings {
  orgName: string;
  orgHq: string;
  orgAddress: string;
  orgEmail: string;
  orgPhone: string;
  org80g: string;
  orgPan: string;
  orgReg12a: string;
  orgDarpan: string;
  signatoryName: string;
  signatoryRole: string;
}

/* ═══════════════════════════ constants ═══════════════════════════ */

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

const BAR_COLORS = ["bg-emerald-500", "bg-teal-500", "bg-amber-500", "bg-orange-500", "bg-pink-500", "bg-lime-500"];

const DONATION_STATUSES = ["COMPLETED", "PENDING", "FAILED", "REFUNDED", "CANCELLED"];

const inflowConfig: ChartConfig = { amount: { label: "Raised", color: "#10b981" } };
const receiptsConfig: ChartConfig = { receipts: { label: "Receipts issued", color: "#10b981" } };

/* ═══════════════════════════ helpers ═══════════════════════════ */

function currentFyStart(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

function fyLabel(start: number): string {
  return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function fyBounds(start: number): { from: string; to: string } {
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

function periodFilename(from: string, to: string): string {
  return `${from}_${to}`;
}

function pctOf(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0;
}

/** Δ between current and previous KPI → chip state. */
function deltaOf(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? { dir: "flat" as const, label: "0%" } : { dir: "up" as const, label: "NEW" };
  }
  const change = current - previous;
  const pct = (change / previous) * 100;
  if (Math.abs(pct) < 0.05) return { dir: "flat" as const, label: "0%" };
  const magnitude = Math.abs(pct) >= 99.5 ? String(Math.round(Math.abs(pct))) : Math.abs(pct).toFixed(1);
  return {
    dir: change > 0 ? ("up" as const) : ("down" as const),
    label: `${change > 0 ? "+" : "−"}${magnitude}%`,
  };
}

function DeltaChip({
  current,
  previous,
  pp = false,
}: {
  current: number;
  previous: number | null | undefined;
  pp?: boolean;
}) {
  if (previous === null || previous === undefined) return null;
  const d = deltaOf(current, previous);
  const cls =
    d.dir === "up"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : d.dir === "down"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
        : "border-border bg-muted text-muted-foreground";
  const Icon = d.dir === "up" ? TrendingUp : d.dir === "down" ? TrendingDown : null;
  const ppChange = current - previous;
  const label = pp
    ? d.dir === "flat"
      ? d.label
      : `${ppChange > 0 ? "+" : "−"}${Math.abs(ppChange).toFixed(1)} pp`
    : d.label;
  return (
    <Badge variant="outline" className={cn("gap-1 px-1.5 py-0 text-[11px] font-semibold tabular-nums", cls)}>
      {Icon && <Icon className="size-3" aria-hidden="true" />}
      <span>{label}</span>
      <span className="sr-only">
        {d.dir === "up" ? "increase" : d.dir === "down" ? "decrease" : "no change"} vs previous period
      </span>
    </Badge>
  );
}

function MiniStat({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm font-semibold", mono && "font-mono text-[13px] tabular-nums")}>{value}</p>
    </div>
  );
}

/** Horizontal share bar (donor mix, beneficiary categories, type mix). */
function ShareBar({
  label,
  value,
  max,
  colorClass,
  trailing,
}: {
  label: string;
  value: number;
  max: number;
  colorClass: string;
  trailing?: string;
}) {
  const w = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-medium">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {trailing ?? value.toLocaleString("en-IN")}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", colorClass)} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

function TableSkeleton({ rows = 9 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      <Skeleton className="h-10 w-full rounded-lg" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" style={{ opacity: 1 - i * 0.07 }} />
      ))}
    </div>
  );
}

/* ═══════════════════════════════ view ═══════════════════════════════ */

type ReportTab = "register" | "utilization" | "programmes" | "people" | "compliance";

export default function ReportsView() {
  const thisFy = currentFyStart();
  const fyOptions = useMemo(() => [0, 1, 2].map((i) => thisFy - i), [thisFy]);

  /* ---------------- period state ---------------- */
  const [fy, setFy] = useState<number | "custom">(thisFy);
  const [from, setFrom] = useState<string>(fyBounds(thisFy).from);
  const [to, setTo] = useState<string>(fyBounds(thisFy).to);
  const [compare, setCompare] = useState(true);
  const [activeTab, setActiveTab] = useState<ReportTab>("register");

  /* ---------------- data state ---------------- */
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [org, setOrg] = useState<OrgSettings | null>(null);

  /* register filters */
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const rangeInvalid = Boolean(from && to && new Date(from).getTime() > new Date(to).getTime());

  const pickFy = (value: string) => {
    if (value === "custom") {
      setFy("custom");
      return;
    }
    const start = Number(value);
    setFy(start);
    const b = fyBounds(start);
    setFrom(b.from);
    setTo(b.to);
  };

  /* ---------------- loaders ---------------- */
  const load = useCallback(async () => {
    if (!from || !to || rangeInvalid) {
      if (rangeInvalid) setError("The start date must be on or before the end date.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await get<ReportsPayload>(
        `/api/reports?from=${from}&to=${to}${compare ? "&compare=1" : ""}`
      );
      setData(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load report";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [from, to, compare, rangeInvalid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    get<OrgSettings>("/api/settings/public")
      .then((res) => {
        if (!cancelled) setOrg(res);
      })
      .catch(() => {
        /* compliance block falls back to placeholders */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------- derived ---------------- */
  const cur = data?.current ?? null;
  const prev = data?.previous ?? null;
  const k = cur?.kpis;
  const p = cur?.programmes;
  const people = cur?.people;
  const compliance = cur?.compliance;
  const utilization = cur?.utilization;
  const showDelta = Boolean(compare && prev);
  const firstLoad = loading && !cur;

  const periodLabel = useMemo(() => {
    if (!from || !to) return "";
    const fyTxt = fy !== "custom" ? `${fyLabel(fy)} · ` : "";
    return `${fyTxt}${formatDateLong(from)} – ${formatDateLong(to)}`;
  }, [from, to, fy]);

  const prevPeriodLabel = useMemo(() => {
    const r = data?.previousRange;
    if (!showDelta || !r?.from || !r?.to) return "";
    return `Compared with ${formatDateLong(r.from)} – ${formatDateLong(r.to)}`;
  }, [data, showDelta]);

  /* register filtering */
  const filteredRegister = useMemo(() => {
    const rows = cur?.register ?? [];
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "ALL" && r.paymentStatus !== statusFilter) return false;
      if (categoryFilter !== "ALL" && r.category !== categoryFilter) return false;
      if (!needle) return true;
      return [r.donorName, r.donorEmail, r.receiptNumber, r.campaignTitle ?? "", r.pan ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [cur, q, statusFilter, categoryFilter]);

  useEffect(() => {
    setPage(1);
  }, [q, statusFilter, categoryFilter]);

  const registerTotals = useMemo(() => {
    const completed = filteredRegister.filter((r) => r.paymentStatus === "COMPLETED");
    const eligible = completed.filter((r) => r.eligible80g);
    const refunds = filteredRegister
      .filter((r) => r.paymentStatus === "REFUNDED")
      .reduce((s, r) => s + r.amount, 0);
    return {
      gifts: filteredRegister.length,
      completedCount: completed.length,
      completedSum: completed.reduce((s, r) => s + r.amount, 0),
      eligibleSum: eligible.reduce((s, r) => s + r.amount, 0),
      ineligibleSum: completed.filter((r) => !r.eligible80g).reduce((s, r) => s + r.amount, 0),
      refunds,
    };
  }, [filteredRegister]);

  const registerPages = Math.max(1, Math.ceil(filteredRegister.length / pageSize));
  const pagedRegister = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRegister.slice(start, start + pageSize);
  }, [filteredRegister, page, pageSize]);

  const resetFilters = () => {
    setQ("");
    setStatusFilter("ALL");
    setCategoryFilter("ALL");
  };

  /* ═══════════════════════ CSV column sets ═══════════════════════ */

  const registerCsv: CsvColumn<RegisterRow>[] = useMemo(
    () => [
      { header: "Date", value: (r) => formatDate(r.createdAt) },
      { header: "Receipt No", value: (r) => r.receiptNumber },
      { header: "Donor", value: (r) => (r.isAnonymous ? "Anonymous" : r.donorName) },
      { header: "Email", value: (r) => r.donorEmail },
      { header: "Amount (INR)", value: (r) => r.amount },
      { header: "80G Eligible", value: (r) => (r.eligible80g ? "Yes" : "No") },
      { header: "Category", value: (r) => r.category },
      { header: "Campaign", value: (r) => r.campaignTitle ?? "" },
      { header: "Method", value: (r) => r.paymentMethod },
      { header: "Status", value: (r) => r.paymentStatus },
      { header: "PAN", value: (r) => r.pan ?? "" },
    ],
    []
  );

  const categoryCsv: CsvColumn<CategorySlice>[] = useMemo(
    () => [
      { header: "Category", value: (c) => c.category },
      { header: "Amount (INR)", value: (c) => c.amount },
      { header: "Gifts", value: (c) => c.count },
    ],
    []
  );

  const campaignCsv: CsvColumn<CampaignRow>[] = useMemo(
    () => [
      { header: "Campaign", value: (c) => c.title },
      { header: "Category", value: (c) => c.category },
      { header: "Status", value: (c) => c.status },
      { header: "Raised (INR)", value: (c) => c.raised },
      { header: "Target (INR)", value: (c) => c.target },
      { header: "Utilisation %", value: (c) => c.pct },
      { header: "Raised in period (INR)", value: (c) => c.raisedInRange },
    ],
    []
  );

  const programmeCsv: CsvColumn<{ programme: string; metric: string; value: string | number }>[] = useMemo(
    () => [
      { header: "Programme", value: (r) => r.programme },
      { header: "Metric", value: (r) => r.metric },
      { header: "Value", value: (r) => r.value },
    ],
    []
  );

  const programmeRows: { programme: string; metric: string; value: string | number }[] = useMemo(() => {
    if (!p) return [];
    return [
      { programme: "Ration kits", metric: "Units assembled", value: p.kits.totalUnits },
      { programme: "Ration kits", metric: "Units scanned", value: p.kits.scannedUnits },
      { programme: "Ration kits", metric: "Scanned in period", value: p.kits.scannedInRange },
      { programme: "Sanitary pads", metric: "Drives", value: p.pads.drives },
      { programme: "Sanitary pads", metric: "Awareness sessions", value: p.pads.sessions },
      { programme: "Sanitary pads", metric: "Pads distributed", value: p.pads.pads },
      { programme: "Sanitary pads", metric: "Girls reached", value: p.pads.girls },
      { programme: "Sanitary pads", metric: "Pads per girl (avg)", value: p.pads.avgPerGirl },
      { programme: "Sanitary pads", metric: "Schools covered", value: p.pads.schools },
      { programme: "Adopt-a-Medicine", metric: "Causes total", value: p.medicine.total },
      { programme: "Adopt-a-Medicine", metric: "Seeking", value: p.medicine.seeking },
      { programme: "Adopt-a-Medicine", metric: "Partially adopted", value: p.medicine.partial },
      { programme: "Adopt-a-Medicine", metric: "Adopted", value: p.medicine.adopted },
      { programme: "Adopt-a-Medicine", metric: "Paused", value: p.medicine.paused },
      { programme: "Adopt-a-Medicine", metric: "Active pledges", value: p.medicine.activePledges },
      { programme: "Adopt-a-Medicine", metric: "Monthly commitment (INR)", value: p.medicine.monthlyPledged },
      { programme: "Animal welfare", metric: "Animals total", value: p.animals.total },
      { programme: "Animal welfare", metric: "Available", value: p.animals.available },
      { programme: "Animal welfare", metric: "Fostered", value: p.animals.fostered },
      { programme: "Animal welfare", metric: "Adopted", value: p.animals.adopted },
      { programme: "Animal welfare", metric: "Critical", value: p.animals.critical },
      { programme: "Animal welfare", metric: "Active pledges", value: p.animals.activePledges },
      { programme: "Green corridor", metric: "Missions", value: p.corridor.missions },
      { programme: "Green corridor", metric: "Missions completed", value: p.corridor.missionsCompleted },
      { programme: "Green corridor", metric: "Corridor events", value: p.corridor.events },
      { programme: "Green corridor", metric: "Vehicles alerted", value: p.corridor.vehiclesAlerted },
      { programme: "Green corridor", metric: "Time saved (sec)", value: p.corridor.timeSavedSec },
      { programme: "Green corridor", metric: "Avg time saved / mission (sec)", value: p.corridor.avgTimeSavedSec },
    ];
  }, [p]);

  const topDonorCsv: CsvColumn<TopDonorRow>[] = useMemo(
    () => [
      { header: "Donor", value: (d) => d.name },
      { header: "Gifts", value: (d) => d.count },
      { header: "Amount (INR)", value: (d) => d.amount },
    ],
    []
  );

  const typeMixCsv: CsvColumn<TypeMixRow>[] = useMemo(
    () => [
      { header: "Distribution type", value: (t) => t.type },
      { header: "Drives", value: (t) => t.count },
      { header: "Units", value: (t) => t.quantity },
      { header: "Value (INR)", value: (t) => t.value },
    ],
    []
  );

  const receiptsCsv: CsvColumn<MonthlyReceiptRow>[] = useMemo(
    () => [
      { header: "Month", value: (m) => m.label },
      { header: "80G receipts issued", value: (m) => m.count },
      { header: "Receipted amount (INR)", value: (m) => m.sum },
    ],
    []
  );

  /* ═══════════════════════ table columns ═══════════════════════ */

  const registerColumns: DataTableColumn<RegisterRow>[] = useMemo(
    () => [
      { key: "date", header: "Date", className: "w-28" },
      { key: "receipt", header: "Receipt no", mono: true, hideBelow: "sm", className: "w-44" },
      { key: "donor", header: "Donor", className: "max-w-52" },
      { key: "amount", header: "Amount", align: "right", mono: true },
      { key: "g80", header: "80G", hideBelow: "md" },
      { key: "category", header: "Category", hideBelow: "md" },
      { key: "campaign", header: "Campaign", hideBelow: "lg", className: "max-w-56" },
      { key: "status", header: "Status", hideBelow: "sm" },
    ],
    []
  );

  const campaignColumns: DataTableColumn<CampaignRow>[] = useMemo(
    () => [
      { key: "title", header: "Campaign", className: "max-w-72" },
      { key: "category", header: "Category", hideBelow: "md" },
      { key: "raised", header: "Raised", align: "right", mono: true },
      { key: "target", header: "Target", align: "right", mono: true, hideBelow: "sm" },
      { key: "progress", header: "Utilisation" },
      { key: "inRange", header: "In period", align: "right", mono: true, hideBelow: "lg" },
    ],
    []
  );

  const topDonorColumns: DataTableColumn<TopDonorRow>[] = useMemo(
    () => [
      { key: "rank", header: "#", className: "w-12" },
      { key: "name", header: "Donor" },
      { key: "count", header: "Gifts", align: "right", hideBelow: "sm" },
      { key: "amount", header: "Amount", align: "right", mono: true },
    ],
    []
  );

  /* ═══════════════════════════ render ═══════════════════════════ */

  return (
    <div className="print-sheet space-y-6">
      <PageHeader
        title="Reports"
        description={
          periodLabel
            ? `Trust reporting for boards & regulators — ${periodLabel}${prevPeriodLabel ? ` · ${prevPeriodLabel}` : ""}`
            : "Fundraising, utilisation, programme impact and 80G compliance reporting."
        }
        icon={<FileBarChart className="size-5" aria-hidden="true" />}
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh report"
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} aria-label="Print report">
              <Printer className="size-4" aria-hidden="true" />
              Print report
            </Button>
          </div>
        }
      />

      {/* ───────────────── period controls ───────────────── */}
      <SectionCard
        title="Reporting period"
        description="Financial year (April → March) or any custom range. Toggle comparison to see Δ vs the previous period of equal length."
        icon={<ClipboardList className="size-4" aria-hidden="true" />}
        className="no-print"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Financial year</p>
            <Select value={fy === "custom" ? "custom" : String(fy)} onValueChange={pickFy}>
              <SelectTrigger className="w-40" aria-label="Financial year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fyOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {fyLabel(y)}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">From</p>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFy("custom");
                setFrom(e.target.value);
              }}
              className="w-40"
              aria-label="Period start date"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">To</p>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setFy("custom");
                setTo(e.target.value);
              }}
              className="w-40"
              aria-label="Period end date"
            />
          </div>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm">
            <Switch checked={compare} onCheckedChange={setCompare} aria-label="Compare with previous period" />
            <span className="font-medium">Compare vs previous period</span>
          </label>
        </div>
        {rangeInvalid && (
          <p className="mt-3 text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">
            The start date must be on or before the end date.
          </p>
        )}
      </SectionCard>

      {/* ───────────────── error state ───────────────── */}
      {error && (
        <SectionCard
          title="Could not load the report"
          description={error}
          icon={<AlertCircle className="size-4" aria-hidden="true" />}
          className="border-rose-500/30"
        >
          <Button variant="outline" onClick={() => void load()} aria-label="Retry loading report">
            <RefreshCw className="size-4" aria-hidden="true" /> Retry
          </Button>
        </SectionCard>
      )}

      {/* ───────────────── KPI strip ───────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Funds raised"
          value={formatINRCompact(k?.fundsRaised ?? 0)}
          icon={<Coins className="size-5" aria-hidden="true" />}
          accent="emerald"
          loading={firstLoad}
          hint={
            <span className="flex flex-wrap items-center gap-1.5">
              <DeltaChip
                current={k?.fundsRaised ?? 0}
                previous={showDelta ? (prev?.kpis.fundsRaised ?? null) : undefined}
              />
              <span>{k?.donationCount ?? 0} completed gifts</span>
            </span>
          }
        />
        <StatCard
          label="80G receipts issued"
          value={(k?.receiptsIssued ?? 0).toLocaleString("en-IN")}
          icon={<BadgeCheck className="size-5" aria-hidden="true" />}
          accent="teal"
          loading={firstLoad}
          hint={
            <span className="flex flex-wrap items-center gap-1.5">
              <DeltaChip
                current={k?.receiptsIssued ?? 0}
                previous={showDelta ? (prev?.kpis.receiptsIssued ?? null) : undefined}
              />
              <span>{formatINRCompact(k?.receiptedSum ?? 0)} receipted</span>
            </span>
          }
        />
        <StatCard
          label="Funds disbursed"
          value={formatINRCompact(k?.fundsDisbursed ?? 0)}
          icon={<HandCoins className="size-5" aria-hidden="true" />}
          accent="amber"
          loading={firstLoad}
          hint={
            <span className="flex flex-wrap items-center gap-1.5">
              <DeltaChip
                current={k?.fundsDisbursed ?? 0}
                previous={showDelta ? (prev?.kpis.fundsDisbursed ?? null) : undefined}
              />
              <span>
                {k?.distributionCount ?? 0} distributions ·{" "}
                {(k?.distributionQuantity ?? 0).toLocaleString("en-IN")} units
              </span>
            </span>
          }
        />
        <StatCard
          label="Beneficiaries served"
          value={(k?.beneficiariesServed ?? 0).toLocaleString("en-IN")}
          icon={<HandHeart className="size-5" aria-hidden="true" />}
          accent="pink"
          loading={firstLoad}
          hint={
            <span className="flex flex-wrap items-center gap-1.5">
              <DeltaChip
                current={k?.beneficiariesServed ?? 0}
                previous={showDelta ? (prev?.kpis.beneficiariesServed ?? null) : undefined}
              />
              <span>
                {k?.servedViaDistributions ?? 0} via distributions · {k?.padGirls ?? 0} girls (pads)
              </span>
            </span>
          }
        />
        <StatCard
          label="PAN coverage"
          value={`${k?.panCoveragePct ?? 0}%`}
          icon={<ShieldCheck className="size-5" aria-hidden="true" />}
          accent="lime"
          loading={firstLoad}
          hint={
            <span className="flex flex-wrap items-center gap-1.5">
              <DeltaChip
                current={k?.panCoveragePct ?? 0}
                previous={showDelta ? (prev?.kpis.panCoveragePct ?? null) : undefined}
                pp
              />
              <span>of receipted amount carries donor PAN</span>
            </span>
          }
        />
      </div>

      {/* ───────────────── section tabs ───────────────── */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReportTab)}>
        <TabsList className="no-print h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="register">Donations register</TabsTrigger>
          <TabsTrigger value="utilization">Fund utilisation</TabsTrigger>
          <TabsTrigger value="programmes">Programme impact</TabsTrigger>
          <TabsTrigger value="people">Donors &amp; volunteers</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
        </TabsList>

        {/* ════════════════ 1 · DONATIONS REGISTER ════════════════ */}
        <TabsContent value="register" className="mt-4">
          <SectionCard
            title="Donation & receipts register"
            description="Every gift recorded in the period with its 80G receipt number. Cash gifts above ₹2,000 are not eligible for 80G deduction."
            icon={<HandCoins className="size-4" aria-hidden="true" />}
            actions={
              <div className="no-print flex flex-wrap items-center gap-2">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search donor, receipt, PAN…"
                  className="h-9 w-44 sm:w-56"
                  aria-label="Search donations"
                />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 w-32" aria-label="Filter by payment status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All statuses</SelectItem>
                    {DONATION_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {titleCase(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-9 w-40" aria-label="Filter by category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All categories</SelectItem>
                    {(cur?.categories ?? []).map((c) => (
                      <SelectItem key={c.category} value={c.category}>
                        {titleCase(c.category)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ExportMenu
                  columns={registerCsv}
                  rows={filteredRegister}
                  filename={`uar-donations-register-${periodFilename(from, to)}`}
                  disabled={filteredRegister.length === 0}
                />
              </div>
            }
          >
            {firstLoad ? (
              <TableSkeleton rows={9} />
            ) : (cur?.register ?? []).length === 0 ? (
              <EmptyState
                icon={<HandCoins className="size-6" aria-hidden="true" />}
                title="No donations recorded in this period"
                hint="Gifts made between the selected dates will appear here as they are received."
              />
            ) : filteredRegister.length === 0 ? (
              <EmptyState
                icon={<HandCoins className="size-6" aria-hidden="true" />}
                title="No donations match these filters"
                hint="Try clearing the search box or choosing a different status or category."
              >
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Reset filters
                </Button>
              </EmptyState>
            ) : (
              <div className="space-y-3">
                <DataTable
                  columns={registerColumns}
                  rows={pagedRegister}
                  rowKey={(r) => r.id}
                  height="fill"
                  fillOffset={560}
                  page={page}
                  pages={registerPages}
                  total={filteredRegister.length}
                  pageSize={pageSize}
                  onPage={setPage}
                  onPageSize={(n) => {
                    setPageSize(n);
                    setPage(1);
                  }}
                  itemLabel="donations"
                >
                  {(row, col) => {
                    switch (col.key) {
                      case "date":
                        return formatDate(row.createdAt);
                      case "receipt":
                        return <span className="font-mono text-xs">{row.receiptNumber}</span>;
                      case "donor":
                        return (
                          <span className="flex flex-col">
                            <span className="truncate font-medium">
                              {row.isAnonymous ? "Anonymous" : row.donorName}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">{row.donorEmail}</span>
                          </span>
                        );
                      case "amount":
                        return formatINR(row.amount);
                      case "g80":
                        return row.eligible80g ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-700 dark:text-emerald-400"
                          >
                            80G eligible
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400"
                          >
                            Not eligible
                          </Badge>
                        );
                      case "category":
                        return titleCase(row.category);
                      case "campaign":
                        return (
                          <span className="block truncate text-muted-foreground">
                            {row.campaignTitle ?? "— General fund"}
                          </span>
                        );
                      case "status":
                        return <StatusBadge status={row.paymentStatus} />;
                      default:
                        return "";
                    }
                  }}
                </DataTable>
                {/* totals row */}
                <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/40 p-3 sm:grid-cols-4" data-testid="register-totals">
                  <MiniStat label="Gifts (filtered)" value={registerTotals.gifts.toLocaleString("en-IN")} mono />
                  <MiniStat label="Completed amount" mono value={formatINR(registerTotals.completedSum)} />
                  <MiniStat label="80G-eligible amount" mono value={formatINR(registerTotals.eligibleSum)} />
                  <MiniStat
                    label="Not 80G-eligible (cash > ₹2k)"
                    mono
                    value={formatINR(registerTotals.ineligibleSum)}
                  />
                </div>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ════════════════ 2 · FUND UTILISATION ════════════════ */}
        <TabsContent value="utilization" className="mt-4">
          {firstLoad ? (
            <TabSkeleton />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard
                  title="Giving by category"
                  description="Where donated funds were directed, by purpose"
                  icon={<HandHeart className="size-4" aria-hidden="true" />}
                  actions={
                    <ExportMenu
                      columns={categoryCsv}
                      rows={cur?.categories ?? []}
                      filename={`uar-giving-by-category-${periodFilename(from, to)}`}
                      disabled={(cur?.categories ?? []).length === 0}
                    />
                  }
                >
                  {(cur?.categories ?? []).length === 0 ? (
                    <EmptyState
                      icon={<HandHeart className="size-6" aria-hidden="true" />}
                      title="No categorised donations yet"
                      hint="Completed gifts in this period will be grouped by purpose here."
                    />
                  ) : (
                    <>
                      <ChartContainer config={{}} className="aspect-auto h-44 w-full sm:h-56">
                        <PieChart>
                          <Pie
                            data={cur?.categories ?? []}
                            dataKey="amount"
                            nameKey="category"
                            innerRadius="55%"
                            outerRadius="85%"
                            paddingAngle={2}
                            strokeWidth={0}
                          >
                            {(cur?.categories ?? []).map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                formatter={(value, name) => (
                                  <span className="flex w-full items-center justify-between gap-4">
                                    <span className="text-muted-foreground">{titleCase(String(name))}</span>
                                    <span className="font-mono font-medium tabular-nums">
                                      {formatINR(Number(value))}
                                    </span>
                                  </span>
                                )}
                              />
                            }
                          />
                        </PieChart>
                      </ChartContainer>
                      <ul className="scrollbar-thin mt-2 grid max-h-36 grid-cols-1 gap-x-4 gap-y-1.5 overflow-y-auto text-xs sm:grid-cols-2">
                        {(cur?.categories ?? []).map((c, i) => (
                          <li key={c.category} className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                            />
                            <span className="truncate">{titleCase(c.category)}</span>
                            <span className="ml-auto font-medium tabular-nums">{formatINRCompact(c.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </SectionCard>

                <SectionCard
                  title="Monthly inflow"
                  description="Completed donation amounts across the period"
                  icon={<TrendingUp className="size-4" aria-hidden="true" />}
                >
                  {(cur?.monthly ?? []).every((m) => m.amount === 0) ? (
                    <EmptyState
                      icon={<TrendingUp className="size-6" aria-hidden="true" />}
                      title="No inflow this period"
                      hint="Monthly giving will chart here as donations complete."
                    />
                  ) : (
                    <ChartContainer config={inflowConfig} className="aspect-auto h-48 w-full sm:h-64">
                      <BarChart data={cur?.monthly ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          width={54}
                          tickFormatter={(v: number) => formatINRCompact(v)}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(value, name, item) => (
                                <span className="flex w-full items-center justify-between gap-4">
                                  <span className="text-muted-foreground">
                                    Raised
                                    {item?.payload?.count ? ` · ${item.payload.count} gifts` : ""}
                                  </span>
                                  <span className="font-mono font-medium tabular-nums">
                                    {name === "amount" ? formatINR(Number(value)) : String(value)}
                                  </span>
                                </span>
                              )}
                            />
                          }
                        />
                        <Bar dataKey="amount" fill="var(--color-amount)" radius={[6, 6, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    </ChartContainer>
                  )}
                </SectionCard>
              </div>

              <SectionCard
                title="Campaign utilisation"
                description="Cumulative raised vs target per campaign, plus what landed inside the reporting period"
                icon={<Landmark className="size-4" aria-hidden="true" />}
                actions={
                  <ExportMenu
                    columns={campaignCsv}
                    rows={cur?.campaigns ?? []}
                    filename={`uar-campaign-utilisation-${periodFilename(from, to)}`}
                    disabled={(cur?.campaigns ?? []).length === 0}
                  />
                }
              >
                {(cur?.campaigns ?? []).length === 0 ? (
                  <EmptyState
                    icon={<Landmark className="size-6" aria-hidden="true" />}
                    title="No campaigns yet"
                    hint="Campaign progress will be tracked here once fundraising begins."
                  />
                ) : (
                  <DataTable
                    columns={campaignColumns}
                    rows={cur?.campaigns ?? []}
                    rowKey={(c) => c.id}
                    height="max-h-[26rem]"
                    skeletonRows={6}
                  >
                    {(row, col) => {
                      switch (col.key) {
                        case "title":
                          return <span className="block truncate font-medium">{row.title}</span>;
                        case "category":
                          return <span className="text-muted-foreground">{titleCase(row.category)}</span>;
                        case "raised":
                          return formatINR(row.raised);
                        case "target":
                          return formatINR(row.target);
                        case "progress":
                          return (
                            <span className="flex min-w-32 items-center gap-2">
                              <Progress
                                value={Math.min(100, row.pct)}
                                className="h-2 flex-1"
                                aria-label={`${row.pct}% of target raised`}
                              />
                              <span className="w-10 text-right text-xs font-semibold tabular-nums">{row.pct}%</span>
                            </span>
                          );
                        case "inRange":
                          return formatINR(row.raisedInRange);
                        default:
                          return "";
                      }
                    }}
                  </DataTable>
                )}
                <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border bg-muted/40 p-3 sm:grid-cols-4">
                  <MiniStat label="Raised in period" mono value={formatINR(k?.fundsRaised ?? 0)} />
                  <MiniStat label="Disbursed in period" mono value={formatINR(utilization?.disbursedValue ?? 0)} />
                  <MiniStat
                    label="Disbursement rate"
                    value={`${pctOf(utilization?.disbursedValue ?? 0, k?.fundsRaised ?? 0)}% of raised`}
                  />
                  <MiniStat
                    label="Distribution drives"
                    value={`${utilization?.disbursedCount ?? 0} · ${(utilization?.disbursedQuantity ?? 0).toLocaleString("en-IN")} units`}
                  />
                </div>
              </SectionCard>
            </div>
          )}
        </TabsContent>

        {/* ════════════════ 3 · PROGRAMME IMPACT ════════════════ */}
        <TabsContent value="programmes" className="mt-4">
          {firstLoad ? (
            <TabSkeleton />
          ) : !p ? (
            <EmptyState
              icon={<Package className="size-6" aria-hidden="true" />}
              title="No programme data"
              hint="Programme metrics will appear once operations begin."
            />
          ) : (
            <SectionCard
              title="Programme impact"
              description="Operations delivered across the flagship UAR programmes"
              icon={<HandCoins className="size-4" aria-hidden="true" />}
              actions={
                <ExportMenu
                  columns={programmeCsv}
                  rows={programmeRows}
                  filename={`uar-programme-impact-${periodFilename(from, to)}`}
                  disabled={programmeRows.length === 0}
                />
              }
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {/* Ration kits */}
                <div className="rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <Package className="size-4" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-semibold">Ration kits</p>
                    <Badge
                      variant="outline"
                      className="ml-auto border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    >
                      {pctOf(p.kits.scannedUnits, p.kits.totalUnits)}% scanned
                    </Badge>
                  </div>
                  <Progress
                    value={pctOf(p.kits.scannedUnits, p.kits.totalUnits)}
                    className="mt-3 h-2"
                    aria-label={`${pctOf(p.kits.scannedUnits, p.kits.totalUnits)}% of kits scanned`}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {p.kits.scannedUnits.toLocaleString("en-IN")} of {p.kits.totalUnits.toLocaleString("en-IN")} units
                    scanned · {p.kits.scannedInRange} in period
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MiniStat label="Assembled" value={p.kits.totalUnits.toLocaleString("en-IN")} mono />
                    <MiniStat label="Scanned" value={p.kits.scannedUnits.toLocaleString("en-IN")} mono />
                  </div>
                </div>

                {/* Sanitary pads */}
                <div className="rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-pink-500/10 text-pink-600 dark:text-pink-400">
                      <HandHeart className="size-4" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-semibold">Sanitary pads</p>
                    <Badge variant="outline" className="ml-auto">
                      {p.pads.drives} drive{p.pads.drives === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MiniStat label="Awareness sessions" value={p.pads.sessions.toLocaleString("en-IN")} mono />
                    <MiniStat label="Pads distributed" value={p.pads.pads.toLocaleString("en-IN")} mono />
                    <MiniStat label="Girls reached" value={p.pads.girls.toLocaleString("en-IN")} mono />
                    <MiniStat label="Avg pads / girl" value={p.pads.avgPerGirl.toLocaleString("en-IN")} mono />
                    <MiniStat label="Schools covered" value={p.pads.schools.toLocaleString("en-IN")} mono />
                  </div>
                </div>

                {/* Adopt-a-Medicine */}
                <div className="rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
                      <Pill className="size-4" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-semibold">Adopt-a-Medicine</p>
                    <Badge
                      variant="outline"
                      className="ml-auto border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400"
                    >
                      {formatINR(p.medicine.monthlyPledged)}/mo
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MiniStat label="Seeking" value={p.medicine.seeking.toLocaleString("en-IN")} mono />
                    <MiniStat label="Partially adopted" value={p.medicine.partial.toLocaleString("en-IN")} mono />
                    <MiniStat label="Adopted" value={p.medicine.adopted.toLocaleString("en-IN")} mono />
                    <MiniStat label="Paused" value={p.medicine.paused.toLocaleString("en-IN")} mono />
                    <MiniStat label="Active pledges" value={p.medicine.activePledges.toLocaleString("en-IN")} mono />
                    <MiniStat label="Monthly commitment" mono value={formatINR(p.medicine.monthlyPledged)} />
                  </div>
                </div>

                {/* Animal welfare */}
                <div className="rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-lime-500/10 text-lime-600 dark:text-lime-400">
                      <PawPrint className="size-4" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-semibold">Animal welfare</p>
                    <Badge variant="outline" className="ml-auto">
                      {p.animals.total} resident{p.animals.total === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MiniStat label="Available" value={p.animals.available.toLocaleString("en-IN")} mono />
                    <MiniStat label="Fostered" value={p.animals.fostered.toLocaleString("en-IN")} mono />
                    <MiniStat label="Adopted" value={p.animals.adopted.toLocaleString("en-IN")} mono />
                    <MiniStat
                      label="Critical"
                      mono
                      value={
                        <span className={p.animals.critical > 0 ? "text-rose-600 dark:text-rose-400" : undefined}>
                          {p.animals.critical.toLocaleString("en-IN")}
                        </span>
                      }
                    />
                    <MiniStat label="Active pledges" value={p.animals.activePledges.toLocaleString("en-IN")} mono />
                  </div>
                </div>

                {/* Green corridor */}
                <div className="rounded-xl border p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
                      <Siren className="size-4" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-semibold">AI green corridor</p>
                    <Badge
                      variant="outline"
                      className="ml-auto border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
                    >
                      {p.corridor.missionsCompleted}/{p.corridor.missions} completed
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MiniStat label="Corridor events" value={p.corridor.events.toLocaleString("en-IN")} mono />
                    <MiniStat label="Vehicles alerted" value={p.corridor.vehiclesAlerted.toLocaleString("en-IN")} mono />
                    <MiniStat label="Time saved (total)" mono value={formatDuration(p.corridor.timeSavedSec)} />
                    <MiniStat
                      label="Avg time saved / mission"
                      mono
                      value={formatDuration(p.corridor.avgTimeSavedSec)}
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          )}
        </TabsContent>

        {/* ════════════════ 4 · DONORS & VOLUNTEERS ════════════════ */}
        <TabsContent value="people" className="mt-4">
          {firstLoad || !people ? (
            <TabSkeleton />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Donor loyalty */}
              <SectionCard
                title="Donor loyalty"
                description="First-time vs returning supporters in this period"
                icon={<Users className="size-4" aria-hidden="true" />}
              >
                {people.donors.total === 0 ? (
                  <EmptyState
                    icon={<Users className="size-6" aria-hidden="true" />}
                    title="No donors in this period"
                    hint="Completed gifts will build the donor mix here."
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <MiniStat label="Total donors" value={people.donors.total.toLocaleString("en-IN")} mono />
                      <MiniStat label="New" value={people.donors.new.toLocaleString("en-IN")} mono />
                      <MiniStat label="Repeat" value={people.donors.repeat.toLocaleString("en-IN")} mono />
                    </div>
                    <div className="mt-3 space-y-2">
                      <ShareBar
                        label="New donors"
                        value={people.donors.new}
                        max={Math.max(1, people.donors.total)}
                        colorClass="bg-emerald-500"
                        trailing={`${pctOf(people.donors.new, people.donors.total)}%`}
                      />
                      <ShareBar
                        label="Repeat donors"
                        value={people.donors.repeat}
                        max={Math.max(1, people.donors.total)}
                        colorClass="bg-teal-500"
                        trailing={`${pctOf(people.donors.repeat, people.donors.total)}%`}
                      />
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Repeat rate {pctOf(people.donors.repeat, people.donors.total)}% · average gift{" "}
                      {formatINR(k?.avgDonation ?? 0)} · {k?.donorCount ?? 0} distinct donors
                    </p>
                  </>
                )}
              </SectionCard>

              {/* Top donors */}
              <SectionCard
                title="Top donors"
                description="Ranked by completed giving in the period · anonymous gifts stay masked"
                icon={<HandCoins className="size-4" aria-hidden="true" />}
                actions={
                  <ExportMenu
                    columns={topDonorCsv}
                    rows={people.topDonors}
                    filename={`uar-top-donors-${periodFilename(from, to)}`}
                    disabled={people.topDonors.length === 0}
                  />
                }
              >
                {people.topDonors.length === 0 ? (
                  <EmptyState
                    icon={<HandCoins className="size-6" aria-hidden="true" />}
                    title="No completed gifts yet"
                    hint="Donors will be ranked once gifts complete in this period."
                  />
                ) : (
                  <DataTable
                    columns={topDonorColumns}
                    rows={people.topDonors}
                    rowKey={(d) => `${d.name}-${d.amount}`}
                    height="max-h-96"
                    skeletonRows={5}
                  >
                    {(row, col) => {
                      switch (col.key) {
                        case "rank":
                          return (
                            <span
                              className={cn(
                                "grid size-6 place-items-center rounded-full text-xs font-semibold",
                                people.topDonors.indexOf(row) < 3
                                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {people.topDonors.indexOf(row) + 1}
                            </span>
                          );
                        case "name":
                          return <span className="block truncate font-medium">{row.name}</span>;
                        case "count":
                          return row.count;
                        case "amount":
                          return formatINR(row.amount);
                        default:
                          return "";
                      }
                    }}
                  </DataTable>
                )}
              </SectionCard>

              {/* Volunteer funnel */}
              <SectionCard
                title="Volunteer applications"
                description="All-time onboarding funnel (applications are not period-bound)"
                icon={<ClipboardList className="size-4" aria-hidden="true" />}
              >
                {people.volunteerApplications.total === 0 ? (
                  <EmptyState
                    icon={<ClipboardList className="size-6" aria-hidden="true" />}
                    title="No applications yet"
                    hint="Volunteer sign-ups will flow through this funnel."
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <MiniStat
                        label="Total"
                        value={people.volunteerApplications.total.toLocaleString("en-IN")}
                        mono
                      />
                      <MiniStat
                        label="Pending"
                        value={people.volunteerApplications.pending.toLocaleString("en-IN")}
                        mono
                      />
                      <MiniStat
                        label="Approved"
                        value={people.volunteerApplications.approved.toLocaleString("en-IN")}
                        mono
                      />
                      <MiniStat
                        label="Rejected"
                        value={people.volunteerApplications.rejected.toLocaleString("en-IN")}
                        mono
                      />
                    </div>
                    <div
                      className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={`Funnel: ${people.volunteerApplications.approved} approved, ${people.volunteerApplications.pending} pending, ${people.volunteerApplications.rejected} rejected`}
                    >
                      <div
                        className="bg-emerald-500"
                        style={{
                          width: `${pctOf(people.volunteerApplications.approved, people.volunteerApplications.total)}%`,
                        }}
                      />
                      <div
                        className="bg-amber-500"
                        style={{
                          width: `${pctOf(people.volunteerApplications.pending, people.volunteerApplications.total)}%`,
                        }}
                      />
                      <div
                        className="bg-rose-500"
                        style={{
                          width: `${pctOf(people.volunteerApplications.rejected, people.volunteerApplications.total)}%`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden="true" className="size-2 rounded-full bg-emerald-500" /> Approved
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden="true" className="size-2 rounded-full bg-amber-500" /> Pending
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden="true" className="size-2 rounded-full bg-rose-500" /> Rejected
                      </span>
                    </div>
                  </>
                )}
              </SectionCard>

              {/* Beneficiaries + distribution mix */}
              <SectionCard
                title="Beneficiaries & ground delivery"
                description="Onboarded cases by category and urgency, plus what reached the ground"
                icon={<Landmark className="size-4" aria-hidden="true" />}
                actions={
                  <ExportMenu
                    columns={typeMixCsv}
                    rows={utilization?.byType ?? []}
                    filename={`uar-distribution-mix-${periodFilename(from, to)}`}
                    disabled={(utilization?.byType ?? []).length === 0}
                  />
                }
              >
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat
                    label="Beneficiaries onboarded"
                    value={people.beneficiaries.total.toLocaleString("en-IN")}
                    mono
                  />
                  <MiniStat
                    label="Onboarded in period"
                    value={people.beneficiaries.onboardedInRange.toLocaleString("en-IN")}
                    mono
                  />
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      By category
                    </p>
                    {people.beneficiaries.byCategory.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No beneficiaries onboarded yet.</p>
                    ) : (
                      people.beneficiaries.byCategory.slice(0, 6).map((b, i) => (
                        <ShareBar
                          key={b.category}
                          label={titleCase(b.category)}
                          value={b.count}
                          max={Math.max(1, ...people.beneficiaries.byCategory.map((x) => x.count))}
                          colorClass={BAR_COLORS[i % BAR_COLORS.length]}
                        />
                      ))
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      By urgency
                    </p>
                    {people.beneficiaries.byUrgency.every((u) => u.count === 0) ? (
                      <p className="text-xs text-muted-foreground">No urgency data yet.</p>
                    ) : (
                      people.beneficiaries.byUrgency.map((u) => (
                        <div key={u.urgency} className="flex items-center justify-between gap-2">
                          <StatusBadge
                            status={u.urgency}
                            tone={
                              u.urgency === "CRITICAL"
                                ? "danger"
                                : u.urgency === "HIGH"
                                  ? "warning"
                                  : u.urgency === "MEDIUM"
                                    ? "info"
                                    : "neutral"
                            }
                          />
                          <span className="text-sm font-semibold tabular-nums">{u.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="mt-4 space-y-2 border-t pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Distribution type mix (period)
                  </p>
                  {(utilization?.byType ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No distributions recorded in this period.</p>
                  ) : (
                    <div className="space-y-2">
                      {(utilization?.byType ?? []).slice(0, 6).map((t, i) => (
                        <ShareBar
                          key={t.type}
                          label={`${titleCase(t.type)} · ${t.count} drive${t.count === 1 ? "" : "s"}`}
                          value={t.quantity}
                          max={Math.max(1, ...(utilization?.byType ?? []).map((x) => x.quantity))}
                          colorClass={BAR_COLORS[i % BAR_COLORS.length]}
                          trailing={`${t.quantity.toLocaleString("en-IN")} units · ${formatINRCompact(t.value)}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </SectionCard>
            </div>
          )}
        </TabsContent>

        {/* ════════════════ 5 · COMPLIANCE ════════════════ */}
        <TabsContent value="compliance" className="mt-4">
          {firstLoad || !compliance ? (
            <TabSkeleton />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard
                title="80G receipts issued"
                description={`Receipts raised for completed gifts between ${formatDate(from)} and ${formatDate(to)}`}
                icon={<BadgeCheck className="size-4" aria-hidden="true" />}
                actions={
                  <ExportMenu
                    columns={receiptsCsv}
                    rows={compliance.monthlyReceipts}
                    filename={`uar-80g-receipts-${periodFilename(from, to)}`}
                  />
                }
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MiniStat label="Receipts issued" value={compliance.receiptCount.toLocaleString("en-IN")} mono />
                  <MiniStat label="Receipted amount" mono value={formatINR(compliance.receiptSum)} />
                  <MiniStat
                    label="80G-ineligible cash"
                    mono
                    value={
                      <span
                        className={
                          compliance.ineligible80g.count > 0
                            ? "text-amber-700 dark:text-amber-400"
                            : undefined
                        }
                      >
                        {formatINR(compliance.ineligible80g.sum)}
                      </span>
                    }
                  />
                  <MiniStat
                    label="Receipts with PAN"
                    mono
                    value={`${compliance.panReceipts.count.toLocaleString("en-IN")} · ${formatINRCompact(
                      compliance.panReceipts.sum
                    )}`}
                  />
                </div>
                {compliance.ineligible80g.count > 0 && (
                  <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                    {compliance.ineligible80g.count} cash gift
                    {compliance.ineligible80g.count === 1 ? "" : "s"} above ₹2,000 (
                    {formatINR(compliance.ineligible80g.sum)}) cannot carry an 80G deduction — exclude from deduction
                    claims.
                  </p>
                )}
                <div className="mt-4">
                  {compliance.receiptCount === 0 ? (
                    <EmptyState
                      icon={<BadgeCheck className="size-6" aria-hidden="true" />}
                      title="No receipts issued in this period"
                      hint="80G receipts are generated automatically when gifts complete."
                    />
                  ) : (
                    <ChartContainer config={receiptsConfig} className="aspect-auto h-40 w-full sm:h-48">
                      <BarChart data={compliance.monthlyReceipts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          width={30}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(value, name, item) => (
                                <span className="flex w-full items-center justify-between gap-4">
                                  <span className="text-muted-foreground">
                                    Receipts
                                    {item?.payload?.sum
                                      ? ` · ${formatINRCompact(Number(item.payload.sum))}`
                                      : ""}
                                  </span>
                                  <span className="font-mono font-medium tabular-nums">
                                    {name === "receipts" ? Number(value).toLocaleString("en-IN") : String(value)}
                                  </span>
                                </span>
                              )}
                            />
                          }
                        />
                        <Bar dataKey="receipts" fill="var(--color-receipts)" radius={[6, 6, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    </ChartContainer>
                  )}
                </div>
              </SectionCard>

              <SectionCard
                title="Trust registration & tax credentials"
                description="Numbers quoted on every 80G receipt and board report"
                icon={<Landmark className="size-4" aria-hidden="true" />}
              >
                {!org ? (
                  <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="space-y-1.5">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-4 w-40" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                    <DataField label="Trust name" value={org.orgName} />
                    <DataField label="Headquarters" value={org.orgHq} />
                    <DataField label="80G registration" value={org.org80g} mono copy />
                    <DataField label="12A reference" value={org.orgReg12a} mono copy />
                    <DataField label="Trust PAN" value={org.orgPan} mono copy />
                    <DataField label="NGO Darpan ID" value={org.orgDarpan} mono copy />
                    <DataField label="Signatory" value={`${org.signatoryName} · ${org.signatoryRole}`} />
                    <DataField label="Contact" value={`${org.orgEmail} · ${org.orgPhone}`} />
                  </div>
                )}
                <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                  Donations to the trust are eligible for deduction under section 80G of the Income-tax Act, 1961.
                  Cash contributions above ₹2,000 do not qualify. Receipts are system-generated with a unique number
                  and remain available for download from the receipts register.
                </div>
              </SectionCard>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
