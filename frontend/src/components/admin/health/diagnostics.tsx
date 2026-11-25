"use client";

/**
 * Health Programme — Diagnostics tab (lab orders pipeline).
 *
 * Pipeline strip with per-status counts + filter, orders table with critical
 * badge, result text entry, result file upload via FilePickButton (writes
 * resultFileUrl), and per-role review actions (verify/review → status
 * advance). Status flow: ORDERED → SAMPLE_COLLECTED → RECEIVED → PROCESSING
 * → RESULT_AVAILABLE → VERIFIED → DOCTOR_REVIEWED (CANCELLABLE) — matching
 * the lab-orders backend contract.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FlaskConical, MoreHorizontal, Paperclip, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { get, patch } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { humanize, StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { FormSection, TextareaField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { FilePickButton, fileUrl } from "@/components/shared/file-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TabProps } from "./overview";
import {
  asPaged,
  CampSelect,
  errorText,
  LAB_FLOW,
  LAB_TONE,
  useDebounced,
  type LabOrderRow,
} from "./shared";

export default function DiagnosticsTab({ revision }: TabProps) {
  const [rows, setRows] = useState<LabOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const [status, setStatus] = useState("ALL");
  const [campId, setCampId] = useState("ALL");

  const [resultTarget, setResultTarget] = useState<LabOrderRow | null>(null);
  const [resultText, setResultText] = useState("");
  const [resultFileUrl, setResultFileUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (status !== "ALL") sp.set("status", status);
      if (campId !== "ALL") sp.set("campId", campId);
      const d = await get<unknown>(`/api/lab-orders?${sp.toString()}`);
      const list = asPaged<LabOrderRow>(d).items.slice();
      // critical first, then pipeline order
      list.sort((a, b) => {
        if (!!a.critical !== !!b.critical) return a.critical ? -1 : 1;
        return LAB_FLOW.indexOf(a.status) - LAB_FLOW.indexOf(b.status);
      });
      setRows(list);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [q, status, campId]);

  useEffect(() => {
    load();
  }, [load, revision]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const patchOrder = useCallback(
    async (row: LabOrderRow, body: Record<string, unknown>, msg: string) => {
      try {
        await patch(`/api/lab-orders/${row.id}`, body);
        toast.success(msg);
        await load();
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    [load]
  );

  const saveResult = async () => {
    if (!resultTarget) return;
    if (!resultText.trim() && !resultFileUrl) {
      toast.error("Add a result summary or attach a report file");
      return;
    }
    setSaving(true);
    try {
      await patch(`/api/lab-orders/${resultTarget.id}`, {
        resultText: resultText.trim() || undefined,
        resultFileUrl: resultFileUrl || undefined,
        status: "COMPLETED",
      });
      toast.success("Result recorded — order completed");
      setResultTarget(null);
      setResultText("");
      setResultFileUrl("");
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const csv: CsvColumn<LabOrderRow>[] = useMemo(
    () => [
      { header: "Test", value: (l) => l.test ?? "" },
      { header: "Beneficiary", value: (l) => l.beneficiary?.name ?? "" },
      { header: "Camp", value: (l) => l.camp?.title ?? "" },
      { header: "Status", value: (l) => l.status },
      { header: "Critical", value: (l) => (l.critical ? "yes" : "no") },
      { header: "Result", value: (l) => l.resultText ?? "" },
      { header: "Result file", value: (l) => l.resultFileUrl ?? "" },
      { header: "Ordered", value: (l) => (l.createdAt ? formatDateTime(l.createdAt) : "") },
    ],
    []
  );

  const columns: DataTableColumn<LabOrderRow>[] = [
    {
      key: "test",
      header: "Test",
      accessor: (l) => (
        <div className="flex min-w-0 items-center gap-2">
          {l.critical ? (
            <Badge variant="outline" className="gap-1 border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300">
              <TriangleAlert className="size-3" aria-hidden="true" /> Critical
            </Badge>
          ) : null}
          <div className="min-w-0">
            <p className="truncate font-medium">{l.test ?? "Lab order"}</p>
            <p className="truncate text-xs text-muted-foreground">{l.beneficiary?.name ?? "—"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "camp",
      header: "Camp",
      hideBelow: "md",
      accessor: (l) => <span className="block max-w-44 truncate text-sm">{l.camp?.title ?? "—"}</span>,
    },
    {
      key: "result",
      header: "Result",
      hideBelow: "lg",
      accessor: (l) =>
        l.resultFileUrl ? (
          <a
            href={l.resultFileUrl.startsWith("/") ? l.resultFileUrl : fileUrl(l.resultFileUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Report file
          </a>
        ) : l.resultText ? (
          <span className="block max-w-56 truncate text-xs text-muted-foreground">{l.resultText}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    { key: "status", header: "Status", accessor: (l) => <StatusBadge status={l.status} tone={LAB_TONE[l.status]} /> },
    {
      key: "when",
      header: "Ordered",
      hideBelow: "sm",
      accessor: (l) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {l.createdAt ? formatDateTime(l.createdAt) : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12",
      accessor: (l) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${l.test ?? "lab order"}`}>
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {humanize(l.status)}
              </DropdownMenuLabel>
              {nextStep(l.status).map((s) => (
                <DropdownMenuItem key={s} onClick={() => patchOrder(l, { status: s }, `Marked ${humanize(s)}`)}>
                  <Check className="size-4" aria-hidden="true" /> Advance to {humanize(s)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onClick={() => {
                  setResultTarget(l);
                  setResultText(l.resultText ?? "");
                  setResultFileUrl(l.resultFileUrl ?? "");
                }}
              >
                <Paperclip className="size-4" aria-hidden="true" /> {l.resultFileUrl || l.resultText ? "Edit result" : "Record result…"}
              </DropdownMenuItem>
              {l.critical ? (
                <DropdownMenuItem onClick={() => patchOrder(l, { critical: false }, "Unflagged critical")}>
                  <Check className="size-4" aria-hidden="true" /> Unflag critical
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                  onClick={() => patchOrder(l, { critical: true }, "Flagged critical")}
                >
                  <TriangleAlert className="size-4" aria-hidden="true" /> Flag critical
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const filtersActive = q !== "" || status !== "ALL" || campId !== "ALL";

  return (
    <div className="space-y-4">
      {/* pipeline strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Lab orders pipeline">
        {LAB_FLOW.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(status === s ? "ALL" : s)}
            className="rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/40 aria-pressed:border-primary aria-pressed:bg-primary/5"
          >
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <StatusBadge status={s} tone={LAB_TONE[s]} />
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums">{counts[s] ?? 0}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-56">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lab orders…"
            aria-label="Search lab orders"
            className="h-11 w-full rounded-md border bg-background px-3 text-sm sm:h-9"
          />
        </div>
        <div className="min-w-56">
          <CampSelect value={campId} onChange={setCampId} allowAll placeholder="All camps" />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${rows.length} order${rows.length === 1 ? "" : "s"}`}
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ExportMenu columns={csv} rows={rows} filename="uar-lab-orders" disabled={rows.length === 0} />
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={<FlaskConical className="size-8" aria-hidden="true" />}
          title="Lab orders could not load"
          hint={error}
        >
          <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
            Retry
          </Button>
        </EmptyState>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(l) => l.id}
          loading={loading}
          skeletonRows={8}
          height="fill"
          fillOffset={520}
          itemLabel="lab orders"
          empty={
            <EmptyState
              icon={<FlaskConical className="size-8" aria-hidden="true" />}
              title={filtersActive ? "No lab orders match these filters" : "No lab orders yet"}
              hint="Doctors raise lab orders from the doctor portal — phlebotomy and results flow through this pipeline."
            />
          }
        />
      )}

      {/* result FormSheet */}
      <FormSheet
        open={!!resultTarget}
        onOpenChange={(o) => {
          if (!o) setResultTarget(null);
        }}
        title="Record lab result"
        description={resultTarget ? `${resultTarget.test ?? "Lab order"} · ${resultTarget.beneficiary?.name ?? ""}` : undefined}
        size="md"
        submitLabel="Save result & complete"
        loading={saving}
        dirty={!!resultText.trim() || !!resultFileUrl}
        onSubmit={saveResult}
      >
        <FormSection title="Result" description="Completing the order notifies the consulting doctor.">
          <TextareaField
            label="Result summary"
            value={resultText}
            onChange={setResultText}
            rows={4}
            placeholder="e.g. Hb 11.2 g/dL, WBC normal — no anaemia"
          />
          <div className="flex flex-wrap items-center gap-3">
            <FilePickButton
              label={resultFileUrl ? "Replace report file" : "Attach report file"}
              folder="lab-results"
              onPicked={(files) => {
                if (files[0]) {
                  setResultFileUrl(fileUrl(files[0].id));
                  toast.success("Report attached");
                }
              }}
            />
            {resultFileUrl ? (
              <Badge variant="outline" className="max-w-56 truncate border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                {resultFileUrl}
              </Badge>
            ) : null}
          </div>
        </FormSection>
      </FormSheet>
    </div>
  );
}

/** One-step advance through the lab pipeline. */
function nextStep(status: string): string[] {
  const i = LAB_FLOW.indexOf(status);
  if (i < 0 || i >= LAB_FLOW.length - 2) return []; // terminal states (COMPLETED, CANCELLED)
  return [LAB_FLOW[i + 1]];
}
