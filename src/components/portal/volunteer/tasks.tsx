"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  MapPin,
  Play,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, patch } from "@/lib/api-client";
import { cn, formatDate, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface VolunteerTask {
  id: string;
  title: string;
  description?: string | null;
  type: string; // DISTRIBUTION | KIT_SCAN | INVENTORY | EVENT | RESCUE | AMBULANCE
  priority: string; // LOW | MEDIUM | HIGH
  location?: string | null;
  scheduledDate: string;
  status: string; // ASSIGNED | IN_PROGRESS | COMPLETED | CANCELLED
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

function PriorityChip({ priority }: { priority: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        priority === "HIGH" && "border-red-200 bg-red-50 text-red-700",
        priority === "MEDIUM" && "border-amber-200 bg-amber-50 text-amber-700",
        priority === "LOW" && "border-zinc-200 bg-zinc-50 text-zinc-600"
      )}
    >
      {titleCase(priority)} priority
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        status === "ASSIGNED" && "border-amber-200 bg-amber-50 text-amber-700",
        status === "IN_PROGRESS" && "border-teal-200 bg-teal-50 text-teal-700",
        status === "COMPLETED" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        status === "CANCELLED" && "border-zinc-200 bg-zinc-50 text-zinc-600"
      )}
    >
      {titleCase(status)}
    </Badge>
  );
}

export default function VolunteerTasks(_props: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const [tasks, setTasks] = useState<VolunteerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<unknown>("/api/volunteer-tasks?mine=1");
      const list = asArray<VolunteerTask>(data);
      list.sort(
        (a, b) =>
          new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime()
      );
      setTasks(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const transition = async (task: VolunteerTask, status: string) => {
    setBusyId(task.id);
    try {
      await patch(`/api/volunteer-tasks/${task.id}`, { status });
      toast.success(
        status === "IN_PROGRESS"
          ? `Started “${task.title}” — all the best on ground!`
          : `“${task.title}” marked complete. Thank you!`
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update task");
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = tasks.filter(
    (t) => t.status === "ASSIGNED" || t.status === "IN_PROGRESS"
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">My tasks</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${activeCount} active · ${tasks.filter((t) => t.status === "COMPLETED").length} completed`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 gap-1.5 sm:min-h-9"
          onClick={load}
          aria-label="Refresh tasks"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <ClipboardList className="size-8 text-primary/60" aria-hidden="true" />
            <p className="text-sm font-semibold">No tasks assigned yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              When the admin assigns you a distribution drive, rescue or
              inventory duty, it appears here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {tasks.map((t) => (
            <Card key={t.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{t.title}</p>
                    <Badge
                      variant="outline"
                      className="rounded-full text-[10px] text-muted-foreground"
                    >
                      {titleCase(t.type)}
                    </Badge>
                    <PriorityChip priority={t.priority} />
                    <StatusBadge status={t.status} />
                  </div>
                  {t.description && (
                    <p className="text-sm text-muted-foreground">{t.description}</p>
                  )}
                  <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="size-3" aria-hidden="true" />
                      {formatDate(t.scheduledDate)}
                    </span>
                    {t.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" aria-hidden="true" />
                        {t.location}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  {t.status === "ASSIGNED" && (
                    <Button
                      className="min-h-11 flex-1 gap-1.5 sm:min-h-9 sm:flex-none"
                      disabled={busyId === t.id}
                      onClick={() => transition(t, "IN_PROGRESS")}
                    >
                      <Play className="size-4" aria-hidden="true" />
                      {busyId === t.id ? "Starting…" : "Start"}
                    </Button>
                  )}
                  {t.status === "IN_PROGRESS" && (
                    <Button
                      className="min-h-11 flex-1 gap-1.5 sm:min-h-9 sm:flex-none"
                      disabled={busyId === t.id}
                      onClick={() => transition(t, "COMPLETED")}
                    >
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      {busyId === t.id ? "Saving…" : "Mark complete"}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
