"use client";

/**
 * Lab technician tab — order queue with a status pipeline
 * (SAMPLE_COLLECTED → RECEIVED → PROCESSING → RESULT_AVAILABLE → VERIFIED),
 * result entry (text + PDF/image report upload) and critical-value flagging.
 * DOCTOR_REVIEWED is displayed read-only once the doctor signs off.
 */

import { useCallback, useEffect, useState } from "react";
import { FlaskConical, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch } from "@/lib/api-client";
import { nextLabOrderStep } from "@/lib/lab-orders";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormSheet } from "@/components/shared/form-sheet";
import { FieldGrid, TextareaField } from "@/components/shared/form-fields";
import { FilePickButton, fileUrl } from "@/components/shared/file-picker";
import { Button } from "@/components/ui/button";
import {
  ageSexLine,
  asArray,
  ListSkeleton,
  medTone,
  QuietEmpty,
  toastError,
  type LabOrderRow,
} from "./shared";
import { useRowBusy } from "@/hooks/use-row-busy";


const FILTERS = ["ALL", "ORDERED", "SAMPLE_COLLECTED", "RECEIVED", "PROCESSING", "RESULT_AVAILABLE", "VERIFIED", "DOCTOR_REVIEWED"];

interface ResultForm {
  resultText: string;
  resultFileUrl: string;
  resultFileName: string;
}

export default function LabTechQueue({ user }: { user: SessionUser }) {
  const [rows, setRows] = useState<LabOrderRow[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { busyId, setBusyId } = useRowBusy();

  const [target, setTarget] = useState<LabOrderRow | null>(null);
  const [form, setForm] = useState<ResultForm>({ resultText: "", resultFileUrl: "", resultFileName: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<unknown>("/api/lab-orders");
      setRows(asArray<LabOrderRow>(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the lab queue");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const advance = async (row: LabOrderRow) => {
    const next = nextLabOrderStep(row.status);
    if (!next) return;
    // Result entry opens the FormSheet instead of advancing directly.
    if (next.status === "RESULT_AVAILABLE") {
      setForm({
        resultText: row.resultText ?? "",
        resultFileUrl: row.resultFileUrl ?? "",
        resultFileName: "",
      });
      setTarget(row);
      return;
    }
    setBusyId(row.id);
    try {
      await patch(`/api/lab-orders/${row.id}`, { status: next.status });
      toast.success(next.label);
      await load();
    } catch (e) {
      toastError(e, "Could not update the order");
    } finally {
      setBusyId(null);
    }
  };

  const saveResult = async () => {
    if (!target) return;
    if (!form.resultText.trim() && !form.resultFileUrl) {
      toast.error("Add the result text or attach a report");
      return;
    }
    setSaving(true);
    try {
      await patch(`/api/lab-orders/${target.id}`, {
        status: "RESULT_AVAILABLE",
        resultText: form.resultText.trim() || undefined,
        resultFileUrl: form.resultFileUrl || undefined,
      });
      toast.success("Result saved — the doctor can now review it");
      setTarget(null);
      await load();
    } catch (e) {
      toastError(e, "Could not save the result");
    } finally {
      setSaving(false);
    }
  };

  const filtered = rows.filter((r) => filter === "ALL" || (r.status ?? "").toUpperCase() === filter);
  const pending = rows.filter((r) => !["VERIFIED", "DOCTOR_REVIEWED"].includes((r.status ?? "").toUpperCase()));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lab queue"
        description={`${pending.length} order${pending.length === 1 ? "" : "s"} in the pipeline — collect, process, enter results, verify.`}
        icon={<FlaskConical className="size-5" />}
        actions={
          <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={load} aria-label="Refresh lab queue">
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter orders by status">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`min-h-11 rounded-full border px-3.5 py-1.5 text-xs font-medium transition sm:min-h-9 ${
              filter === f ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"
            }`}
          >
            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase().replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <SectionCard title="Orders" description="Work each order down the pipeline" icon={<FlaskConical className="size-5" />}>
        {loading ? (
          <ListSkeleton rows={4} />
        ) : filtered.length === 0 ? (
          <QuietEmpty
            icon={<FlaskConical className="size-5" />}
            title={filter === "ALL" ? "No lab orders in the queue" : "No orders with this status"}
            error={error}
          />
        ) : (
          <ul className="max-h-[32rem] divide-y overflow-y-auto scrollbar-thin">
            {filtered.map((row) => {
              const candidate = nextLabOrderStep(row.status);
              // Doctor review is a separate role-gated transition; lab techs
              // should never be shown an action that the API returns 403 for.
              const next = user.role === "LAB_TECH" && candidate?.status === "DOCTOR_REVIEWED"
                ? null
                : candidate;
              return (
                <li key={row.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {row.testName || "Laboratory test"}
                      {row.critical && (
                        <span className="ml-2 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-red-600 dark:text-red-400">
                          Critical
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.beneficiary ? `${row.beneficiary.name} · ${ageSexLine(row.beneficiary)}` : "Patient"}
                      {row.createdAt ? ` · ${formatDateTime(row.createdAt)}` : ""}
                    </p>
                    {row.resultText && (
                      <p className="mt-1.5 rounded-md bg-muted/60 p-2 text-xs leading-relaxed">{row.resultText}</p>
                    )}
                  </div>
                  <StatusBadge status={row.status} tone={medTone(row.status)} />
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    {row.resultFileUrl && (
                      <a
                        href={row.resultFileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition hover:bg-accent sm:min-h-9"
                        aria-label="Open lab report"
                      >
                        Report
                      </a>
                    )}
                    {next && row.status !== "DOCTOR_REVIEWED" && (
                      <Button
                        size="sm"
                        className="min-h-11 gap-1.5 sm:min-h-9"
                        disabled={busyId !== null}
                        onClick={() => void advance(row)}
                      >
                        {next.label}
                      </Button>
                    )}
                    {row.status === "DOCTOR_REVIEWED" && (
                      <span className="text-xs text-muted-foreground">Doctor reviewed — done</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* Result entry FormSheet */}
      <FormSheet
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Enter result"
        description={target ? `${target.testName ?? "Laboratory test"} · ${target.beneficiary?.name ?? "Patient"}` : undefined}
        size="md"
        submitLabel="Save result"
        onSubmit={saveResult}
        loading={saving}
        dirty={form.resultText !== "" || form.resultFileUrl !== ""}
      >
        <TextareaField
          label="Result text"
          rows={5}
          value={form.resultText}
          onChange={(v) => setForm((f) => ({ ...f, resultText: v }))}
          placeholder="e.g. HbA1c 8.4% (elevated); fasting glucose 168 mg/dL…"
        />
        <FieldGrid>
          <div className="sm:col-span-2">
            <p className="mb-2 text-xs font-medium">Report file (PDF or image)</p>
            {form.resultFileUrl ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
                <span className="truncate text-sm">{form.resultFileName || "Report attached"}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-11"
                  onClick={() => setForm((f) => ({ ...f, resultFileUrl: "", resultFileName: "" }))}
                  aria-label="Remove attached report"
                >
                  ×
                </Button>
              </div>
            ) : (
              <FilePickButton
                label="Attach report"
                accept="application/pdf,image/*"
                folder="lab-reports"
                onPicked={(files) => {
                  const f = files[0];
                  if (!f) return;
                  setForm((prev) => ({ ...prev, resultFileUrl: fileUrl(f.id), resultFileName: f.name }));
                }}
              />
            )}
          </div>
        </FieldGrid>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Upload className="size-3.5 shrink-0" aria-hidden="true" />
          After saving, verify the result — then the ordering doctor reviews it.
        </p>
      </FormSheet>
    </div>
  );
}
