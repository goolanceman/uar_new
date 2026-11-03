"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Bell,
  CalendarHeart,
  CheckCheck,
  HandCoins,
  HeartHandshake,
  PawPrint,
  ReceiptText,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { financialYear, formatINR, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface Donation {
  id: string;
  receiptNumber: string;
  amount: number;
  category: string;
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
  status: string;
}

interface AppNotification {
  id: string;
  title: string;
  message: string;
  type?: string;
  isRead: boolean;
  createdAt: string;
  actionUrl?: string | null;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  if (data && typeof data === "object" && Array.isArray((data as { notifications?: unknown }).notifications))
    return (data as { notifications: T[] }).notifications;
  return [];
}

/** Current FY window (Apr → Mar) as timestamps. */
function fyWindow(d = new Date()): { start: number; end: number } {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return {
    start: new Date(y, 3, 1).getTime(),
    end: new Date(y + 1, 2, 31, 23, 59, 59).getTime(),
  };
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
    title: "Adopt a patient",
    desc: "Fund monthly medicines from ₹100/mo",
    icon: HeartHandshake,
    to: "/donor/causes",
  },
  {
    key: "animals",
    title: "Sponsor an animal",
    desc: "Food, care & shelter at our shelter",
    icon: PawPrint,
    to: "/donor/animals",
  },
  {
    key: "receipts",
    title: "View receipts",
    desc: "80G tax receipts & certificates",
    icon: ReceiptText,
    to: "/donor/receipts",
  },
];

export default function DonorOverview({ user }: { user: SessionUser }) {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [animalPledges, setAnimalPledges] = useState<AnimalPledge[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifLoading, setNotifLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [d, p, a] = await Promise.all([
          get<unknown>("/api/donations?mine=1"),
          get<unknown>("/api/causes/pledges?mine=1").catch(() => []),
          get<unknown>("/api/animals/pledges?mine=1").catch(() => []),
        ]);
        if (!alive) return;
        setDonations(asArray<Donation>(d));
        setPledges(asArray<Pledge>(p));
        setAnimalPledges(asArray<AnimalPledge>(a));
      } catch {
        // individual views surface detailed errors
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const data = await get<unknown>("/api/notifications?limit=3");
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
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x))
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark as read");
    } finally {
      setMarkingId(null);
    }
  };

  /* ------------------------------ aggregates ------------------------------ */
  const completed = donations.filter((d) => d.paymentStatus === "COMPLETED");
  const totalDonated = completed.reduce((s, d) => s + (d.amount || 0), 0);
  const fy = fyWindow();
  const fyTotal = completed
    .filter((d) => {
      const t = new Date(d.createdAt).getTime();
      return t >= fy.start && t <= fy.end;
    })
    .reduce((s, d) => s + (d.amount || 0), 0);
  const activePledges = pledges.filter((p) => p.status === "ACTIVE");
  const monthlyPledges = activePledges.reduce((s, p) => s + (p.amountPerMonth || 0), 0);
  const activeAnimalPledges = animalPledges.filter((p) => p.status === "ACTIVE").length;

  /* --------------------------- impact snapshot ---------------------------- */
  const byCategory = (cat: string) =>
    completed.filter((d) => d.category === cat).reduce((s, d) => s + (d.amount || 0), 0);
  const kits = Math.floor(byCategory("FOOD_DISTRIBUTION") / 500);
  const vehicles = Math.floor(
    (byCategory("EMERGENCY") + byCategory("SAFETY") + byCategory("MOBILITY")) / 120
  );
  const medDays = Math.floor(byCategory("MEDICAL") / 40);
  const animalMeals = Math.floor(byCategory("ANIMAL") / 60);
  const padPacks = Math.floor(byCategory("SANITARY_PADS") / 150);
  const impactBits: string[] = [];
  if (kits > 0) impactBits.push(`assembled ~${kits} ration kit${kits === 1 ? "" : "s"}`);
  if (vehicles > 0) impactBits.push(`alerted ~${vehicles} vehicle${vehicles === 1 ? "" : "s"} along the green corridor`);
  if (medDays > 0) impactBits.push(`funded ~${medDays} day${medDays === 1 ? "" : "s"} of medicine`);
  if (padPacks > 0) impactBits.push(`sent ~${padPacks} pad pack${padPacks === 1 ? "" : "s"} to schools`);
  if (animalMeals > 0) impactBits.push(`fed ~${animalMeals} meal${animalMeals === 1 ? "" : "s"} at the shelter`);
  if (activePledges.length > 0)
    impactBits.push(
      `keep ${activePledges.length} patient${activePledges.length === 1 ? "" : "s"} on monthly medicines`
    );
  if (activeAnimalPledges > 0)
    impactBits.push(`sponsor${activeAnimalPledges === 1 ? "s" : ""} ${activeAnimalPledges} shelter friend${activeAnimalPledges === 1 ? "" : "s"}`);

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const openReceipt = (receiptNumber: string) => {
    window.open(`/api/receipts/${encodeURIComponent(receiptNumber)}/html`, "_blank", "noopener");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greet}, ${user.name.split(" ")[0]} 🙏`}
        description="Thank you for powering United Angel Reach — every rupee reaches the ground."
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total given"
          value={formatINR(totalDonated)}
          hint={`${completed.length} completed donation${completed.length === 1 ? "" : "s"}`}
          icon={<HandCoins className="size-5" />}
          accent="emerald"
          loading={loading}
        />
        <StatCard
          label="This FY"
          value={formatINR(fyTotal)}
          hint={financialYear(new Date())}
          icon={<CalendarHeart className="size-5" />}
          accent="teal"
          loading={loading}
        />
        <StatCard
          label="Active medicine pledges"
          value={String(activePledges.length)}
          hint={
            activePledges.length > 0
              ? `${formatINR(monthlyPledges)}/mo commitment`
              : "Adopt a patient's medicines"
          }
          icon={<HeartHandshake className="size-5" />}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="Animals sponsored"
          value={String(activeAnimalPledges)}
          hint={activeAnimalPledges > 0 ? "At the UAR shelter" : "Meet the animals →"}
          icon={<PawPrint className="size-5" />}
          accent="lime"
          loading={loading}
        />
      </div>

      {/* Impact snapshot */}
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

      {/* Quick actions */}
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

      {/* Recent donations */}
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
        ) : donations.length === 0 ? (
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
            {donations.slice(0, 5).map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {d.campaign?.title ?? "General fund"}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {d.receiptNumber} · {formatDate(d.createdAt)}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full text-[10px]",
                    d.paymentStatus === "COMPLETED" &&
                      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                    d.paymentStatus === "PENDING" &&
                      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                    (d.paymentStatus === "FAILED" || d.paymentStatus === "REFUNDED") &&
                      "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
                  )}
                >
                  {d.paymentStatus}
                </Badge>
                <p className="w-20 text-right text-sm font-bold">{formatINR(d.amount)}</p>
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

      {/* Notifications preview */}
      <SectionCard
        title="Notifications"
        description="Receipts, pledges and platform updates"
        icon={<Bell className="size-5" />}
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1 sm:min-h-9"
            onClick={loadNotifications}
            aria-label="Refresh notifications"
          >
            <CheckCheck className="size-4" aria-hidden="true" />
            Refresh
          </Button>
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
          <ul className="divide-y">
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
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDate(n.createdAt)}
                  </p>
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
    </div>
  );
}
