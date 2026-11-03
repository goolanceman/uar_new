"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  Bell,
  CalendarHeart,
  CheckCheck,
  HandCoins,
  HeartHandshake,
  Landmark,
  PawPrint,
  ReceiptText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatINR, formatINRCompact, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  asArray,
  currentFyLabel,
  estimateDeduction,
  fyMonthBuckets,
  fyStartYear,
  fyTimestamps,
  is80gEligible,
  openReceipt,
} from "./portal-utils";

interface Donation {
  id: string;
  receiptNumber: string;
  amount: number;
  category: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  campaign?: { title: string } | null;
}

interface Pledge {
  id: string;
  amountPerMonth: number;
  status: string;
}

interface AnimalPledge {
  id: string;
  amount: number;
  frequency: string;
  status: string;
}

interface AppNotification {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

const QUICK_ACTIONS = [
  {
    key: "donate",
    title: "Donate",
    desc: "Support a campaign or the general fund",
    icon: HandCoins,
    to: "/donate",
  },
  {
    key: "causes",
    title: "Adopt a medicine",
    desc: "Fund monthly medicines from ₹100/mo",
    icon: HeartHandshake,
    to: "/donor/causes",
  },
  {
    key: "animals",
    title: "Sponsor an animal",
    desc: "Food, care & shelter at the UAR shelter",
    icon: PawPrint,
    to: "/donor/animals",
  },
  {
    key: "receipts",
    title: "Download receipts",
    desc: "80G tax receipts & certificates",
    icon: ReceiptText,
    to: "/donor/receipts",
  },
];

export default function DonorOverview({ user }: { user: SessionUser }) {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [animalPledges, setAnimalPledges] = useState<AnimalPledge[]>([]);
  const [pan, setPan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifLoading, setNotifLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const fy = fyStartYear();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [d, me, p, a] = await Promise.all([
        get<unknown>("/api/donations?mine=1"),
        get<{ user?: { pan?: string | null } | null }>("/api/auth/me").catch(() => null),
        get<unknown>("/api/causes/pledges?mine=1").catch(() => []),
        get<unknown>("/api/animals/pledges?mine=1").catch(() => []),
      ]);
      setDonations(asArray<Donation>(d));
      setPledges(asArray<Pledge>(p));
      setAnimalPledges(asArray<AnimalPledge>(a));
      setPan(me?.user?.pan ?? null);
    } catch (e) {
      setLoadFailed(true);
      toast.error(e instanceof Error ? e.message : "Could not load your dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const data = await get<unknown>("/api/notifications?limit=5");
      setNotifications(asArray<AppNotification>(data));
    } catch {
      setNotifications([]);
    } finally {
      setNotifLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const markRead = async (n: AppNotification) => {
    if (n.isRead) return;
    setMarkingId(n.id);
    try {
      await patch("/api/notifications", { id: n.id, isRead: true });
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark as read");
    } finally {
      setMarkingId(null);
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await patch("/api/notifications", { all: true });
      setNotifications((prev) => prev.map((x) => ({ ...x, isRead: true })));
      toast.success("All notifications marked read");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark all as read");
    } finally {
      setMarkingAll(false);
    }
  };

  /* ------------------------------ aggregates ------------------------------ */
  const completed = useMemo(() => donations.filter((d) => d.paymentStatus === "COMPLETED"), [donations]);
  const totalDonated = useMemo(() => completed.reduce((s, d) => s + (d.amount || 0), 0), [completed]);
  const { start: fyStart, end: fyEnd } = useMemo(() => fyTimestamps(fy), [fy]);
  const fyDonations = useMemo(
    () => donations.filter((d) => {
      const t = new Date(d.createdAt).getTime();
      return t >= fyStart && t <= fyEnd;
    }),
    [donations, fyStart, fyEnd]
  );
  const fyTotal = useMemo(
    () => fyDonations.filter((d) => d.paymentStatus === "COMPLETED").reduce((s, d) => s + (d.amount || 0), 0),
    [fyDonations]
  );
  const fyEligible = useMemo(() => fyDonations.filter(is80gEligible), [fyDonations]);
  const taxSaved = useMemo(() => estimateDeduction(fyDonations), [fyDonations]);
  const trend = useMemo(() => fyMonthBuckets(fy, donations), [fy, donations]);

  const activePledges = useMemo(() => pledges.filter((p) => p.status === "ACTIVE"), [pledges]);
  const monthlyPledges = activePledges.reduce((s, p) => s + (p.amountPerMonth || 0), 0);
  const activeAnimalPledges = animalPledges.filter((p) => p.status === "ACTIVE");
  const animalMonthly = activeAnimalPledges
    .filter((p) => p.frequency === "MONTHLY")
    .reduce((s, p) => s + (p.amount || 0), 0);

  const receiptsReady = completed.filter((d) => d.receiptNumber).length;
  const recent = donations.slice(0, 3);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  /* --------------------------- impact snapshot ---------------------------- */
  const byCategory = (cat: string) =>
    completed.filter((d) => d.category === cat).reduce((s, d) => s + (d.amount || 0), 0);
  const kits = Math.floor(byCategory("FOOD_DISTRIBUTION") / 500);
  const medDays = Math.floor(byCategory("MEDICAL") / 40);
  const animalMeals = Math.floor(byCategory("ANIMAL") / 60);
  const padPacks = Math.floor(byCategory("SANITARY_PADS") / 150);
  const impactBits: string[] = [];
  if (kits > 0) impactBits.push(`assembled ~${kits} ration kit${kits === 1 ? "" : "s"}`);
  if (medDays > 0) impactBits.push(`funded ~${medDays} day${medDays === 1 ? "" : "s"} of medicine`);
  if (animalMeals > 0) impactBits.push(`fed ~${animalMeals} meal${animalMeals === 1 ? "" : "s"} at the shelter`);
  if (padPacks > 0) impactBits.push(`sent ~${padPacks} pad pack${padPacks === 1 ? "" : "s"} to schools`);
  if (activePledges.length > 0)
    impactBits.push(`keep${activePledges.length === 1 ? "s" : ""} ${activePledges.length} patient${activePledges.length === 1 ? "" : "s"} on monthly medicines`);
  if (activeAnimalPledges.length > 0)
    impactBits.push(`sponsor${activeAnimalPledges.length === 1 ? "s" : ""} ${activeAnimalPledges.length} shelter friend${activeAnimalPledges.length === 1 ? "" : "s"}`);

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const chartHasData = trend.some((b) => b.amount > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greet}, ${user.name.split(" ")[0]} 🙏`}
        description="Thank you for powering United Angel Reach — every rupee reaches the ground."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 gap-1.5 sm:min-h-9"
            onClick={load}
            aria-label="Refresh dashboard"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {loadFailed && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400">
          Some data could not load — check your connection and refresh.
        </div>
      )}

      {/* ------------------------- FY giving hero ------------------------- */}
      <section
        aria-label="Giving summary"
        className="relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm sm:p-8"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-emerald-500/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 -left-10 size-56 rounded-full bg-teal-500/10 blur-3xl"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Total given · all time
            </p>
            {loading ? (
              <Skeleton className="h-12 w-56" />
            ) : (
              <p className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                {formatINR(totalDonated)}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {formatINR(fyTotal)} in {currentFyLabel()} across {completed.length} completed
              donation{completed.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            {pan ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                80G-ready · PAN {pan}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => navigate("/donor/profile")}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 outline-none transition hover:bg-amber-500/20 focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400 sm:min-h-0"
                aria-label="Add PAN in profile to make receipts 80G-ready"
              >
                <Landmark className="size-3.5" aria-hidden="true" />
                Add PAN for 80G-ready receipts →
              </button>
            )}
            <p className="text-xs text-muted-foreground sm:text-right">
              Estimated tax saving this FY:{" "}
              <span className="font-semibold text-primary">{formatINR(taxSaved)}</span>
              <br className="hidden sm:block" />
              (50% deduction u/s 80G, indicative)
            </p>
          </div>
        </div>

        {/* Giving trend — 12 monthly buckets */}
        <div className="relative mt-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Giving trend · {currentFyLabel()}
          </p>
          {loading ? (
            <Skeleton className="h-36 w-full rounded-xl" />
          ) : chartHasData ? (
            <div className="h-36 w-full" aria-label="Area chart of monthly giving this financial year">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="donorTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={(v: number) => formatINRCompact(v)}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--border)" }}
                    formatter={(v) => [formatINR(Number(v)), "Given"]}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      fontSize: 12,
                      color: "var(--card-foreground)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#donorTrendFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No completed gifts in {currentFyLabel()} yet — your trend line begins with the first one.
            </p>
          )}
        </div>
      </section>

      {/* --------------------------- stat strip --------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active pledges"
          value={String(activePledges.length)}
          hint={activePledges.length > 0 ? `${formatINR(monthlyPledges)}/mo medicine commitment` : "Adopt a patient's medicines"}
          icon={<HeartHandshake className="size-5" />}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="Animals sponsored"
          value={String(activeAnimalPledges.length)}
          hint={animalMonthly > 0 ? `${formatINR(animalMonthly)}/mo at the shelter` : "Meet the shelter friends"}
          icon={<PawPrint className="size-5" />}
          accent="lime"
          loading={loading}
        />
        <StatCard
          label="Est. tax saved"
          value={formatINR(taxSaved)}
          hint={`50% of ${formatINR(fyEligible.reduce((s, d) => s + d.amount, 0))} eligible`}
          icon={<Landmark className="size-5" />}
          accent="teal"
          loading={loading}
        />
        <StatCard
          label="Receipts ready"
          value={String(receiptsReady)}
          hint={currentFyLabel()}
          icon={<ReceiptText className="size-5" />}
          accent="emerald"
          loading={loading}
        />
      </div>

      {/* --------------------------- impact note -------------------------- */}
      <SectionCard
        title="Your impact snapshot"
        description="Warm maths from your completed donations and active pledges"
        icon={<Sparkles className="size-5" />}
      >
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : impactBits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Your impact story starts with your first donation — pick a quick action
            below and watch this space fill up.
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-foreground">
            Your giving{" "}
            {impactBits.map((bit, i) => (
              <span key={i}>
                {i > 0 && ", "}
                <span className="font-semibold text-primary">{bit}</span>
              </span>
            ))}
            . That is real ground impact across Karnataka — and soon, all of India.
          </p>
        )}
      </SectionCard>

      {/* --------------------------- quick actions ------------------------ */}
      <section aria-label="Quick actions">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick actions
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((q) => {
            const Icon = q.icon;
            return (
              <button
                key={q.key}
                type="button"
                onClick={() => navigate(q.to)}
                className="group flex min-h-11 flex-col gap-2 rounded-xl border bg-card p-4 text-left shadow-sm outline-none transition hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4.5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold">{q.title}</span>
                <span className="text-xs text-muted-foreground">{q.desc}</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-medium text-primary">
                  Go
                  <ArrowRight
                    className="size-3.5 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* -------------------------- recent donations ---------------------- */}
      <SectionCard
        title="Recent donations"
        description="Your latest contributions — open the 80G receipt for any completed gift"
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1 sm:min-h-9"
            onClick={() => navigate("/donor/donations")}
          >
            View all <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        }
      >
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={<HandCoins className="size-5" />}
            title="No donations yet"
            hint="Your first one takes under a minute."
          >
            <Button className="min-h-11" onClick={() => navigate("/donate")}>
              <HandCoins className="size-4" aria-hidden="true" />
              Make your first donation
            </Button>
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {recent.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {d.campaign?.title ?? "General fund"}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {d.receiptNumber} · {formatDate(d.createdAt)}
                  </p>
                </div>
                <p className="text-sm font-bold">{formatINR(d.amount)}</p>
                {d.paymentStatus === "COMPLETED" && d.receiptNumber && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 gap-1 sm:min-h-9"
                    onClick={() => openReceipt(d.receiptNumber)}
                    aria-label={`Open 80G receipt ${d.receiptNumber}`}
                  >
                    <ReceiptText className="size-4" aria-hidden="true" />
                    80G
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* --------------------------- notifications ------------------------ */}
      <SectionCard
        title="Notifications"
        description={`Receipts, pledges and platform updates${unreadCount > 0 ? ` · ${unreadCount} unread` : ""}`}
        icon={<Bell className="size-5" />}
        actions={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 gap-1 sm:min-h-9"
              onClick={loadNotifications}
              aria-label="Refresh notifications"
            >
              <Bell className="size-4" aria-hidden="true" />
              Refresh
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 gap-1 sm:min-h-9"
                onClick={markAllRead}
                disabled={markingAll}
                aria-label="Mark all notifications as read"
              >
                <CheckCheck className="size-4" aria-hidden="true" />
                Mark all read
              </Button>
            )}
          </div>
        }
      >
        {notifLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No notifications yet — we&apos;ll ping you here when receipts are ready or
            pledges update.
          </p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto pr-1 scrollbar-thin">
            {notifications.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    n.isRead ? "bg-muted-foreground/30" : "bg-emerald-500"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm", n.isRead ? "text-muted-foreground" : "font-medium")}>
                    {n.title}
                  </p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{formatDate(n.createdAt)}</p>
                </div>
                {!n.isRead && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 sm:min-h-9"
                    disabled={markingId === n.id}
                    onClick={() => markRead(n)}
                    aria-label={`Mark “${n.title}” as read`}
                  >
                    <CheckCheck className="size-4" aria-hidden="true" />
                    <span className="sr-only">Mark read</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <CalendarHeart className="size-3.5" aria-hidden="true" />
        Every completed gift earns an 80G receipt — see the Tax Centre for FY statements.
      </p>
    </div>
  );
}
