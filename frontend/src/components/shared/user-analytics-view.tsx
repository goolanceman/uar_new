"use client";

/**
 * UserAnalyticsView — the universal "My analytics" page for EVERY role.
 *
 * Data: GET /api/profile/analytics (session-scoped, role-aware aggregate).
 *   ADMIN       → KPIs + entityBreakdown donut + recent actions list
 *   DONOR       → giving KPIs + monthlyTrend area + categories split + recent gifts
 *   VOLUNTEER   → service KPIs + tasksByType bar + upcoming tasks + recent tasks
 *   BENEFICIARY → request KPIs + status donut + recent requests
 *
 * Every role gets loading skeletons and graceful empty states. Used from the
 * admin dropdown ("My analytics") and from all three portals.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
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
  CalendarClock,
  ClipboardList,
  HandCoins,
  HandHeart,
  Inbox,
  MapPin,
  ReceiptText,
  Sprout,
  Target,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import { cn, timeAgo } from "@/lib/utils";
import {
  formatINR,
  formatINRCompact,
  formatDateTime,
  titleCase,
} from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";

/* --------------------------------- types ---------------------------------- */

type Analytics = Record<string, unknown> & { role?: string; generatedAt?: string };

/* ------------------------------ chart palette ----------------------------- */

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#f97316",
  "#ec4899",
  "#14b8a6",
];

function asArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}
function asNum(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function asStr(v: unknown, fb = ""): string {
  return typeof v === "string" && v ? v : fb;
}

/* ---------------------------------- view ---------------------------------- */

export function UserAnalyticsView(_props: { user?: { name?: string } | null }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<Analytics>("/api/profile/analytics");
      setData(res ?? {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load your analytics");
      setData({ role: undefined });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const role = asStr(data?.role, "DONOR").toUpperCase();

  /* ------------------------------- headings ------------------------------- */

  const copy: Record<string, { title: string; description: string }> = {
    ADMIN: {
      title: "My analytics",
      description: "Your console footprint — logged actions by module and the latest audit entries.",
    },
    DONOR: {
      title: "My analytics",
      description: "Your giving journey — totals, monthly trend, campaign reach and receipts.",
    },
    VOLUNTEER: {
      title: "My analytics",
      description: "Your service record — tasks, completion rate, hours and what's coming up.",
    },
    BENEFICIARY: {
      title: "My analytics",
      description: "Your help requests — statuses and the latest updates on your case.",
    },
  };
  const head = copy[role] ?? copy.DONOR;

  /* --------------------------------- charts ------------------------------- */

  const trend = useMemo(
    () => asArray(data?.monthlyTrend).map((m) => ({ month: asStr(m.month), amount: asNum(m.amount) })),
    [data]
  );
  const categories = useMemo(
    () =>
      asArray(data?.categoriesSplit)
        .map((c) => ({ name: titleCase(asStr(c.category, "General")), amount: asNum(c.amount) }))
        .filter((c) => c.amount > 0),
    [data]
  );
  const tasksByType = useMemo(
    () => asArray(data?.tasksByType).map((t) => ({ name: titleCase(asStr(t.type)), count: asNum(t.count) })),
    [data]
  );
  const entityBreakdown = useMemo(
    () =>
      asArray(data?.entityBreakdown).map((e) => ({
        name: titleCase(asStr(e.entityType, "System")),
        count: asNum(e.count),
      })),
    [data]
  );
  const requestsByStatus = useMemo(
    () => asArray(data?.requestsByStatus).map((s) => ({ name: titleCase(asStr(s.status)), count: asNum(s.count) })),
    [data]
  );

  const donut = role === "ADMIN" ? entityBreakdown : role === "BENEFICIARY" ? requestsByStatus : [];
  const donutKey = role === "ADMIN" ? "entityBreakdown" : "requestsByStatus";

  /* --------------------------------- render ------------------------------- */

  const kpisLoading = loading;

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title={head.title}
        description={head.description}
        icon={<TrendingUp className="size-5" aria-hidden="true" />}
      />

      {/* ---------------------------- KPI stat cards --------------------------- */}
      {role === "ADMIN" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Logged actions"
            value={asNum(data?.actionsCount)}
            icon={<Activity className="size-5" aria-hidden="true" />}
            accent="emerald"
            loading={kpisLoading}
            hint="Audit entries attributed to you"
          />
          <StatCard
            label="Modules touched"
            value={entityBreakdown.length}
            icon={<Target className="size-5" aria-hidden="true" />}
            accent="teal"
            loading={kpisLoading}
            hint="Distinct entity types"
          />
          <StatCard
            label="Busiest module"
            value={entityBreakdown[0]?.name ?? "—"}
            icon={<Inbox className="size-5" aria-hidden="true" />}
            accent="orange"
            loading={kpisLoading}
            hint={entityBreakdown[0] ? `${entityBreakdown[0].count} actions` : "No activity yet"}
          />
          <StatCard
            label="Last action"
            value={asArray(data?.recentActions)[0] ? timeAgo(asStr(asArray(data?.recentActions)[0].createdAt)) : "—"}
            icon={<CalendarClock className="size-5" aria-hidden="true" />}
            accent="amber"
            loading={kpisLoading}
          />
        </div>
      )}

      {role === "DONOR" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total donated"
            value={formatINR(asNum(data?.totalDonated))}
            icon={<HandCoins className="size-5" aria-hidden="true" />}
            accent="emerald"
            loading={kpisLoading}
            hint="Completed gifts only"
          />
          <StatCard
            label="Donations"
            value={asNum(data?.donationCount)}
            icon={<TrendingUp className="size-5" aria-hidden="true" />}
            accent="teal"
            loading={kpisLoading}
            hint={
              data?.firstDonationAt
                ? `Since ${formatDateTime(asStr(data?.firstDonationAt))}`
                : "No gifts yet"
            }
          />
          <StatCard
            label="80G receipts"
            value={asNum(data?.receiptsCount)}
            icon={<ReceiptText className="size-5" aria-hidden="true" />}
            accent="orange"
            loading={kpisLoading}
            hint="Downloadable from Receipts"
          />
          <StatCard
            label="Campaigns supported"
            value={asNum(data?.campaignsSupported)}
            icon={<Sprout className="size-5" aria-hidden="true" />}
            accent="lime"
            loading={kpisLoading}
            hint={
              data?.lastDonationAt
                ? `Last gift ${timeAgo(asStr(data?.lastDonationAt))}`
                : undefined
            }
          />
        </div>
      )}

      {role === "VOLUNTEER" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Tasks assigned"
            value={asNum(data?.tasksAssigned)}
            icon={<ClipboardList className="size-5" aria-hidden="true" />}
            accent="teal"
            loading={kpisLoading}
            hint="Excludes cancelled"
          />
          <StatCard
            label="Tasks completed"
            value={asNum(data?.tasksCompleted)}
            icon={<Inbox className="size-5" aria-hidden="true" />}
            accent="emerald"
            loading={kpisLoading}
          />
          <StatCard
            label="Completion rate"
            value={`${asNum(data?.completionRate)}%`}
            icon={<Target className="size-5" aria-hidden="true" />}
            accent="lime"
            loading={kpisLoading}
          />
          <StatCard
            label="Hours logged"
            value={asNum(data?.hoursLogged)}
            icon={<CalendarClock className="size-5" aria-hidden="true" />}
            accent="orange"
            loading={kpisLoading}
            hint={`${asNum(data?.attendanceDays)} attendance days`}
          />
        </div>
      )}

      {role === "BENEFICIARY" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Help requests"
            value={asNum(data?.totalRequests)}
            icon={<HandHeart className="size-5" aria-hidden="true" />}
            accent="pink"
            loading={kpisLoading}
            hint="Submitted by or for you"
          />
          <StatCard
            label="Fulfilled"
            value={requestsByStatus.find((s) => s.name === "Fulfilled")?.count ?? 0}
            icon={<Inbox className="size-5" aria-hidden="true" />}
            accent="emerald"
            loading={kpisLoading}
          />
          <StatCard
            label="In review"
            value={
              (requestsByStatus.find((s) => s.name === "Pending")?.count ?? 0) +
              (requestsByStatus.find((s) => s.name === "In Review")?.count ?? 0)
            }
            icon={<CalendarClock className="size-5" aria-hidden="true" />}
            accent="amber"
            loading={kpisLoading}
          />
          <StatCard
            label="Case status"
            value={asStr(data?.caseStatus) ? titleCase(asStr(data?.caseStatus)) : "No case yet"}
            icon={<HandHeart className="size-5" aria-hidden="true" />}
            accent="teal"
            loading={kpisLoading}
          />
        </div>
      )}

      {/* -------------------------------- charts ------------------------------ */}
      <div className={cn("grid gap-4", role === "DONOR" && categories.length > 0 ? "lg:grid-cols-3" : "grid-cols-1")}>
        {/* Donor monthly trend */}
        {role === "DONOR" && (
          <SectionCard
            className={categories.length > 0 ? "lg:col-span-2" : undefined}
            title="Monthly giving"
            description="Completed donations over the last 6 months"
            icon={<TrendingUp className="size-4" aria-hidden="true" />}
          >
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : trend.every((m) => m.amount === 0) ? (
              <EmptyState
                icon={<HandCoins className="size-6" aria-hidden="true" />}
                title="No giving activity yet"
                hint="Your monthly giving trend will appear after your first donation."
              />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="uaTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
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
                    <Tooltip formatter={(v) => [formatINR(Number(v)), "Given"]} />
                    <Area
                      type="monotone"
                      dataKey="amount"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      fill="url(#uaTrendFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>
        )}

        {/* Donor categories donut */}
        {role === "DONOR" && categories.length > 0 && (
          <SectionCard
            title="By category"
            description="Where your gifts go"
            icon={<Sprout className="size-4" aria-hidden="true" />}
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categories}
                    dataKey="amount"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {categories.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatINR(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Category legend">
              {categories.slice(0, 6).map((c, i) => (
                <li key={c.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full"
                    style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  {c.name}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {/* Volunteer tasks by type */}
        {role === "VOLUNTEER" && (
          <SectionCard
            title="Tasks by type"
            description="Distribution drives, kit scans, rescues and more"
            icon={<ClipboardList className="size-4" aria-hidden="true" />}
          >
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : tasksByType.length === 0 ? (
              <EmptyState
                icon={<ClipboardList className="size-6" aria-hidden="true" />}
                title="No tasks yet"
                hint="Assigned tasks will chart here once the field team schedules you."
              />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tasksByType} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-18}
                      height={44}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                    />
                    <Tooltip formatter={(v) => [`${v} tasks`, "Count"]} />
                    <Bar dataKey="count" fill="var(--chart-1)" radius={[6, 6, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>
        )}

        {/* Admin / beneficiary donut */}
        {donut.length > 0 && (
          <SectionCard
            title={role === "ADMIN" ? "Actions by module" : "Requests by status"}
            description={role === "ADMIN" ? "Your audit footprint across the console" : "Where your requests stand"}
            icon={role === "ADMIN" ? <Activity className="size-4" aria-hidden="true" /> : <HandHeart className="size-4" aria-hidden="true" />}
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donut}
                    dataKey="count"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {donut.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [`${v}`, "Count"]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5" aria-label={`${donutKey} legend`}>
              {donut.slice(0, 6).map((c, i) => (
                <li key={c.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full"
                    style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  {c.name} · {c.count}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>

      {/* ---------------------- role-specific record lists --------------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Upcoming tasks (volunteer) */}
        {role === "VOLUNTEER" && (
          <SectionCard
            title="Upcoming schedule"
            description="Your next five assignments"
            icon={<CalendarClock className="size-4" aria-hidden="true" />}
          >
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : asArray(data?.upcomingTasks).length === 0 ? (
              <EmptyState
                icon={<CalendarClock className="size-6" aria-hidden="true" />}
                title="Nothing scheduled"
                hint="New assignments appear here as soon as the coordinator schedules them."
              />
            ) : (
              <ul className="flex max-h-72 flex-col divide-y overflow-y-auto scrollbar-thin" aria-label="Upcoming tasks">
                {asArray(data?.upcomingTasks).map((t) => (
                  <li key={asStr(t.id)} className="flex items-center gap-3 py-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400" aria-hidden="true">
                      <ClipboardList className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{asStr(t.title, "Untitled task")}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" aria-hidden="true" />
                        {asStr(t.location) || "Location TBA"} · {formatDateTime(asStr(t.scheduledDate))}
                      </p>
                    </div>
                    <StatusBadge status={asStr(t.priority, "MEDIUM")} tone="neutral" className="hidden sm:inline-flex" />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}

        {/* Recent activity list */}
        <SectionCard
          title={
            role === "ADMIN"
              ? "Recent actions"
              : role === "DONOR"
                ? "Recent donations"
                : role === "VOLUNTEER"
                  ? "Recent tasks"
                  : "Recent requests"
          }
          description={
            role === "ADMIN"
              ? "Latest audit entries attributed to your account"
              : role === "DONOR"
                ? "Your most recent gifts"
                : role === "VOLUNTEER"
                  ? "Your latest assignments"
                  : "Latest updates on your requests"
          }
          icon={<Activity className="size-4" aria-hidden="true" />}
        >
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <RecentList role={role} data={data} />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/* ------------------------------- recent list ------------------------------ */

function RecentList({ role, data }: { role: string; data: Analytics | null }) {
  const items = asArray(
    role === "ADMIN"
      ? data?.recentActions
      : role === "DONOR"
        ? data?.recentDonations
        : role === "VOLUNTEER"
          ? data?.recentTasks
          : data?.recentRequests
  );

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="size-6" aria-hidden="true" />}
        title="Nothing here yet"
        hint={
          role === "DONOR"
            ? "Your donations will appear here after your first gift."
            : role === "VOLUNTEER"
              ? "Assigned tasks will appear here."
              : role === "BENEFICIARY"
                ? "Submit a request from the help centre to see it here."
                : "Console actions you take will be listed here."
        }
      />
    );
  }

  return (
    <ul className="flex max-h-80 flex-col divide-y overflow-y-auto scrollbar-thin" aria-label="Recent activity">
      {items.map((item, idx) => {
        const key = asStr(item.id) || `${idx}`;
        if (role === "ADMIN") {
          return (
            <li key={key} className="flex items-center gap-3 py-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
                <Activity className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{titleCase(asStr(item.action, "ACTION"))}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {titleCase(asStr(item.entityType))}
                  {asStr(item.details) ? ` · ${asStr(item.details)}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(asStr(item.createdAt))}</span>
            </li>
          );
        }
        if (role === "DONOR") {
          return (
            <li key={key} className="flex items-center gap-3 py-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" aria-hidden="true">
                <HandCoins className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {formatINR(asNum(item.amount))} · {titleCase(asStr(item.category, "General"))}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {asStr(item.campaignTitle) || "General fund"} · {asStr(item.receiptNumber, "—")}
                </p>
              </div>
              <StatusBadge status={asStr(item.paymentStatus, "COMPLETED")} className="shrink-0" />
            </li>
          );
        }
        if (role === "VOLUNTEER") {
          return (
            <li key={key} className="flex items-center gap-3 py-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400" aria-hidden="true">
                <ClipboardList className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{asStr(item.title, "Untitled task")}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {titleCase(asStr(item.type))} · {formatDateTime(asStr(item.scheduledDate))}
                </p>
              </div>
              <StatusBadge status={asStr(item.status, "ASSIGNED")} className="shrink-0" />
            </li>
          );
        }
        return (
          <li key={key} className="flex items-center gap-3 py-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-pink-500/10 text-pink-600 dark:text-pink-400" aria-hidden="true">
              <HandHeart className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{titleCase(asStr(item.category, "Request"))}</p>
              <p className="truncate text-xs text-muted-foreground">
                {asStr(item.details).slice(0, 64) || "—"} · {formatDateTime(asStr(item.createdAt))}
              </p>
            </div>
            <StatusBadge status={asStr(item.status, "PENDING")} className="shrink-0" />
          </li>
        );
      })}
    </ul>
  );
}

export default UserAnalyticsView;
