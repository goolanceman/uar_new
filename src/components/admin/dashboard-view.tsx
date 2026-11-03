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
  Ambulance,
  ArrowRight,
  BadgeCheck,
  ClipboardList,
  HandCoins,
  HeartHandshake,
  Inbox,
  LayoutDashboard,
  PackageCheck,
  RefreshCw,
  ReceiptText,
  Sprout,
  TrendingUp,
  UserRoundPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";
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

/* ------------------------------ types & helpers ----------------------------- */

type Rec = Record<string, unknown>;

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

const DONUT_COLORS = [
  "#10b981", "#f59e0b", "#ec4899", "#14b8a6", "#f97316",
  "#84cc16", "#ef4444", "#06b6d4", "#d946ef",
];

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
  const [stats, setStats] = useState<Rec | null>(null);
  const [reports, setReports] = useState<Rec | null>(null);
  const [lowStock, setLowStock] = useState<Rec[]>([]);
  const [pendingApps, setPendingApps] = useState<Rec[]>([]);
  const [pendingQueries, setPendingQueries] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, r, apps, inv, queries] = await Promise.all([
        get<Rec>("/api/stats"),
        get<Rec>("/api/reports").catch(() => null),
        get<unknown>("/api/volunteer-applications?status=PENDING").catch(() => [] as unknown),
        get<unknown>("/api/inventory?limit=100").catch(() => [] as unknown),
        get<unknown>("/api/contact-queries?status=PENDING").catch(() => [] as unknown),
      ]);
      setStats(s ?? {});
      setReports(r);
      setPendingApps(asArray(apps));
      setLowStock(asArray(inv).filter((i) => Number(i.quantity ?? 0) <= Number(i.minStock ?? 0)));
      setPendingQueries(asArray(queries));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* --------------------------------- KPIs --------------------------------- */

  const totals = (stats?.totals ?? {}) as Rec;
  const kpis = (reports?.kpis ?? {}) as Rec;
  const raisedFY = pickNum(reports, ["totalDonations"]) || pickNum(stats, ["raised"], 0);
  const donationCount =
    pickNum(reports, ["donationCount"]) || pickNum(stats, ["donations"], 0);
  const activeCampaigns = pickNum(stats, ["campaigns"]);
  const beneficiaries = pickNum(stats, ["beneficiaries"]);
  const pendingCount = pendingApps.length;

  /* -------------------------------- charts -------------------------------- */

  const trend = useMemo(() => {
    const rMonthly = asArray(reports?.monthly);
    if (rMonthly.length > 0) {
      return rMonthly.map((m) => ({
        month: pickStr(m, ["month", "label", "name"], "—"),
        amount: pickNum(m, ["amount", "value", "total"], 0),
      }));
    }
    return asArray(stats?.monthly).map((m) => ({
      month: pickStr(m, ["month", "label", "name"], "—"),
      amount: pickNum(m, ["amount", "value"], 0),
    }));
  }, [reports, stats]);

  const categories = useMemo(() => {
    const rCats = asArray(reports?.categories);
    if (rCats.length > 0) {
      return rCats
        .map((c) => ({
          name: titleCase(pickStr(c, ["category", "name", "type"], "Other")),
          value: pickNum(c, ["amount", "value", "count"], 0),
        }))
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value);
    }
    return [];
  }, [reports]);

  const donut = categories.length > 0 ? categories : [];
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
  if (pendingCount > 0) {
    const first = pendingApps.slice(0, 3).map((a) => pickStr(a, ["fullName", "name"], "Applicant"));
    attention.push({
      key: "volunteers",
      icon: <BadgeCheck className="size-4" aria-hidden="true" />,
      tone: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
      title: `${pendingCount} volunteer application${pendingCount === 1 ? "" : "s"} awaiting review`,
      detail: first.join(" · ") + (pendingCount > 3 ? ` +${pendingCount - 3} more` : ""),
      action: "Review",
      to: "/admin/volunteers",
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

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Trust operations at a glance · ${fy} · Bengaluru → India`}
        icon={<LayoutDashboard className="size-5" aria-hidden="true" />}
        actions={
          <Button variant="outline" onClick={load} disabled={refreshing} aria-label="Refresh dashboard data">
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 sm:gap-4">
        <StatCard
          label="Funds raised"
          value={formatINRCompact(raisedFY)}
          icon={<TrendingUp className="size-5" aria-hidden="true" />}
          accent="emerald"
          hint={`${fy} · completed gifts`}
          loading={loading}
        />
        <StatCard
          label="Donations"
          value={donationCount.toLocaleString("en-IN")}
          icon={<ReceiptText className="size-5" aria-hidden="true" />}
          accent="teal"
          hint="all-time completed"
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
          label="Volunteers pending"
          value={pendingCount.toLocaleString("en-IN")}
          icon={<Users className="size-5" aria-hidden="true" />}
          accent="amber"
          hint="applications to approve"
          loading={loading}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard
          className="lg:col-span-3"
          title="Giving trend"
          description="Funds raised per month"
          icon={<TrendingUp className="size-4" aria-hidden="true" />}
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
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
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
                  <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2} fill="url(#dashTrendFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard
          className="lg:col-span-2"
          title="Giving by category"
          description={`${fy} donation mix`}
          icon={<HandCoins className="size-4" aria-hidden="true" />}
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
                        <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
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
                      style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }}
                      aria-hidden="true"
                    />
                    {c.name} · {formatINRCompact(c.value)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Needs attention + latest donations */}
      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard
          className="lg:col-span-3"
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

        <SectionCard
          className="lg:col-span-2"
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
      </div>

      {/* Quick actions */}
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
    </div>
  );
}
