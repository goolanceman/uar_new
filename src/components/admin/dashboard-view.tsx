"use client";

import { useCallback, useEffect, useState } from "react";
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
  AlertTriangle,
  Ambulance,
  ArrowRight,
  BadgeCheck,
  HeartHandshake,
  IndianRupee,
  Info,
  PackageCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { cn, formatINR, formatNumber, timeAgo, titleCase } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/* ------------------------------ types & helpers ----------------------------- */

type Rec = Record<string, unknown>;

interface DonationRow {
  id: string;
  donorName: string;
  amount: number;
  paymentStatus: string;
  createdAt: string;
  campaignTitle?: string | null;
  campaign?: { title?: string } | null;
}

interface StatsResponse extends Rec {
  monthlyDonations?: Rec[];
  byCampaign?: Rec[];
  byRole?: Rec[];
  recentDonations?: Rec[];
}

function pickNum(o: Rec | null | undefined, keys: string[], fb = 0): number {
  if (!o) return fb;
  const sources: Rec[] = [o, (o.totals ?? {}) as Rec];
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
  const sources: Rec[] = [o, (o.totals ?? {}) as Rec];
  for (const src of sources) {
    for (const k of keys) {
      const v = src[k];
      if (typeof v === "string" && v) return v;
    }
  }
  return fb;
}

function asArray(v: unknown): Rec[] {
  if (Array.isArray(v)) return v as Rec[];
  if (v && typeof v === "object") {
    const o = v as Rec;
    if (Array.isArray(o.items)) return o.items as Rec[];
    if (Array.isArray(o.data)) return o.data as Rec[];
  }
  return [];
}

const CHART_COLORS = ["#10b981", "#f59e0b", "#ec4899", "#14b8a6", "#f97316", "#84cc16", "#ef4444", "#06b6d4", "#a855f7"];

function statusBadgeClass(status: string): string {
  switch (status) {
    case "COMPLETED":
    case "ACTIVE":
      return "bg-emerald-100 text-emerald-700";
    case "PENDING":
      return "bg-amber-100 text-amber-700";
    case "FAILED":
    case "REFUNDED":
    case "REJECTED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

/* --------------------------------- KPI card -------------------------------- */

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">{value}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>
        </div>
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tone)}>
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
      </div>
    </Card>
  );
}

/* ---------------------------------- view ----------------------------------- */

export default function DashboardView() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [lowStockCount, setLowStockCount] = useState<number | null>(null);
  const [pendingApps, setPendingApps] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, low, apps] = await Promise.all([
        get<StatsResponse>("/api/stats"),
        get<unknown>("/api/inventory?low=1").catch(() => [] as unknown),
        get<unknown>("/api/volunteer-applications?status=PENDING").catch(() => [] as unknown),
      ]);
      setStats(s ?? {});
      setLowStockCount(asArray(low).length);
      setPendingApps(asArray(apps).length);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load dashboard stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rec = stats as Rec | null;
  const raised = pickNum(rec, ["totalRaised", "raised", "totalDonationsAmount"]);
  const donationsCount = pickNum(rec, ["donationsCount", "totalDonations", "donations"]);
  const beneficiaries = pickNum(rec, ["beneficiaries", "beneficiariesCount"]);
  const volunteers = pickNum(rec, ["volunteers", "volunteersCount"]);
  const kitsScanned = pickNum(rec, ["kitsScanned", "scannedUnits"]);
  const kitsTotal = pickNum(rec, ["kitsTotal", "kitsUnits", "totalUnits"]);
  const corridorMinDirect = pickNum(rec, ["corridorTimeSavedMin", "timeSavedMin"]);
  const corridorSec = pickNum(rec, ["corridorTimeSavedSec", "timeSavedSec", "corridorTimeSaved"]);
  const corridorMin = corridorMinDirect || Math.round(corridorSec / 60);

  const monthly = asArray(stats?.monthly ?? stats?.monthlyDonations).map((m) => ({
    month: pickStr(m, ["month", "label", "name"], "—"),
    amount: pickNum(m, ["amount", "value", "donations", "total"]),
  }));

  const byCampaign = asArray(stats?.byCampaign)
    .map((c) => ({
      name: pickStr(c, ["name", "title", "campaign"]),
      raised: pickNum(c, ["raised", "amount", "value", "raisedAmount"]),
    }))
    .filter((c) => c.name)
    .slice(0, 7);

  const byRole = asArray(stats?.byRole)
    .map((r) => ({
      name: pickStr(r, ["name", "role", "label"], "Other"),
      value: pickNum(r, ["value", "count", "users"]),
    }))
    .filter((r) => r.value > 0);

  const recentDonations: DonationRow[] = asArray(stats?.recentDonations)
    .slice(0, 8)
    .map((d, i) => ({
      id: pickStr(d, ["id"], `d-${i}`),
      donorName: pickStr(d, ["donorName", "name"], "Anonymous"),
      amount: pickNum(d, ["amount"]),
      paymentStatus: pickStr(d, ["paymentStatus", "status"], "PENDING"),
      createdAt: pickStr(d, ["createdAt", "date"]),
      campaignTitle: pickStr(d, ["campaignTitle"]) || (typeof d.campaign === "object" && d.campaign ? pickStr(d.campaign as Rec, ["title"]) : ""),
    }));

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <Kpi icon={IndianRupee} label="Total Raised" value={formatINR(raised)} sub={`${formatNumber(donationsCount)} donations`} tone="bg-emerald-100 text-emerald-700" />
            <Kpi icon={TrendingUp} label="Donations" value={formatNumber(donationsCount)} sub="all time" tone="bg-teal-100 text-teal-700" />
            <Kpi icon={HeartHandshake} label="Beneficiaries" value={formatNumber(beneficiaries)} sub="people supported" tone="bg-fuchsia-100 text-fuchsia-700" />
            <Kpi icon={Users} label="Volunteers" value={formatNumber(volunteers)} sub="onboarded" tone="bg-amber-100 text-amber-700" />
            <Kpi icon={PackageCheck} label="Kits Scanned" value={`${formatNumber(kitsScanned)} / ${formatNumber(kitsTotal)}`} sub="scanned / total" tone="bg-lime-100 text-lime-700" />
            <Kpi icon={Ambulance} label="Corridor Time Saved" value={`${formatNumber(corridorMin)} min`} sub="green corridor" tone="bg-red-100 text-red-700" />
          </>
        )}
      </div>

      {/* Action callouts */}
      {!loading && (
        <div className="grid gap-4 md:grid-cols-2">
          <Alert
            className={cn(
              "flex-row items-center gap-3",
              (lowStockCount ?? 0) > 0 ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"
            )}
          >
            {(lowStockCount ?? 0) > 0 ? (
              <AlertTriangle className="size-5 shrink-0 text-amber-600" aria-hidden="true" />
            ) : (
              <Info className="size-5 shrink-0 text-emerald-600" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <AlertTitle className="text-sm font-semibold">
                {(lowStockCount ?? 0) > 0 ? `${lowStockCount} item${(lowStockCount ?? 0) === 1 ? "" : "s"} below minimum stock` : "Inventory levels healthy"}
              </AlertTitle>
              <AlertDescription className="text-xs">
                {(lowStockCount ?? 0) > 0 ? "Ration kits and distribution depend on these items." : "All items are at or above their minimum stock levels."}
              </AlertDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-amber-300 bg-white/60 hover:bg-amber-100"
              onClick={() => navigate("/admin/inventory")}
            >
              Open inventory <ArrowRight className="size-3.5" />
            </Button>
          </Alert>

          <Alert
            className={cn(
              "flex-row items-center gap-3",
              (pendingApps ?? 0) > 0 ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"
            )}
          >
            {(pendingApps ?? 0) > 0 ? (
              <BadgeCheck className="size-5 shrink-0 text-amber-600" aria-hidden="true" />
            ) : (
              <BadgeCheck className="size-5 shrink-0 text-emerald-600" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <AlertTitle className="text-sm font-semibold">
                {(pendingApps ?? 0) > 0 ? `${pendingApps} volunteer application${(pendingApps ?? 0) === 1 ? "" : "s"} awaiting review` : "No pending volunteer applications"}
              </AlertTitle>
              <AlertDescription className="text-xs">
                {(pendingApps ?? 0) > 0 ? "Applicants are waiting for portal access." : "Every applicant has been reviewed."}
              </AlertDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-amber-300 bg-white/60 hover:bg-amber-100"
              onClick={() => navigate("/admin/volunteers")}
            >
              Review <ArrowRight className="size-3.5" />
            </Button>
          </Alert>
        </div>
      )}

      {/* Monthly donations area chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Monthly donations</CardTitle>
          <CardDescription>Funds raised per month across all campaigns</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-56 w-full" />
          ) : monthly.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">No donation data yet</div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="donationFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatINR(v)} width={56} />
                  <Tooltip formatter={(v) => [formatINR(Number(v)), "Raised"]} />
                  <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2} fill="url(#donationFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaign bar + role pie */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Raised by campaign</CardTitle>
            <CardDescription>Top campaigns by funds raised</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-56 w-full" />
            ) : byCampaign.length === 0 ? (
              <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">No campaign data yet</div>
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byCampaign} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)}
                    />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatINR(v)} width={56} />
                    <Tooltip formatter={(v) => [formatINR(Number(v)), "Raised"]} />
                    <Bar dataKey="raised" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={42} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Users by role</CardTitle>
            <CardDescription>Community composition</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-56 w-full" />
            ) : byRole.length === 0 ? (
              <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">No user data yet</div>
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byRole} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                      {byRole.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, name) => [formatNumber(Number(v)), titleCase(String(name))]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1">
                  {byRole.map((r, i) => (
                    <span key={r.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="size-2 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden="true" />
                      {titleCase(r.name)} · {formatNumber(r.value)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent donations */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent donations</CardTitle>
          <CardDescription>Latest contributions received</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : recentDonations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 py-8 text-sm text-muted-foreground">
              <IndianRupee className="size-6" aria-hidden="true" />
              No donations recorded yet
            </div>
          ) : (
            <ul className="max-h-96 divide-y overflow-y-auto scrollbar-thin" aria-label="Recent donations">
              {recentDonations.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
                    {d.donorName.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.donorName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {d.campaignTitle || "General donation"} · {timeAgo(d.createdAt)}
                    </p>
                  </div>
                  <span className={cn("hidden rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline", statusBadgeClass(d.paymentStatus))}>
                    {titleCase(d.paymentStatus)}
                  </span>
                  <span className="shrink-0 text-sm font-semibold">{formatINR(d.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
