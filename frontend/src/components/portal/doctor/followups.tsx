"use client";

/**
 * Doctor portal — Follow-ups. Pending follow-ups for my patients with
 * complete / missed actions.
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  asArray,
  ListSkeleton,
  medTone,
  QuietEmpty,
  toastError,
  type FollowUpRow,
} from "./shared";
import { useRowBusy } from "@/hooks/use-row-busy";

export default function DoctorFollowups({ user }: { user: SessionUser }) {
  const [rows, setRows] = useState<FollowUpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { busyId, setBusyId } = useRowBusy();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<unknown>("/api/follow-ups");
      setRows(asArray<FollowUpRow>(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load follow-ups");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (row: FollowUpRow, status: "DONE" | "MISSED", outcome?: string) => {
    setBusyId(row.id);
    try {
      await patch(`/api/follow-ups/${row.id}`, { status, outcome });
      toast.success(status === "DONE" ? "Follow-up completed" : "Follow-up marked missed");
      await load();
    } catch (e) {
      toastError(e, "Could not update the follow-up");
    } finally {
      setBusyId(null);
    }
  };

  const overdue = (row: FollowUpRow) =>
    row.status === "PENDING" && new Date(row.dueDate).getTime() < Date.now();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-ups"
        description="Patients to call back — overdue ones float to the top."
        icon={<CalendarClock className="size-5" />}
        actions={
          <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={load} aria-label="Refresh follow-ups">
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <SectionCard title="My follow-ups" description="Mark each one done or missed once you've contacted the patient" icon={<CalendarClock className="size-5" />}>
        {loading ? (
          <ListSkeleton rows={3} />
        ) : rows.length === 0 ? (
          <QuietEmpty
            icon={<CalendarClock className="size-5" />}
            title="No follow-ups yet"
            error={error}
            hint="Follow-ups are created from encounters or by nurses during camps."
          />
        ) : (
          <ul className="max-h-[32rem] divide-y overflow-y-auto scrollbar-thin">
            {[...rows]
              .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
              .map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {row.beneficiary?.name ?? "Patient"}
                      {overdue(row) && (
                        <span className="ml-2 text-xs font-semibold text-red-600 dark:text-red-400">overdue</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Due {formatDate(row.dueDate)}
                      {row.notes ? ` · ${row.notes}` : ""}
                      {row.outcome ? ` · outcome: ${row.outcome}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={row.status} tone={medTone(row.status)} />
                  {row.status === "PENDING" && (
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <Button
                        size="sm"
                        className="min-h-11 flex-1 gap-1.5 sm:min-h-9 sm:flex-none"
                        disabled={busyId !== null}
                        onClick={() => void act(row, "DONE")}
                      >
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        Done
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-11 sm:min-h-9"
                        disabled={busyId !== null}
                        onClick={() => void act(row, "MISSED")}
                        aria-label={`Mark ${row.beneficiary?.name ?? "patient"}'s follow-up as missed`}
                      >
                        <XCircle className="size-4" aria-hidden="true" />
                        Missed
                      </Button>
                    </div>
                  )}
                </li>
              ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
