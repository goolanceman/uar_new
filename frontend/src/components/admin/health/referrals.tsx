"use client";

/**
 * Health Programme — Referrals tab.
 *
 * Two sub-tabs: Referrals (status advance menu, priority badges) and
 * Follow-ups (overdue highlight, DONE/MISSED actions with optional outcome).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Loader2,
  MoreHorizontal,
  Share2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { get, patch } from "@/lib/api-client";
import { REFERRAL_STATUSES, referralTransitions } from "@/lib/referrals";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/format";
import { humanize, StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { FieldGrid, FormSection, TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TabProps } from "./overview";
import {
  asPaged,
  errorText,
  FilterChips,
  isOverdue,
  PRIORITY_TONE,
  REFERRAL_FLOW,
  REFERRAL_TONE,
  type FollowUpRow,
  type ReferralRow,
} from "./shared";

export default function ReferralsTab({ revision }: TabProps) {
  const [sub, setSub] = useState("referrals");

  /* ------------------------------- referrals ------------------------------ */
  const [refs, setRefs] = useState<ReferralRow[]>([]);
  const [refsLoading, setRefsLoading] = useState(true);
  const [refsError, setRefsError] = useState<string | null>(null);
  const [refStatus, setRefStatus] = useState("ALL");
  const [priority, setPriority] = useState("ALL");

  /* ------------------------------- follow-ups ----------------------------- */
  const [fups, setFups] = useState<FollowUpRow[]>([]);
  const [fupsLoading, setFupsLoading] = useState(true);
  const [fupsError, setFupsError] = useState<string | null>(null);
  const [fupFilter, setFupFilter] = useState("ALL"); // ALL | PENDING | OVERDUE | DONE | MISSED

  /* actions */
  const [outcomeTarget, setOutcomeTarget] = useState<FollowUpRow | null>(null);
  const [outcomeNext, setOutcomeNext] = useState<"DONE" | "MISSED">("DONE");
  const [outcome, setOutcome] = useState("");
  const [acting, setActing] = useState(false);

  const loadRefs = useCallback(async () => {
    setRefsLoading(true);
    setRefsError(null);
    try {
      const sp = new URLSearchParams();
      if (refStatus !== "ALL") sp.set("status", refStatus);
      if (priority !== "ALL") sp.set("priority", priority);
      const d = await get<unknown>(`/api/referrals?${sp.toString()}`);
      const list = asPaged<ReferralRow>(d).items.slice();
      list.sort((a, b) => REFERRAL_STATUSES.indexOf(a.status) - REFERRAL_STATUSES.indexOf(b.status));
      setRefs(list);
    } catch (e) {
      setRefsError(errorText(e));
    } finally {
      setRefsLoading(false);
    }
  }, [refStatus, priority]);

  const loadFups = useCallback(async () => {
    setFupsLoading(true);
    setFupsError(null);
    try {
      const d = await get<unknown>("/api/follow-ups?limit=200");
      setFups(asPaged<FollowUpRow>(d).items);
    } catch (e) {
      setFupsError(errorText(e));
    } finally {
      setFupsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRefs();
  }, [loadRefs, revision]);
  useEffect(() => {
    loadFups();
  }, [loadFups, revision]);

  const advanceRef = useCallback(
    async (row: ReferralRow, status: string) => {
      try {
        await patch(`/api/referrals/${row.id}`, { status });
        toast.success(`Referral → ${humanize(status)}`);
        await loadRefs();
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    [loadRefs]
  );

  const runOutcome = async () => {
    if (!outcomeTarget) return;
    setActing(true);
    try {
      await patch(`/api/follow-ups/${outcomeTarget.id}`, {
        status: outcomeNext,
        outcome: outcome.trim() || undefined,
      });
      toast.success(`Follow-up marked ${outcomeNext.toLowerCase()}`);
      setOutcomeTarget(null);
      setOutcome("");
      await loadFups();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setActing(false);
    }
  };

  /* ------------------------------- derived -------------------------------- */

  const fupVisible = useMemo(() => {
    if (fupFilter === "ALL") return fups;
    if (fupFilter === "OVERDUE") return fups.filter((f) => f.status === "PENDING" && isOverdue(f.dueAt));
    return fups.filter((f) => f.status === fupFilter);
  }, [fups, fupFilter]);

  const overdueCount = fups.filter((f) => f.status === "PENDING" && isOverdue(f.dueAt)).length;

  /* -------------------------------- CSVs ---------------------------------- */

  const refCsv: CsvColumn<ReferralRow>[] = useMemo(
    () => [
      { header: "Beneficiary", value: (r) => r.beneficiary?.name ?? "" },
      { header: "Facility", value: (r) => r.facility ?? "" },
      { header: "Reason", value: (r) => r.reason ?? "" },
      { header: "Priority", value: (r) => r.priority ?? "" },
      { header: "Status", value: (r) => r.status },
      { header: "Created", value: (r) => (r.createdAt ? formatDate(r.createdAt) : "") },
    ],
    []
  );

  const fupCsv: CsvColumn<FollowUpRow>[] = useMemo(
    () => [
      { header: "Beneficiary", value: (f) => f.beneficiary?.name ?? "" },
      { header: "Due", value: (f) => formatDate(f.dueAt) },
      { header: "Status", value: (f) => f.status },
      { header: "Overdue", value: (f) => (f.status === "PENDING" && isOverdue(f.dueAt) ? "yes" : "no") },
      { header: "Channel", value: (f) => f.channel ?? "" },
      { header: "Outcome", value: (f) => f.outcome ?? "" },
      { header: "Notes", value: (f) => f.notes ?? "" },
    ],
    []
  );

  /* ------------------------------- columns -------------------------------- */

  const refColumns: DataTableColumn<ReferralRow>[] = [
    {
      key: "beneficiary",
      header: "Beneficiary",
      accessor: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.beneficiary?.name ?? "—"}</p>
          <p className="truncate text-xs text-muted-foreground">{r.facility || r.reason || "—"}</p>
        </div>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      accessor: (r) => (
        <StatusBadge status={r.priority ?? undefined} tone={PRIORITY_TONE[r.priority ?? ""] ?? "neutral"}>
          {humanize(r.priority) || "—"}
        </StatusBadge>
      ),
    },
    { key: "status", header: "Status", accessor: (r) => <StatusBadge status={r.status} tone={REFERRAL_TONE[r.status]} /> },
    {
      key: "created",
      header: "Raised",
      hideBelow: "md",
      accessor: (r) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">{r.createdAt ? formatDate(r.createdAt) : "—"}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12",
      accessor: (r) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`Referral actions for ${r.beneficiary?.name ?? "beneficiary"}`}>
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {referralTransitions(r.status).map((s) => (
                <DropdownMenuItem key={s} onClick={() => advanceRef(r, s)}>
                  <Check className="size-4" aria-hidden="true" /> {humanize(s)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const fupColumns: DataTableColumn<FollowUpRow>[] = [
    {
      key: "beneficiary",
      header: "Beneficiary",
      accessor: (f) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{f.beneficiary?.name ?? "—"}</p>
          <p className="truncate text-xs text-muted-foreground">{f.notes || f.channel || "—"}</p>
        </div>
      ),
    },
    {
      key: "due",
      header: "Due",
      accessor: (f) => {
        const late = f.status === "PENDING" && isOverdue(f.dueAt);
        return (
          <span className={cn("whitespace-nowrap text-sm", late && "font-semibold text-red-600 dark:text-red-400")}>
            {formatDate(f.dueAt)}
            {late ? " · overdue" : ""}
          </span>
        );
      },
    },
    { key: "status", header: "Status", accessor: (f) => <StatusBadge status={f.status} /> },
    {
      key: "outcome",
      header: "Outcome",
      hideBelow: "md",
      accessor: (f) => <span className="block max-w-48 truncate text-xs text-muted-foreground">{f.outcome ?? "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-28",
      accessor: (f) =>
        f.status === "PENDING" || f.status === "SCHEDULED" ? (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-emerald-600 dark:text-emerald-400"
              aria-label={`Mark follow-up for ${f.beneficiary?.name ?? "beneficiary"} done`}
              onClick={() => {
                setOutcomeTarget(f);
                setOutcomeNext("DONE");
                setOutcome("");
              }}
            >
              <Check className="size-4" aria-hidden="true" /> Done
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-amber-600 dark:text-amber-400"
              aria-label={`Mark follow-up for ${f.beneficiary?.name ?? "beneficiary"} missed`}
              onClick={() => {
                setOutcomeTarget(f);
                setOutcomeNext("MISSED");
                setOutcome("");
              }}
            >
              <X className="size-4" aria-hidden="true" /> Missed
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <Tabs value={sub} onValueChange={setSub}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto sm:flex-wrap">
          <TabsTrigger value="referrals" className="shrink-0 gap-1.5">
            <Share2 className="size-3.5" aria-hidden="true" /> Referrals
          </TabsTrigger>
          <TabsTrigger value="follow-ups" className="shrink-0 gap-1.5">
            <CalendarClock className="size-3.5" aria-hidden="true" /> Follow-ups
            {overdueCount > 0 ? (
              <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-bold tabular-nums text-amber-700 dark:text-amber-300">
                {overdueCount} overdue
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* REFERRALS */}
        <TabsContent value="referrals" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <FilterChips label="Filter referrals by status" options={["ALL", ...REFERRAL_STATUSES]} value={refStatus} onChange={setRefStatus} />
            <FilterChips
              label="Filter referrals by priority"
              options={["ALL", "LOW", "MEDIUM", "HIGH", "CRITICAL"]}
              value={priority}
              onChange={setPriority}
            />
            <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {refsLoading ? "Loading…" : `${refs.length} referral${refs.length === 1 ? "" : "s"}`}
            </span>
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <ExportMenu columns={refCsv} rows={refs} filename="uar-referrals" disabled={refs.length === 0} />
            </div>
          </div>

          {refsError ? (
            <EmptyState icon={<Share2 className="size-8" aria-hidden="true" />} title="Referrals could not load" hint={refsError}>
              <Button variant="outline" size="sm" className="min-h-11" onClick={loadRefs}>
                Retry
              </Button>
            </EmptyState>
          ) : (
            <DataTable
              columns={refColumns}
              rows={refs}
              rowKey={(r) => r.id}
              loading={refsLoading}
              skeletonRows={6}
              height="max-h-[34rem]"
              itemLabel="referrals"
              empty={
                <EmptyState
                  icon={<Share2 className="size-8" aria-hidden="true" />}
                  title="No referrals yet"
                  hint="Doctors refer beneficiaries to hospitals for higher care from the doctor portal — track the outcomes here."
                />
              }
            />
          )}
        </TabsContent>

        {/* FOLLOW-UPS */}
        <TabsContent value="follow-ups" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <FilterChips
              label="Filter follow-ups"
              options={["ALL", "PENDING", "OVERDUE", "DONE", "MISSED"]}
              value={fupFilter}
              onChange={setFupFilter}
            />
            <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {fupsLoading ? (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                `${fupVisible.length} follow-up${fupVisible.length === 1 ? "" : "s"}`
              )}
              {overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}
            </span>
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <ExportMenu columns={fupCsv} rows={fupVisible} filename="uar-follow-ups" disabled={fupVisible.length === 0} />
            </div>
          </div>

          {fupsError ? (
            <EmptyState icon={<CalendarClock className="size-8" aria-hidden="true" />} title="Follow-ups could not load" hint={fupsError}>
              <Button variant="outline" size="sm" className="min-h-11" onClick={loadFups}>
                Retry
              </Button>
            </EmptyState>
          ) : (
            <DataTable
              columns={fupColumns}
              rows={fupVisible}
              rowKey={(f) => f.id}
              loading={fupsLoading}
              skeletonRows={6}
              height="max-h-[34rem]"
              itemLabel="follow-ups"
              empty={
                <EmptyState
                  icon={<CalendarClock className="size-8" aria-hidden="true" />}
                  title={fupFilter !== "ALL" ? "No follow-ups in this view" : "No follow-ups scheduled"}
                  hint="Follow-ups are generated after camp consultations and referrals so no patient falls through the cracks."
                />
              }
            />
          )}
        </TabsContent>
      </Tabs>

      {/* outcome FormSheet */}
      <FormSheet
        open={!!outcomeTarget}
        onOpenChange={(o) => {
          if (!o) setOutcomeTarget(null);
        }}
        title={outcomeNext === "DONE" ? "Complete follow-up" : "Mark follow-up missed"}
        description={outcomeTarget ? `${outcomeTarget.beneficiary?.name ?? "Beneficiary"} · due ${formatDateTime(outcomeTarget.dueAt)}` : undefined}
        size="sm"
        submitLabel={outcomeNext === "DONE" ? "Mark done" : "Mark missed"}
        loading={acting}
        dirty={!!outcome.trim()}
        onSubmit={runOutcome}
      >
        <FormSection title="Outcome" description="What happened — kept on the beneficiary timeline.">
          <FieldGrid cols={1}>
            <TextField
              label="Outcome"
              value={outcome}
              onChange={setOutcome}
              placeholder={outcomeNext === "DONE" ? "e.g. Spoke to patient, BP stable on medication" : "e.g. Unreachable on 3 attempts"}
            />
          </FieldGrid>
        </FormSection>
      </FormSheet>
    </div>
  );
}
