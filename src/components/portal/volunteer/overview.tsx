"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Loader,
  MapPin,
  PackageOpen,
  ScanLine,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatDateTime, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

interface Distribution {
  id: string;
  type: string;
  quantity: number;
  distributedAt: string;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

function Stat({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  loading: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-10" />
          ) : (
            <p className="text-xl font-bold leading-tight">{value}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

const QUICK_LINKS = [
  { key: "tasks", label: "My tasks", desc: "Start & complete assigned work", icon: ClipboardList, to: "/volunteer/tasks" },
  { key: "distributions", label: "Record distribution", desc: "Log what you handed over", icon: PackageOpen, to: "/volunteer/distributions" },
  { key: "scan", label: "Scan a kit", desc: "Hand over ration kits by QR", icon: ScanLine, to: "/volunteer/scan" },
  { key: "inventory", label: "Inventory", desc: "Check & top up stock", icon: Boxes, to: "/volunteer/inventory" },
];

export default function VolunteerOverview({
  user,
  volunteer,
}: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const [tasks, setTasks] = useState<VolunteerTask[]>([]);
  const [distributionCount, setDistributionCount] = useState(0);
  const [kitCount, setKitCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [t, d, k] = await Promise.all([
          get<unknown>("/api/volunteer-tasks?mine=1"),
          get<unknown>("/api/distributions?mine=1").catch(() => [] as unknown),
          get<unknown>("/api/kit-units?mine=1").catch(() => [] as unknown),
        ]);
        if (!alive) return;
        const taskList = asArray<VolunteerTask>(t);
        setTasks(taskList);
        setDistributionCount(asArray<Distribution>(d).length);
        setKitCount(asArray<unknown>(k).length);
      } catch {
        // leave zeros; individual views surface errors
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const open = tasks.filter((t) => t.status === "ASSIGNED").length;
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const completed = tasks.filter((t) => t.status === "COMPLETED").length;

  const nextTask = tasks
    .filter((t) => t.status === "ASSIGNED" || t.status === "IN_PROGRESS")
    .sort(
      (a, b) =>
        new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
    )[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Namaste, {user.name.split(" ")[0]} 👋
        </h1>
        <p className="text-sm text-muted-foreground">
          {volunteer?.assignedArea
            ? `You're on ground in ${volunteer.assignedArea}. `
            : ""}
          Here&apos;s your field summary.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Stat icon={ClipboardList} label="Open tasks" value={open} loading={loading} />
        <Stat icon={Loader} label="In progress" value={inProgress} loading={loading} />
        <Stat icon={CheckCircle2} label="Completed" value={completed} loading={loading} />
        <Stat icon={PackageOpen} label="Distributions" value={distributionCount} loading={loading} />
        <Stat icon={ScanLine} label="Kits scanned" value={kitCount} loading={loading} />
      </div>

      {/* Next scheduled task */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4 text-primary" aria-hidden="true" />
            Next scheduled task
          </CardTitle>
          <CardDescription>Your nearest commitment on the calendar</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-16 w-full rounded-lg" />
          ) : nextTask ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-secondary/50 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{nextTask.title}</p>
                  <Badge variant="outline" className="rounded-full text-[10px] text-muted-foreground">
                    {titleCase(nextTask.type)}
                  </Badge>
                  {nextTask.priority === "HIGH" && (
                    <Badge variant="outline" className="rounded-full border-red-200 bg-red-50 text-[10px] text-red-700">
                      High priority
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
              <Button
                className="min-h-11 gap-1.5 sm:min-h-9"
                onClick={() => navigate("/volunteer/tasks")}
              >
                Open tasks <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              <Sparkles className="size-4 text-primary/60" aria-hidden="true" />
              Nothing scheduled right now — new assignments from the admin will
              appear here.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick links */}
      <section aria-label="Quick links">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick links
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map((q) => {
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
    </div>
  );
}
