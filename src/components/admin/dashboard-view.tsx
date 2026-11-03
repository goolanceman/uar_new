"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Ambulance,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  ClipboardList,
  HandCoins,
  HeartHandshake,
  Inbox,
  LayoutDashboard,
  ListChecks,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  SlidersHorizontal,
  Sprout,
  TrendingDown,
  TrendingUp,
  UserRoundPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { cn, timeAgo } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  financialYear,
  formatINR,
  formatINRCompact,
  formatDateTime,
  titleCase,
  initials,
} from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { StatusBadge } from "@/components/shared/status-badge";

/* ------------------------------ types & helpers ----------------------------- */

type Rec = Record<string, unknown>;

type RangeKey = "fy" | "30d" | "90d" | "all";

const RANGE_OPTIONS: { value: RangeKey; label: string; aria: string }[] = [
  { value: "fy", label: "FY", aria: "Current financial year" },
  { value: "30d", label: "30d", aria: "Last 30 days" },
  { value: "90d", label: "90d", aria: "Last 90 days" },
  { value: "all", label: "All", aria: "All time" },
];

function rangeWindow(range: RangeKey): { from?: string; to?: string; label: string } {
  const now = new Date();
  if (range === "all") return { label: "All time" };
  if (range === "fy") {
    const y = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
    return {
      from: new Date(y, 3, 1).toISOString(),
      to: now.toISOString(),
      label: financialYear(now),
    };
  }
  const days = range === "30d" ? 30 : 90;
  return {
    from: new Date(now.getTime() - days * 86_400_000).toISOString(),
    to: now.toISOString(),
    label: `Last ${days} days`,
  };
}

function asArray(v: unknown): Rec[] {
  if (Array.isArray(v)) return v as Rec[];
  if (v && typeof v === "object") {
    const o = v as Rec;
    if (Array.isArray(o.items)) return o.items as Rec[];
  }
  return [];
}

function pickNum(o: Rec | null | undefined, keys: string[], fb = 0): number {
  if (!o) return fb;
  const sources: Rec[] = [o, (o.kpis ?? {}) as Rec, (o.totals ?? {}) as Rec];
  for (const src of sources) {
    for (const k of keys) {
      const v = src[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
    }
  }
  return fb;
}

function pickStr(o: Rec | null | undefined, keys: string[], fb = ""): string {
  if (!o) return fb;
  const sources: Rec[] = [o, (o.kpis ?? {}) as Rec, (o.totals ?? {}) as Rec];
  for (const src of sources) {
    for (const k of keys) {
      const v = src[k];
      if (typeof v === "string" && v) return v;
    }
  }
  return fb;
}

/* Theme-token chart palette: chart-1..5 first, then brand-safe accents
   (emerald → orange → pink → teal → lime → red → cyan → fuchsia). */
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#f97316",
  "#ec4899",
  "#14b8a6",
  "#84cc16",
  "#ef4444",
  "#06b6d4",
  "#d946ef",
];

/* ------------------------------ widget registry ----------------------------- */

const WIDGET_DEFS = [
  { id: "kpis", label: "KPI cards" },
  { id: "trend", label: "Giving trend" },
  { id: "mix", label: "Category mix" },
  { id: "attention", label: "Needs attention" },
  { id: "donations", label: "Latest donations" },
  { id: "tasks", label: "Pending tasks & approvals" },
  { id: "upcoming", label: "Upcoming schedule" },
  { id: "activity", label: "Recent activity" },
  { id: "actions", label: "Quick actions" },
] as const;

type WidgetId = (typeof WIDGET_DEFS)[number]["id"];

const WIDGETS_STORAGE_KEY = "uar-dash-widgets";
const ALL_WIDGETS_ON = WIDGET_DEFS.reduce(
  (acc, w) => ({ ...acc, [w.id]: true }),
  {} as Record<WidgetId, boolean>
);

function readWidgetPrefs(): Record<WidgetId, boolean> {
  try {
    const raw = window.localStorage.getItem(WIDGETS_STORAGE_KEY);
    if (!raw) return { ...ALL_WIDGETS_ON };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const merged = { ...ALL_WIDGETS_ON };
    for (const w of WIDGET_DEFS) {
      const v = parsed[w.id];
      if (typeof v === "boolean") merged[w.id] = v;
    }
    return merged;
  } catch {
    return { ...ALL_WIDGETS_ON };
  }
}

/** Staggered fade-in wrapper — decorative only, honours prefers-reduced-motion. */
function Fade({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div
      className="animate-fade-in"
      style={{ animationDelay: `${index * 70}ms`, animationFillMode: "both" }}
    >
      {children}
    </div>
  );
}

/** Small up/down delta pill used inside StatCard hints. */
function DeltaChip({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null || !Number.isFinite(pct)) {
    return <span className="text-xs text-muted-foreground">{label}</span>;
  }
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {up ? "+" : ""}
      {pct.toFixed(0)}% {label}
    </span>
  );
}

interface QuickAction {
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  accent: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Record donation", hint: "Log an offline gift", icon: HandCoins, to: "/admin/donations", accent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  { label: "New campaign", hint: "Launch a fundraiser", icon: Sprout, to: "/admin/campaigns", accent: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  { label: "Onboard beneficiary", hint: "Register someone in need", icon: UserRoundPlus, to: "/admin/beneficiaries", accent: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400" },
  { label: "Dispatch ambulance", hint: "Start a green-corridor mission", icon: Ambulance, to: "/admin/ambulance", accent: "bg-red-500/10 text-red-600 dark:text-red-400" },
  { label: "Create kit batch", hint: "Print ration-kit QR labels", icon: ClipboardList, to: "/admin/kits", accent: "bg-lime-500/10 text-lime-600 dark:text-lime-400" },
];

/* ---------------------------------- view ----------------------------------- */

export default function DashboardView() {
  const { user } = useAuth();

  const [range, setRange] = useState<RangeKey>("fy");
  const [stats, setStats] = useState<Rec | null>(null);
  const [tasks, setTasks] = useState<Rec[]>([]);
  const [pendingApps, setPendingApps] = useState<Rec[]>([]);
  const [pendingRequests, setPendingRequests] = useState<Rec[]>([]);
  const [lowStock, setLowStock] = useState<Rec[]>([]);
  const [pendingQueries, setPendingQueries] = useState<Rec[]>([]);
  const [activity, setActivity] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Widget visibility — hydrated from localStorage AFTER mount (SSR-safe:
  // first render always shows every section, prefs apply post-hydration).
  const [visible, setVisible] = useState<Record<WidgetId, boolean>>({ ...ALL_WIDGETS_ON });

  useEffect(() => {
    setVisible(readWidgetPrefs());
  }, []);

  const toggleWidget = (id: WidgetId, on: boolean) => {
    setVisible((prev) => {
      const next = { ...prev, [id]: on };
      try {
        window.localStorage.setItem(WIDGETS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable — session-only customisation
      }
      return next;
    });
  };

  const showAllWidgets = () => {
    setVisible({ ...ALL_WIDGETS_ON });
    try {
      window.localStorage.removeItem(WIDGETS_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const on = useCallback((id: WidgetId) => visible[id], [visible]);

  /* --------------------------------- data ---------------------------------- */

  const load = useCallback(
    async (rangeKey: RangeKey) => {
      setRefreshing(true);
      const win = rangeWindow(rangeKey);
      const qs =
        win.from && win.to
          ? `?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}`
          : "";
      try {
        const [s, tasksRaw, apps, requests, inv, queries, logs] = await Promise.all([
          get<Rec>(`/api/stats${qs}`),
          get<unknown>("/api/volunteer-tasks").catch(() => [] as unknown),
          get<unknown>("/api/volunteer-applications?status=PENDING").catch(() => [] as unknown),
          get<unknown>("/api/beneficiary-requests?status=PENDING").catch(() => [] as unknown),
          get<unknown>("/api/inventory?limit=100").catch(() => [] as unknown),
          get<unknown>("/api/contact-queries?status=PENDING").catch(() => [] as unknown),
          get<unknown>("/api/activity-logs?limit=10").catch(() => [] as unknown),
        ]);
        setStats(s ?? {});
        setTasks(asArray(tasksRaw));
        setPendingApps(asArray(apps));
        setPendingRequests(asArray(requests));
        setLowStock(asArray(inv).filter((i) => Number(i.quantity ?? 0) <= Number(i.minStock ?? 0)));
        setPendingQueries(asArray(queries));
        setActivity(asArray(logs));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    load(range);
  }, [load, range]);

  /* --------------------------------- KPIs ---------------------------------- */

  const totals = (stats?.totals ?? {}) as Rec;
  const deltas = (stats?.deltas ?? null) as {
    raised?: { pct: number | null };
    donations?: { pct: number | null };
  } | null;

  const raised = pickNum(stats, ["raised"], 0) || pickNum(totals, ["raised"], 0);
  const donationCount = pickNum(totals, ["donations"], 0);
  const activeCampaigns = pickNum(totals, ["campaigns"], 0);
  const beneficiaries = pickNum(totals, ["beneficiaries"], 0);
  const pendingApprovals = pendingApps.length + pendingRequests.length;

  const rangeLabel = rangeWindow(range).label;
  const deltaLabel = range === "all" ? "all time" : `vs prev ${range === "fy" ? "FY" : range === "30d" ? "30d" : "90d"}`;

  /* -------------------------------- charts --------------------------------- */

  const trend = useMemo(
    () =>
      asArray(stats?.monthly).map((m) => ({
        month: pickStr(m, ["month", "label", "name"], "—"),
        amount: pickNum(m, ["amount", "value"], 0),
      })),
    [stats]
  );

  const donut = useMemo(
    () =>
      asArray(stats?.categories)
        .map((c) => ({
          name: titleCase(pickStr(c, ["category", "name", "type"], "Other")),
          value: pickNum(c, ["amount", "value", "count"], 0),
        }))
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 9),
    [stats]
  );

  const fy = financialYear(new Date());

  /* ----------------------------- needs attention --------------------------- */

  const attention: {
    key: string;
    icon: React.ReactNode;
    tone: string;
    title: string;
    detail: string;
    action: string;
    to: string;
  }[] = [];

  if (lowStock.length > 0) {
    const first = lowStock.slice(0, 3).map((i) => pickStr(i, ["name"], "Item"));
    attention.push({
      key: "stock",
      icon: <PackageCheck className="size-4" aria-hidden="true" />,
      tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      title: `${lowStock.length} inventory item${lowStock.length === 1 ? "" : "s"} at or below minimum stock`,
      detail: first.join(" · ") + (lowStock.length > 3 ? ` +${lowStock.length - 3} more` : ""),
      action: "Restock",
      to: "/admin/inventory",
    });
  }
  if (pendingApps.length > 0) {
    const first = pendingApps.slice(0, 3).map((a) => pickStr(a, ["fullName", "name"], "Applicant"));
    attention.push({
      key: "volunteers",
      icon: <BadgeCheck className="size-4" aria-hidden="true" />,
      tone: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
      title: `${pendingApps.length} volunteer application${pendingApps.length === 1 ? "" : "s"} awaiting review`,
      detail: first.join(" · ") + (pendingApps.length > 3 ? ` +${pendingApps.length - 3} more` : ""),
      action: "Review",
      to: "/admin/volunteers",
    });
  }
  if (pendingRequests.length > 0) {
    attention.push({
      key: "requests",
      icon: <HeartHandshake className="size-4" aria-hidden="true" />,
      tone: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
      title: `${pendingRequests.length} beneficiary request${pendingRequests.length === 1 ? "" : "s"} awaiting review`,
      detail:
        pendingRequests
          .slice(0, 3)
          .map((r) => pickStr(r, ["name"], "Request"))
          .join(" · ") + (pendingRequests.length > 3 ? ` +${pendingRequests.length - 3} more` : ""),
      action: "Review",
      to: "/admin/beneficiaries",
    });
  }
  if (pendingQueries.length > 0) {
    attention.push({
      key: "queries",
      icon: <Inbox className="size-4" aria-hidden="true" />,
      tone: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
      title: `${pendingQueries.length} unresolved contact quer${pendingQueries.length === 1 ? "y" : "ies"}`,
      detail: pendingQueries
        .slice(0, 3)
        .map((c) => pickStr(c, ["subject"], "Query"))
        .join(" · "),
      action: "Open reports",
      to: "/admin/reports",
    });
  }

  /* ---------------------------- latest donations --------------------------- */

  const recent: { name: string; amount: number; campaign: string; at: string }[] = asArray(
    stats?.recentDonations
  )
    .slice(0, 5)
    .map((d) => ({
      name: pickStr(d, ["donorName", "name"], "Anonymous"),
      amount: pickNum(d, ["amount"], 0),
      campaign: pickStr(d, ["campaign"], "General Fund"),
      at: pickStr(d, ["createdAt", "date"]),
    }));

  /* -------------------------- tasks & schedule ----------------------------- */

  const openTasks = useMemo(
    () =>
      tasks
        .filter((t) => ["ASSIGNED", "IN_PROGRESS"].includes(pickStr(t, ["status"])))
        .sort(
          (a, b) =>
            new Date(pickStr(a, ["scheduledDate"])).getTime() -
            new Date(pickStr(b, ["scheduledDate"])).getTime()
        ),
    [tasks]
  );

  const pendingTasks = openTasks.slice(0, 6);

  const upcoming = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return openTasks
      .filter((t) => new Date(pickStr(t, ["scheduledDate"])).getTime() >= todayStart.getTime())
      .slice(0, 6);
  }, [openTasks]);

  const volunteerName = (t: Rec) =>
    pickStr((t.volunteer ?? {}) as Rec, ["name"]) ||
    pickStr(((t.volunteer ?? {}) as Rec).user as Rec | undefined, ["name"], "Unassigned");

  /* ---------------------------- recent activity ---------------------------- */

  const activityRows = activity.slice(0, 8);

  /* ------------------------------- greeting -------------------------------- */

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (user?.name ?? "Admin").trim().split(/\s+/)[0] || "Admin";

  /* ------------------------------ pair helpers ----------------------------- */

  const showTrend = on("trend");
  const showMix = on("mix");
  const showAttention = on("attention");
  const showDonations = on("donations");

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={`Trust operations at a glance · ${fy} · Bengaluru → India`}
        icon={<LayoutDashboard className="size-5" aria-hidden="true" />}
        actions={
          <Button variant="outline" onClick={() => load(range)} disabled={refreshing} aria-label="Refresh dashboard data">
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {/* Range + customise toolbar */}
      <Fade index={0}>
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Dashboard controls">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={range}
            onValueChange={(v) => {
              if (v) setRange(v as RangeKey);
            }}
            aria-label="Date range for dashboard data"
          >
            {RANGE_OPTIONS.map((r) => (
              <ToggleGroupItem key={r.value} value={r.value} aria-label={r.aria} className="min-h-9 px-3">
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="min-h-9" aria-label="Customise dashboard sections">
                <SlidersHorizontal className="size-4" aria-hidden="true" /> Customise
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Dashboard sections
              </p>
              <div className="space-y-0.5">
                {WIDGET_DEFS.map((w) => (
                  <label
                    key={w.id}
                    className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm transition-colors hover:bg-accent"
                  >
                    <Checkbox
                      checked={visible[w.id]}
                      onCheckedChange={(v) => toggleWidget(w.id, v === true)}
                      aria-label={`Show ${w.label}`}
                    />
                    {w.label}
                  </label>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={showAllWidgets}>
                Show all sections
              </Button>
            </PopoverContent>
          </Popover>

          <p className="ml-auto hidden text-xs text-muted-foreground sm:block" aria-live="polite">
            Showing <span className="font-medium text-foreground">{rangeLabel}</span>
          </p>
        </div>
      </Fade>

      {/* KPI row */}
      {on("kpis") && (
        <Fade index={1}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
            <StatCard
              label="Funds raised"
              value={formatINRCompact(raised)}
              icon={<TrendingUp className="size-5" aria-hidden="true" />}
              accent="emerald"
              hint={<DeltaChip pct={deltas?.raised?.pct ?? null} label={deltaLabel} />}
              loading={loading}
            />
            <StatCard
              label="Donations"
              value={donationCount.toLocaleString("en-IN")}
              icon={<ReceiptText className="size-5" aria-hidden="true" />}
              accent="teal"
              hint={<DeltaChip pct={deltas?.donations?.pct ?? null} label={deltaLabel} />}
              loading={loading}
            />
            <StatCard
              label="Active campaigns"
              value={activeCampaigns.toLocaleString("en-IN")}
              icon={<Sprout className="size-5" aria-hidden="true" />}
              accent="orange"
              hint="currently fundraising"
              loading={loading}
            />
            <StatCard
              label="Beneficiaries"
              value={beneficiaries.toLocaleString("en-IN")}
              icon={<HeartHandshake className="size-5" aria-hidden="true" />}
              accent="fuchsia"
              hint="people supported"
              loading={loading}
            />
            <StatCard
              label="Pending approvals"
              value={pendingApprovals.toLocaleString("en-IN")}
              icon={<Users className="size-5" aria-hidden="true" />}
              accent="amber"
              hint="applications & requests"
              loading={loading}
            />
          </div>
        </Fade>
      )}

      {/* Giving trend + category mix */}
      {(showTrend || showMix) && (
        <Fade index={2}>
          <div className="grid gap-4 lg:grid-cols-5">
            {showTrend && (
              <SectionCard
                className={cn(!showMix && "lg:col-span-5", showMix && "lg:col-span-3")}
                title="Giving trend"
                description={`Funds raised per month · ${rangeLabel}`}
                icon={<TrendingUp className="size-4" aria-hidden="true" />}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/reports")} aria-label="View all reports">
                    View all <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                }
              >
                {loading ? (
                  <Skeleton className="h-64 w-full" />
                ) : trend.length === 0 ? (
                  <EmptyState
                    icon={<TrendingUp className="size-6" aria-hidden="true" />}
                    title="No giving data yet"
                    hint="The trend chart fills in as donations arrive."
                  />
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="dashTrendFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: number) => formatINRCompact(v)}
                          width={56}
                        />
                        <Tooltip formatter={(v) => [formatINR(Number(v)), "Raised"]} />
                        <Area
                          type="monotone"
                          dataKey="amount"
                          stroke="var(--chart-1)"
                          strokeWidth={2}
                          fill="url(#dashTrendFill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </SectionCard>
            )}

            {showMix && (
              <SectionCard
                className={cn(!showTrend && "lg:col-span-5", showTrend && "lg:col-span-2")}
                title="Giving by category"
                description={`${rangeLabel} donation mix`}
                icon={<HandCoins className="size-4" aria-hidden="true" />}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/donations")} aria-label="View all donations by category">
                    View all <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                }
              >
                {loading ? (
                  <Skeleton className="h-64 w-full" />
                ) : donut.length === 0 ? (
                  <EmptyState
                    icon={<HandCoins className="size-6" aria-hidden="true" />}
                    title="No category data yet"
                    hint="Categorised donations will appear here."
                  />
                ) : (
                  <div className="flex h-64 flex-col">
                    <div className="min-h-0 flex-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={donut}
                            dataKey="value"
                            nameKey="name"
                            innerRadius="58%"
                            outerRadius="88%"
                            paddingAngle={2}
                            strokeWidth={0}
                          >
                            {donut.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v, name) => [formatINR(Number(v)), String(name)]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex max-h-20 flex-wrap justify-center gap-x-3 gap-y-1 overflow-y-auto scrollbar-thin">
                      {donut.map((c, i) => (
                        <span key={c.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                            aria-hidden="true"
                          />
                          {c.name} · {formatINRCompact(c.value)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        </Fade>
      )}

      {/* Needs attention + latest donations */}
      {(showAttention || showDonations) && (
        <Fade index={3}>
          <div className="grid gap-4 lg:grid-cols-5">
            {showAttention && (
              <SectionCard
                className={cn(!showDonations && "lg:col-span-5", showDonations && "lg:col-span-3")}
                title="Needs attention"
                description="Items that need an admin decision"
                icon={<BadgeCheck className="size-4" aria-hidden="true" />}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/activity")} aria-label="Open activity logs">
                    Activity logs <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                }
              >
                {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : attention.length === 0 ? (
                  <EmptyState
                    icon={<BadgeCheck className="size-6" aria-hidden="true" />}
                    title="Everything is on track"
                    hint="No low stock, pending applications or unresolved queries right now."
                  />
                ) : (
                  <ul className="max-h-72 space-y-2 overflow-y-auto scrollbar-thin" aria-label="Items needing attention">
                    {attention.map((a) => (
                      <li
                        key={a.key}
                        className="flex items-center gap-3 rounded-lg border p-3 transition hover:bg-accent/50"
                      >
                        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", a.tone)}>
                          {a.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{a.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{a.detail}</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => navigate(a.to)} aria-label={`${a.action} — ${a.title}`}>
                          {a.action} <ArrowRight className="size-3.5" aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            )}

            {showDonations && (
              <SectionCard
                className={cn(!showAttention && "lg:col-span-5", showAttention && "lg:col-span-2")}
                title="Latest donations"
                description="Most recent completed gifts"
                icon={<ReceiptText className="size-4" aria-hidden="true" />}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/donations")} aria-label="View all donations">
                    View all <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                }
              >
                {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : recent.length === 0 ? (
                  <EmptyState
                    icon={<ReceiptText className="size-6" aria-hidden="true" />}
                    title="No donations yet"
                    hint="Recorded gifts will appear here instantly."
                  >
                    <Button size="sm" onClick={() => navigate("/admin/donations")}>
                      <HandCoins className="size-4" aria-hidden="true" /> Record donation
                    </Button>
                  </EmptyState>
                ) : (
                  <ul className="max-h-72 divide-y overflow-y-auto scrollbar-thin" aria-label="Latest donations">
                    {recent.map((d, i) => (
                      <li key={`${d.name}-${i}`} className="flex items-center gap-3 py-2.5">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
                          {initials(d.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{d.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            <ReceiptText className="mr-1 inline size-3" aria-hidden="true" />
                            {d.campaign} · {d.at ? formatDateTime(d.at) : "recently"}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold">{formatINR(d.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            )}
          </div>
        </Fade>
      )}

      {/* Pending tasks + upcoming schedule */}
      {(on("tasks") || on("upcoming")) && (
        <Fade index={4}>
          <div className="grid gap-4 lg:grid-cols-5">
            {on("tasks") && (
              <SectionCard
                className={cn(!on("upcoming") && "lg:col-span-5", on("upcoming") && "lg:col-span-3")}
                title="Pending tasks"
                description="Open volunteer tasks awaiting completion"
                icon={<ListChecks className="size-4" aria-hidden="true" />}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/volunteers")} aria-label="View all volunteer tasks">
                    View all <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                }
              >
                {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : pendingTasks.length === 0 ? (
                  <EmptyState
                    icon={<ListChecks className="size-6" aria-hidden="true" />}
                    title="No open tasks"
                    hint="Assigned and in-progress volunteer tasks will appear here."
                  />
                ) : (
                  <ul className="max-h-72 divide-y overflow-y-auto scrollbar-thin" aria-label="Pending volunteer tasks">
                    {pendingTasks.map((t, i) => {
                      const status = pickStr(t, ["status"], "ASSIGNED");
                      return (
                        <li key={pickStr(t, ["id"], String(i))} className="flex items-center gap-3 py-2.5">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
                            <ListChecks className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{pickStr(t, ["title"], "Task")}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {volunteerName(t)} · due {formatDateTime(pickStr(t, ["scheduledDate"]))}
                            </p>
                          </div>
                          <StatusBadge status={status} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </SectionCard>
            )}

            {on("upcoming") && (
              <SectionCard
                className={cn(!on("tasks") && "lg:col-span-5", on("tasks") && "lg:col-span-2")}
                title="Upcoming schedule"
                description="Next scheduled activities"
                icon={<CalendarClock className="size-4" aria-hidden="true" />}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/volunteers")} aria-label="View volunteer schedule">
                    View all <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                }
              >
                {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : upcoming.length === 0 ? (
                  <EmptyState
                    icon={<CalendarClock className="size-6" aria-hidden="true" />}
                    title="Nothing scheduled"
                    hint="Upcoming tasks and distributions will appear here."
                  />
                ) : (
                  <ul className="max-h-72 divide-y overflow-y-auto scrollbar-thin" aria-label="Upcoming schedule">
                    {upcoming.map((t, i) => {
                      const priority = pickStr(t, ["priority"], "MEDIUM");
                      const urgent = priority === "HIGH";
                      return (
                        <li key={pickStr(t, ["id"], String(i))} className="flex items-center gap-3 py-2.5">
                          <span
                            className={cn(
                              "flex size-9 shrink-0 items-center justify-center rounded-lg",
                              urgent
                                ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            )}
                            aria-hidden="true"
                          >
                            <CalendarClock className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{pickStr(t, ["title"], "Activity")}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {formatDateTime(pickStr(t, ["scheduledDate"]))} · {priority.toLowerCase()} priority
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </SectionCard>
            )}
          </div>
        </Fade>
      )}

      {/* Recent activity */}
      {on("activity") && (
        <Fade index={5}>
          <SectionCard
            title="Recent activity"
            description="Latest admin and system actions"
            icon={<Activity className="size-4" aria-hidden="true" />}
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate("/admin/activity")} aria-label="View all activity logs">
                View all <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            }
          >
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : activityRows.length === 0 ? (
              <EmptyState
                icon={<Activity className="size-6" aria-hidden="true" />}
                title="No activity recorded yet"
                hint="Admin actions, dispatches and settings changes appear here."
              />
            ) : (
              <ul className="max-h-72 divide-y overflow-y-auto scrollbar-thin" aria-label="Recent activity">
                {activityRows.map((a, i) => (
                  <li key={pickStr(a, ["id"], String(i))} className="flex items-center gap-3 py-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground" aria-hidden="true">
                      {initials(pickStr(a, ["actorName"], "System"))}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="font-medium">{pickStr(a, ["actorName"], "System")}</span>{" "}
                        <span className="text-muted-foreground">
                          {pickStr(a, ["action"], "ACTION").toLowerCase().replace(/_/g, " ")} ·{" "}
                          {titleCase(pickStr(a, ["entityType"], "")) || "system"}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{pickStr(a, ["details"], "")}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {timeAgo(pickStr(a, ["createdAt"]))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </Fade>
      )}

      {/* Quick actions */}
      {on("actions") && (
        <Fade index={6}>
          <SectionCard
            title="Quick actions"
            description="Jump straight into the most common admin tasks"
            icon={<PackageCheck className="size-4" aria-hidden="true" />}
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {QUICK_ACTIONS.map((qa) => {
                const Icon = qa.icon;
                return (
                  <button
                    key={qa.to}
                    onClick={() => navigate(qa.to)}
                    className="group flex min-h-20 flex-col items-start gap-2 rounded-xl border p-3 text-left transition hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${qa.label} — ${qa.hint}`}
                  >
                    <span className={cn("flex size-9 items-center justify-center rounded-lg", qa.accent)}>
                      <Icon className="size-4.5" aria-hidden="true" />
                    </span>
                    <span className="text-sm font-medium leading-tight">{qa.label}</span>
                    <span className="text-xs text-muted-foreground">{qa.hint}</span>
                  </button>
                );
              })}
            </div>
          </SectionCard>
        </Fade>
      )}
    </div>
  );
}
