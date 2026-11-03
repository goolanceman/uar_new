"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  MapPin,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, patch } from "@/lib/api-client";
import { formatDateTime, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface VolunteerTask {
  id: string;
  title: string;
  description?: string | null;
  type: string; // DISTRIBUTION | KIT_SCAN | INVENTORY | EVENT | RESCUE | AMBULANCE
  priority: string; // LOW | MEDIUM | HIGH
  location?: string | null;
  scheduledDate: string;
  status: string; // ASSIGNED | IN_PROGRESS | COMPLETED | CANCELLED
  completedAt?: string | null;
  notes?: string | null;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        priority === "HIGH" &&
          "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
        priority === "MEDIUM" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        priority === "LOW" && "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
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
        status === "ASSIGNED" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        status === "IN_PROGRESS" &&
          "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
        status === "COMPLETED" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        status === "CANCELLED" &&
          "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
      )}
    >
      {titleCase(status)}
    </Badge>
  );
}

type TabKey = "ASSIGNED" | "IN_PROGRESS" | "COMPLETED";

export default function VolunteerTasks(_props: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const [tasks, setTasks] = useState<VolunteerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("ASSIGNED");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Completion dialog
  const [completeTask, setCompleteTask] = useState<VolunteerTask | null>(null);
  const [completeNotes, setCompleteNotes] = useState("");
  const [completing, setCompleting] = useState(false);

  // Cancel dialog
  const [cancelTask, setCancelTask] = useState<VolunteerTask | null>(null);
  const [cancelNotes, setCancelNotes] = useState("");
  const [cancelling, setCancelling] = useState(false);

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

  const start = async (task: VolunteerTask) => {
    setBusyId(task.id);
    try {
      await patch(`/api/volunteer-tasks/${task.id}`, { status: "IN_PROGRESS" });
      toast.success(`Started “${task.title}” — all the best on ground!`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update task");
    } finally {
      setBusyId(null);
    }
  };

  const submitComplete = async () => {
    if (!completeTask) return;
    if (completeNotes.trim().length < 5) {
      toast.error("Add a short completion note (min 5 characters) for the coordinator");
      return;
    }
    setCompleting(true);
    try {
      await patch(`/api/volunteer-tasks/${completeTask.id}`, {
        status: "COMPLETED",
        notes: completeNotes.trim(),
      });
      toast.success(`“${completeTask.title}” marked complete. Thank you!`);
      setCompleteTask(null);
      setCompleteNotes("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete task");
    } finally {
      setCompleting(false);
    }
  };

  const submitCancel = async () => {
    if (!cancelTask) return;
    if (cancelNotes.trim().length < 5) {
      toast.error("Tell the coordinator why you can't make it (min 5 characters)");
      return;
    }
    setCancelling(true);
    try {
      await patch(`/api/volunteer-tasks/${cancelTask.id}`, {
        status: "CANCELLED",
        notes: cancelNotes.trim(),
      });
      toast.success("Task cancelled — the coordinator has your note.");
      setCancelTask(null);
      setCancelNotes("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel task");
    } finally {
      setCancelling(false);
    }
  };

  const byTab = useMemo(
    () => ({
      ASSIGNED: tasks.filter((t) => t.status === "ASSIGNED"),
      IN_PROGRESS: tasks.filter((t) => t.status === "IN_PROGRESS"),
      COMPLETED: tasks.filter((t) => t.status === "COMPLETED"),
    }),
    [tasks]
  );

  const visible = byTab[tab];

  return (
    <div className="space-y-4">
      <PageHeader
        title="My tasks"
        description={
          loading
            ? "Loading your assignments…"
            : `${byTab.ASSIGNED.length} assigned · ${byTab.IN_PROGRESS.length} in progress · ${byTab.COMPLETED.length} completed`
        }
        icon={<ClipboardList className="size-5" />}
        actions={
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
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabKey)}
        aria-label="Filter tasks by status"
      >
        <TabsList className="h-11 w-full justify-start overflow-x-auto sm:h-9 sm:w-fit">
          {(Object.keys(byTab) as TabKey[]).map((k) => (
            <TabsTrigger key={k} value={k} className="min-h-9 gap-1.5 px-3">
              {titleCase(k)}
              <span className="rounded-full bg-background/60 px-1.5 text-[10px] font-semibold tabular-nums">
                {byTab[k].length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-2">
            <EmptyState
              icon={<ClipboardList className="size-5" />}
              title={
                tab === "ASSIGNED"
                  ? "No assigned tasks right now"
                  : tab === "IN_PROGRESS"
                    ? "Nothing in progress"
                    : "No completed tasks yet"
              }
              hint={
                tab === "ASSIGNED"
                  ? "When the coordinator assigns you a drive, rescue or inventory duty, it appears here."
                  : tab === "IN_PROGRESS"
                    ? "Accept a task from the Assigned tab to get started."
                    : "Completed tasks land here with your notes — great work is coming."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {visible.map((t) => (
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
                    <PriorityBadge priority={t.priority} />
                    <StatusBadge status={t.status} />
                  </div>
                  {t.description && (
                    <p className="text-sm text-muted-foreground">{t.description}</p>
                  )}
                  <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="size-3" aria-hidden="true" />
                      {formatDateTime(t.scheduledDate)}
                    </span>
                    {t.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" aria-hidden="true" />
                        {t.location}
                      </span>
                    )}
                  </p>
                  {t.notes && (
                    <p className="mt-1 border-l-2 border-primary/30 pl-2 text-xs italic text-muted-foreground">
                      Note: {t.notes}
                    </p>
                  )}
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  {t.status === "ASSIGNED" && (
                    <>
                      <Button
                        className="min-h-11 flex-1 gap-1.5 sm:min-h-9 sm:flex-none"
                        disabled={busyId === t.id}
                        onClick={() => start(t)}
                        aria-label={`Start task ${t.title}`}
                      >
                        <Play className="size-4" aria-hidden="true" />
                        {busyId === t.id ? "Starting…" : "Start"}
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-11 flex-1 gap-1.5 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 sm:min-h-9 sm:flex-none"
                        onClick={() => {
                          setCancelTask(t);
                          setCancelNotes("");
                        }}
                        aria-label={`Cancel task ${t.title}`}
                      >
                        <XCircle className="size-4" aria-hidden="true" />
                        Can&apos;t make it
                      </Button>
                    </>
                  )}
                  {t.status === "IN_PROGRESS" && (
                    <>
                      <Button
                        className="min-h-11 flex-1 gap-1.5 sm:min-h-9 sm:flex-none"
                        onClick={() => {
                          setCompleteTask(t);
                          setCompleteNotes("");
                        }}
                        aria-label={`Complete task ${t.title}`}
                      >
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        Complete
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-11 flex-1 gap-1.5 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 sm:min-h-9 sm:flex-none"
                        onClick={() => {
                          setCancelTask(t);
                          setCancelNotes("");
                        }}
                        aria-label={`Cancel task ${t.title}`}
                      >
                        <XCircle className="size-4" aria-hidden="true" />
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ---------- Complete dialog (notes required) ---------- */}
      <Dialog
        open={completeTask !== null}
        onOpenChange={(open) => !open && setCompleteTask(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Complete “{completeTask?.title}”</DialogTitle>
            <DialogDescription>
              Add a short field note — beneficiary count, what was handed over, or
              anything the coordinator should know.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="task-complete-notes">Completion note (required)</Label>
            <Textarea
              id="task-complete-notes"
              rows={4}
              placeholder="e.g. 32 ration kits handed over at Ejipura drive, 4 volunteers assisted…"
              value={completeNotes}
              onChange={(e) => setCompleteNotes(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {completeNotes.trim().length}/5 characters minimum
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setCompleteTask(null)}
            >
              Keep working
            </Button>
            <Button className="min-h-11" onClick={submitComplete} disabled={completing}>
              {completing ? "Saving…" : "Mark complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Cancel dialog (note required) ---------- */}
      <Dialog
        open={cancelTask !== null}
        onOpenChange={(open) => !open && setCancelTask(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Can&apos;t make “{cancelTask?.title}”?</DialogTitle>
            <DialogDescription>
              No problem — leave a note so the coordinator can reassign quickly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="task-cancel-notes">Reason (required)</Label>
            <Textarea
              id="task-cancel-notes"
              rows={3}
              placeholder="e.g. Out of town this weekend, can take the next drive…"
              value={cancelNotes}
              onChange={(e) => setCancelNotes(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {cancelNotes.trim().length}/5 characters minimum
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setCancelTask(null)}
            >
              I&apos;ll manage it
            </Button>
            <Button
              variant="destructive"
              className="min-h-11"
              onClick={submitCancel}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling…" : "Cancel task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
