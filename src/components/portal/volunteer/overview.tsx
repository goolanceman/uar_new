"use client";

import { useCallback, useEffect, useState } from "react";
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
  if (data && typeof data === "object" && Array.isArray((data as { notifications?: unknown }).notifications))
    return (data as { notifications: T[] }).notifications;
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
  const [kitCount, setKitCount] = useState<number | null>(null);
  const [kitGlobal, setKitGlobal] = useState<number | null>(null);
  const [distCount, setDistCount] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, k, ks, d, n] = await Promise.all([
        get<unknown>("/api/volunteer-tasks?mine=1"),
        get<unknown>("/api/kit-units?mine=1&limit=500").catch(() => []),
        get<unknown>("/api/kit-stats").catch(() => null),
        get<unknown>("/api/distributions?mine=1").catch(() => []),
        get<unknown>("/api/notifications?limit=3").catch(() => []),
      ]);
      setTasks(asArray<VolunteerTask>(t));
      setKitCount(asArray<unknown>(k).length);
      const stats = ks as { units?: { scanned?: number } } | null;
      setKitGlobal(stats?.units?.scanned ?? null);
      setDistCount(asArray<unknown>(d).length);
      setNotifications(asArray<AppNotification>(n));
    } catch {
      // individual views surface detailed errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  const nextTask = tasks
    .filter((t) => t.status === "ASSIGNED" || t.status === "IN_PROGRESS")
    .sort(
      (a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
    )[0];

  const acceptNext = async () => {
    if (!nextTask) return;
    setAccepting(true);
    try {
      await patch(`/api/volunteer-tasks/${nextTask.id}`, { status: "IN_PROGRESS" });
      toast.success(`Accepted “${nextTask.title}” — all the best on ground!`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept the task");
    } finally {
      setAccepting(false);
    }
  };

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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Tasks completed"
          value={String(completed)}
          hint={`${tasks.filter((t) => t.status === "ASSIGNED").length} assigned · ${tasks.filter((t) => t.status === "IN_PROGRESS").length} in progress`}
          icon={<CheckCircle2 className="size-5" />}
          accent="teal"
          loading={loading}
        />
        <StatCard
          label="Field hours"
          value="—"
          hint="Attendance tracking not enabled yet"
          icon={<Timer className="size-5" />}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="Kits scanned"
          value={kitCount === null ? "—" : String(kitCount)}
          hint={kitGlobal !== null ? `of ${kitGlobal} across UAR` : "by you, all time"}
          icon={<ScanLine className="size-5" />}
          accent="emerald"
          loading={loading}
        />
        <StatCard
          label="Distributions logged"
          value={distCount === null ? "—" : String(distCount)}
          hint="handovers recorded by you"
          icon={<PackageOpen className="size-5" />}
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
                <Badge
                  variant="outline"
                  className="rounded-full text-[10px] text-muted-foreground"
                >
                  {titleCase(nextTask.type)}
                </Badge>
                {nextTask.status === "IN_PROGRESS" ? (
                  <Badge
                    variant="outline"
                    className="rounded-full border-teal-500/30 bg-teal-500/10 text-[10px] text-teal-700 dark:text-teal-400"
                  >
                    In progress
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full text-[10px]",
                      nextTask.priority === "HIGH"
                        ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    )}
                  >
                    {titleCase(nextTask.priority)} priority
                  </Badge>
                )}
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
                onClick={acceptNext}
                disabled={accepting}
                aria-label={`Accept task ${nextTask.title}`}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                {accepting ? "Accepting…" : "Accept"}
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

      {/* Notifications preview */}
      <SectionCard
        title="Notifications"
        description="Task assignments and platform updates"
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
          <ul className="divide-y">
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
