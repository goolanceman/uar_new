"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bell,
  Boxes,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Hourglass,
  MapPin,
  PackageOpen,
  Play,
  ScanLine,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, patch } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatDateTime, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface VolunteerTask {
  id: string;
  title: string;
  description?: string | null;
  type: string;
  priority: string;
  location?: string | null;
  scheduledDate: string;
  status: string;
}

interface Attendance {
  id: string;
  date: string;
  hours?: number | null;
}

interface KitUnit {
  id: string;
  code: string;
  location?: string | null;
  scannedAt?: string | null;
  batch?: { name?: string } | null;
}

interface AppNotification {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

const QUICK_TILES = [
  { key: "scan", label: "Scan kit", desc: "Hand over by QR", icon: ScanLine, to: "/volunteer/scan" },
  { key: "distributions", label: "Log distribution", desc: "Record a handover", icon: PackageOpen, to: "/volunteer/distributions" },
  { key: "inventory", label: "Check inventory", desc: "Stock & top-ups", icon: Boxes, to: "/volunteer/inventory" },
  { key: "tasks", label: "My tasks", desc: "Start & complete work", icon: ClipboardList, to: "/volunteer/tasks" },
];

export default function VolunteerOverview({
  user,
  volunteer,
}: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const [tasks, setTasks] = useState<VolunteerTask[]>([]);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [recentScans, setRecentScans] = useState<KitUnit[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Month window for attendance (server matches date gte/lte).
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

      const [t, k, n] = await Promise.all([
        get<unknown>("/api/volunteer-tasks?mine=1"),
        get<unknown>("/api/kit-units?mine=1&limit=200").catch(() => []),
        get<unknown>("/api/notifications?limit=5").catch(() => []),
      ]);
      setTasks(asArray<VolunteerTask>(t));
      setRecentScans(
        asArray<KitUnit>(k)
          .filter((u) => u.scannedAt)
          .sort((a, b) => new Date(b.scannedAt ?? 0).getTime() - new Date(a.scannedAt ?? 0).getTime())
          .slice(0, 5)
      );
      setNotifications(asArray<AppNotification>(n));

      // Attendance — volunteer-scoped (role contract: ADMIN, VOLUNTEER).
      if (volunteer?.id) {
        try {
          const att = await get<unknown>(
            `/api/volunteer-attendances?volunteerId=${encodeURIComponent(volunteer.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`
          );
          setAttendances(asArray<Attendance>(att));
        } catch {
          setAttendances([]);
        }
      } else {
        setAttendances([]);
      }
    } catch {
      // individual views surface detailed errors
    } finally {
      setLoading(false);
    }
  }, [volunteer?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const assigned = tasks.filter((t) => t.status === "ASSIGNED").length;
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  const hoursThisMonth = attendances.reduce((s, a) => s + (a.hours ?? 0), 0);
  const daysPresent = attendances.length;

  const nextTask = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "ASSIGNED" || t.status === "IN_PROGRESS")
        .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime())[0],
    [tasks]
  );

  const startNext = async () => {
    if (!nextTask) return;
    setAccepting(true);
    try {
      await patch(`/api/volunteer-tasks/${nextTask.id}`, { status: "IN_PROGRESS" });
      toast.success(`Started “${nextTask.title}” — all the best on ground!`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the task");
    } finally {
      setAccepting(false);
    }
  };

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

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Namaste, ${user.name.split(" ")[0]} 👋`}
        description={
          volunteer?.assignedArea
            ? `You're on ground in ${volunteer.assignedArea}. Here's your field summary.`
            : "Here's your field summary."
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Tasks assigned"
          value={String(assigned)}
          hint={`${inProgress} in progress now`}
          icon={<ClipboardList className="size-5" />}
          accent="teal"
          loading={loading}
        />
        <StatCard
          label="Tasks completed"
          value={String(completed)}
          hint="All time — great work!"
          icon={<CheckCircle2 className="size-5" />}
          accent="emerald"
          loading={loading}
        />
        <StatCard
          label="Hours this month"
          value={hoursThisMonth > 0 ? hoursThisMonth.toFixed(1) : "0"}
          hint={daysPresent > 0 ? `across ${daysPresent} day${daysPresent === 1 ? "" : "s"} present` : "attendance appears once logged"}
          icon={<Timer className="size-5" />}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="Days present"
          value={String(daysPresent)}
          hint="This month, from attendance"
          icon={<CalendarDays className="size-5" />}
          accent="lime"
          loading={loading}
        />
      </div>

      {/* Next up */}
      <SectionCard
        title="Next up"
        description="Your nearest commitment on the calendar"
        icon={<CalendarDays className="size-5" />}
      >
        {loading ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : nextTask ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{nextTask.title}</p>
                <Badge variant="outline" className="rounded-full text-[10px] text-muted-foreground">
                  {titleCase(nextTask.type)}
                </Badge>
                <StatusBadge status={nextTask.status} />
                <StatusBadge
                  status={nextTask.priority}
                  tone={nextTask.priority === "HIGH" ? "danger" : nextTask.priority === "MEDIUM" ? "warning" : "neutral"}
                >
                  {titleCase(nextTask.priority)} priority
                </StatusBadge>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="size-3" aria-hidden="true" />
                  {formatDateTime(nextTask.scheduledDate)}
                </span>
                {nextTask.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" aria-hidden="true" />
                    {nextTask.location}
                  </span>
                )}
              </p>
            </div>
            {nextTask.status === "ASSIGNED" ? (
              <Button
                className="min-h-11 gap-1.5 sm:min-h-9"
                onClick={startNext}
                disabled={accepting}
                aria-label={`Start task ${nextTask.title}`}
              >
                <Play className="size-4" aria-hidden="true" />
                {accepting ? "Starting…" : "Start now"}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="min-h-11 gap-1.5 sm:min-h-9"
                onClick={() => navigate("/volunteer/tasks")}
              >
                Open tasks <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<Hourglass className="size-5" />}
            title="Nothing scheduled right now"
            hint="New assignments from the coordinator will appear here — you'll also get a notification."
          />
        )}
      </SectionCard>

      {/* Quick tiles */}
      <section aria-label="Quick tools">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick tools
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_TILES.map((q) => {
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
                <span className="text-sm font-semibold">{q.label}</span>
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

      {/* Recent scans */}
      <SectionCard
        title="Recent scans"
        description="Your last kit handovers, newest first"
        icon={<ScanLine className="size-5" />}
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1 sm:min-h-9"
            onClick={() => navigate("/volunteer/scan")}
          >
            Open scanner <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        }
      >
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : recentScans.length === 0 ? (
          <EmptyState
            icon={<ScanLine className="size-5" />}
            title="No scans yet"
            hint="Your handover history appears here after the first kit scan."
          />
        ) : (
          <ul className="max-h-60 divide-y overflow-y-auto pr-1 scrollbar-thin">
            {recentScans.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                <p className="font-mono text-sm font-semibold">{u.code}</p>
                <span className="truncate text-xs text-muted-foreground">
                  {u.batch?.name ? `${u.batch.name} · ` : ""}
                  {u.location ?? "—"}
                </span>
                <span className={cn("ml-auto shrink-0 text-xs text-muted-foreground")}>
                  {formatDateTime(u.scannedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Notifications */}
      <SectionCard
        title="Notifications"
        description={`Task assignments and platform updates${unreadCount > 0 ? ` · ${unreadCount} unread` : ""}`}
        icon={<Bell className="size-5" />}
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1 sm:min-h-9"
            onClick={load}
            aria-label="Refresh notifications"
          >
            <CheckCheck className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      >
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No notifications yet — task assignments will ping you here.
          </p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto pr-1 scrollbar-thin">
            {notifications.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    n.isRead ? "bg-muted-foreground/30" : "bg-teal-500"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm", n.isRead ? "text-muted-foreground" : "font-medium")}>
                    {n.title}
                  </p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)}</p>
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
