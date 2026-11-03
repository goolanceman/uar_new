"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  MapPin,
  Play,
  RefreshCw,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, patch } from "@/lib/api-client";
import { formatDateTime, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormSheet } from "@/components/shared/form-sheet";
import { TextareaField } from "@/components/shared/form-fields";
import { fieldError, minLen } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

type TabKey = "ASSIGNED" | "IN_PROGRESS" | "COMPLETED";

function priorityTone(priority: string): "danger" | "warning" | "neutral" {
  if (priority === "HIGH") return "danger";
  if (priority === "MEDIUM") return "warning";
  return "neutral";
}

export default function VolunteerTasks(_props: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const [tasks, setTasks] = useState<VolunteerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("ASSIGNED");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Completion FormSheet (note required)
  const [completeTask, setCompleteTask] = useState<VolunteerTask | null>(null);
  const [completeNotes, setCompleteNotes] = useState("");
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  // Cancel FormSheet (reason required)
  const [cancelTask, setCancelTask] = useState<VolunteerTask | null>(null);
  const [cancelNotes, setCancelNotes] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<unknown>("/api/volunteer-tasks?mine=1");
      const list = asArray<VolunteerTask>(data);
      list.sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());
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
    const err = fieldError(completeNotes, [minLen(5, "Completion note")]);
    setCompleteError(err);
    if (err) return;
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
    const err = fieldError(cancelNotes, [minLen(5, "Reason")]);
    setCancelError(err);
    if (err) return;
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

      {/* Status pipeline tabs */}
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
        <Card className="p-2">
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
                  ? "Start a task from the Assigned tab to get moving."
                  : "Completed tasks land here with your notes — great work is coming."
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {visible.map((t) => {
            const expanded = expandedId === t.id;
            return (
              <Card key={t.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{t.title}</p>
                      <Badge variant="outline" className="rounded-full text-[10px] text-muted-foreground">
                        {titleCase(t.type)}
                      </Badge>
                      <StatusBadge status={t.priority} tone={priorityTone(t.priority)}>
                        {titleCase(t.priority)} priority
                      </StatusBadge>
                      <StatusBadge status={t.status} />
                    </div>
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
                            setCancelError(null);
                          }}
                          aria-label={`Can't make task ${t.title}`}
                        >
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
                            setCompleteError(null);
                          }}
                          aria-label={`Complete task ${t.title}`}
                        >
                          Complete
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-11 flex-1 gap-1.5 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 sm:min-h-9 sm:flex-none"
                          onClick={() => {
                            setCancelTask(t);
                            setCancelNotes("");
                            setCancelError(null);
                          }}
                          aria-label={`Cancel task ${t.title}`}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11 gap-1 sm:min-h-9"
                      onClick={() => setExpandedId((prev) => (prev === t.id ? null : t.id))}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Hide" : "Show"} details for ${t.title}`}
                    >
                      {expanded ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                      Details
                    </Button>
                  </div>
                </div>

                {/* Detail expansion */}
                {expanded && (
                  <div className="mt-3 space-y-2 rounded-lg bg-muted/40 p-4 text-sm">
                    <p className="flex items-start gap-2">
                      <StickyNote className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="text-muted-foreground">
                        {t.description ?? "No briefing added — ask your coordinator on ground."}
                      </span>
                    </p>
                    {t.notes && (
                      <p className="flex items-start gap-2">
                        <Clock3 className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                        <span className="text-muted-foreground">
                          Latest note: {t.notes}
                        </span>
                      </p>
                    )}
                    {t.completedAt && (
                      <p className="text-xs text-muted-foreground">
                        Completed {formatDateTime(t.completedAt)}
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ---------- Complete FormSheet (notes required) ---------- */}
      <FormSheet
        open={completeTask !== null}
        onOpenChange={(o) => !o && setCompleteTask(null)}
        title={completeTask ? `Complete “${completeTask.title}”` : "Complete task"}
        description="Add a short field note — beneficiary count, what was handed over, or anything the coordinator should know."
        submitLabel="Mark complete"
        loading={completing}
        dirty={completeNotes.trim().length > 0}
        size="sm"
        onSubmit={submitComplete}
      >
        <TextareaField
          label="Completion note (required)"
          required
          rows={4}
          placeholder="e.g. 32 ration kits handed over at Ejipura drive, 4 volunteers assisted…"
          value={completeNotes}
          onChange={setCompleteNotes}
          error={completeError}
        />
        <p className="text-xs text-muted-foreground">
          {completeNotes.trim().length}/5 characters minimum — goes straight to the coordinator.
        </p>
      </FormSheet>

      {/* ---------- Cancel FormSheet (reason required) ---------- */}
      <FormSheet
        open={cancelTask !== null}
        onOpenChange={(o) => !o && setCancelTask(null)}
        title={cancelTask ? `Can't make “${cancelTask.title}”?` : "Cancel task"}
        description="No problem — leave a note so the coordinator can reassign quickly."
        submitLabel="Cancel task"
        cancelLabel="I'll manage it"
        loading={cancelling}
        dirty={cancelNotes.trim().length > 0}
        size="sm"
        onSubmit={submitCancel}
      >
        <TextareaField
          label="Reason (required)"
          required
          rows={3}
          placeholder="e.g. Out of town this weekend, can take the next drive…"
          value={cancelNotes}
          onChange={setCancelNotes}
          error={cancelError}
        />
        <p className="text-xs text-muted-foreground">
          {cancelNotes.trim().length}/5 characters minimum.
        </p>
      </FormSheet>
    </div>
  );
}
