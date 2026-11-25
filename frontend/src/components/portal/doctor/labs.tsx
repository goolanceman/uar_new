"use client";

/**
 * Doctor portal — Lab Orders. Tests the doctor has ordered for patients:
 * order new tests, review verified results (DOCTOR_REVIEWED) and open the
 * uploaded report.
 */

import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Plus, RefreshCw, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch, post } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormSheet } from "@/components/shared/form-sheet";
import { FieldGrid, TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ageSexLine,
  asArray,
  ListSkeleton,
  medTone,
  QuietEmpty,
  toastError,
  useBeneficiarySearch,
  type BeneficiaryLite,
  type LabOrderRow,
} from "./shared";
import { useRowBusy } from "@/hooks/use-row-busy";

interface OrderForm {
  testName: string;
}

export default function DoctorLabs({ user }: { user: SessionUser }) {
  const [rows, setRows] = useState<LabOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { busyId, setBusyId } = useRowBusy();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<OrderForm>({ testName: "" });
  const search = useBeneficiarySearch();
  const [picked, setPicked] = useState<BeneficiaryLite | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<unknown>("/api/lab-orders");
      setRows(asArray<LabOrderRow>(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load lab orders");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openSheet = () => {
    setForm({ testName: "" });
    setPicked(null);
    search.setQ("");
    setSheetOpen(true);
  };

  const save = async () => {
    if (!picked) {
      toast.error("Pick a patient first");
      return;
    }
    if (!form.testName.trim()) {
      toast.error("Enter the test name");
      return;
    }
    setSaving(true);
    try {
      await post("/api/lab-orders", {
        beneficiaryId: picked.id,
        testName: form.testName.trim(),
      });
      toast.success("Test ordered — the lab queue will pick it up");
      setSheetOpen(false);
      await load();
    } catch (e) {
      toastError(e, "Could not order the test");
    } finally {
      setSaving(false);
    }
  };

  const review = async (row: LabOrderRow) => {
    setBusyId(row.id);
    try {
      await patch(`/api/lab-orders/${row.id}`, { status: "DOCTOR_REVIEWED" });
      toast.success("Result marked reviewed");
      await load();
    } catch (e) {
      toastError(e, "Could not mark the result reviewed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lab orders"
        description="Tests you've ordered — review verified results and open reports."
        icon={<FlaskConical className="size-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={load} aria-label="Refresh lab orders">
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
            <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={openSheet}>
              <Plus className="size-4" aria-hidden="true" />
              Order a test
            </Button>
          </>
        }
      />

      <SectionCard title="My ordered tests" description="Pipeline: collected → received → processing → result → your review" icon={<FlaskConical className="size-5" />}>
        {loading ? (
          <ListSkeleton rows={4} />
        ) : rows.length === 0 ? (
          <QuietEmpty
            icon={<FlaskConical className="size-5" />}
            title="No lab orders yet"
            error={error}
          >
            <Button className="min-h-11 gap-1.5" onClick={openSheet}>
              <Plus className="size-4" aria-hidden="true" />
              Order the first test
            </Button>
          </QuietEmpty>
        ) : (
          <ul className="max-h-[32rem] divide-y overflow-y-auto scrollbar-thin">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {row.code ? `${row.code} · ` : ""}
                    {row.testName || "Laboratory test"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.beneficiary ? `${row.beneficiary.name} · ${ageSexLine(row.beneficiary)}` : "Patient"}
                    {row.createdAt ? ` · ${formatDateTime(row.createdAt)}` : ""}
                  </p>
                  {row.resultText && (
                    <p className="mt-1.5 rounded-md bg-muted/60 p-2 text-xs leading-relaxed" aria-label="Lab result">
                      {row.resultText}
                    </p>
                  )}
                  {row.critical && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400" role="alert">
                      <X className="size-3.5 shrink-0" aria-hidden="true" />
                      Critical value — act immediately
                    </p>
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
                  {row.status === "VERIFIED" && (
                    <Button
                      size="sm"
                      className="min-h-11 gap-1.5 sm:min-h-9"
                      disabled={busyId !== null}
                      onClick={() => void review(row)}
                    >
                      Mark reviewed
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Order FormSheet */}
      <FormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Order a lab test"
        description="The lab technician queue processes tests in order of priority."
        size="md"
        submitLabel="Order test"
        onSubmit={save}
        loading={saving}
        dirty={!!picked || form.testName !== ""}
      >
        {picked ? (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
            <Users className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{picked.name}</p>
              <p className="truncate text-xs text-muted-foreground">{ageSexLine(picked)}</p>
            </div>
            <Button type="button" size="icon" variant="ghost" className="size-11" onClick={() => setPicked(null)} aria-label="Change patient">
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <>
            <Input
              type="search"
              value={search.q}
              onChange={(e) => search.setQ(e.target.value)}
              placeholder="Search patient by name, phone or code…"
              aria-label="Search patients"
              className="h-11"
            />
            {search.results.length > 0 && (
              <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border scrollbar-thin">
                {search.results.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(b)}
                      className="flex w-full min-h-11 flex-col justify-center px-3 py-2.5 text-left transition hover:bg-accent"
                    >
                      <span className="block truncate text-sm font-medium">{b.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{ageSexLine(b)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {search.q.trim().length >= 2 && !search.loading && search.results.length === 0 && (
              <p className="text-xs text-muted-foreground">No patients match — check the spelling or phone number.</p>
            )}
          </>
        )}

        <FieldGrid>
          <TextField
            label="Test name"
            required
            value={form.testName}
            onChange={(v) => setForm((f) => ({ ...f, testName: v }))}
            placeholder="e.g. HbA1c, Lipid profile"
            className="sm:col-span-2"
          />
        </FieldGrid>
      </FormSheet>
    </div>
  );
}
