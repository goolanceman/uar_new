"use client";

/**
 * Health Programme — Prescriptions tab (admin oversight).
 *
 * Prescribing happens in the doctor portal; here admins review the
 * prescriptions feed: status pills, DetailSheet with items table + dispense
 * history, print (server-rendered print HTML in a new tab) and cancel with
 * reason. Read-only on items — only CANCELLED is patched from here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pill, Printer, X } from "lucide-react";
import { toast } from "sonner";
import { get, patch } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { humanize, StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { DetailGrid, DetailSection, DetailSheet } from "@/components/shared/detail-sheet";
import { DataField } from "@/components/shared/data-field";
import { FormSection, TextareaField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import type { TabProps } from "./overview";
import {
  asPaged,
  CampSelect,
  errorText,
  FilterChips,
  RX_TONE,
  useDebounced,
  type PrescriptionRow,
} from "./shared";

const RX_FILTERS = ["ALL", "ACTIVE", "PARTIALLY_DISPENSED", "FULLY_DISPENSED", "CANCELLED"];

export default function PrescriptionsTab({ revision }: TabProps) {
  const [rows, setRows] = useState<PrescriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const [status, setStatus] = useState("ALL");
  const [campId, setCampId] = useState("ALL");

  const [detail, setDetail] = useState<PrescriptionRow | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<PrescriptionRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set("q", q);
      if (status !== "ALL") sp.set("status", status);
      if (campId !== "ALL") sp.set("campId", campId);
      const d = await get<unknown>(`/api/prescriptions?${sp.toString()}`);
      setRows(asPaged<PrescriptionRow>(d).items);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [q, status, campId]);

  useEffect(() => {
    load();
  }, [load, revision]);

  const openDetail = useCallback(
    async (id: string) => {
      setDetailId(id);
      setDetailLoading(true);
      try {
        const d = await get<PrescriptionRow>(`/api/prescriptions/${id}`);
        setDetail(d);
      } catch {
        // fall back to the row we already have (list payloads include items + dispenses)
        setDetail(rows.find((r) => r.id === id) ?? null);
      } finally {
        setDetailLoading(false);
      }
    },
    [rows]
  );

  const runCancel = async () => {
    if (!cancelTarget) return;
    setActing(true);
    try {
      await patch(`/api/prescriptions/${cancelTarget.id}`, {
        status: "CANCELLED",
        cancelReason: cancelReason.trim() || undefined,
      });
      toast.success("Prescription cancelled");
      setCancelTarget(null);
      setCancelReason("");
      setDetailId(null);
      setDetail(null);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setActing(false);
    }
  };

  const print = (rx: PrescriptionRow) => {
    window.open(`/api/prescriptions/${rx.id}/print`, "_blank", "noopener,noreferrer");
  };

  const csv: CsvColumn<PrescriptionRow>[] = useMemo(
    () => [
      { header: "Code", value: (r) => r.code ?? r.id },
      { header: "Beneficiary", value: (r) => r.beneficiary?.name ?? "" },
      { header: "Doctor", value: (r) => r.doctor?.name ?? "" },
      { header: "Camp", value: (r) => r.camp?.title ?? "" },
      { header: "Status", value: (r) => r.status },
      { header: "Items", value: (r) => itemsOf(r).length },
      { header: "Dispenses", value: (r) => (r.dispenses ?? []).length },
      { header: "Created", value: (r) => (r.createdAt ? formatDateTime(r.createdAt) : "") },
      { header: "Cancel reason", value: (r) => r.cancelReason ?? "" },
    ],
    []
  );

  const columns: DataTableColumn<PrescriptionRow>[] = [
    {
      key: "rx",
      header: "Prescription",
      accessor: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.beneficiary?.name ?? "—"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[r.code, r.doctor?.name].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      ),
    },
    {
      key: "camp",
      header: "Camp",
      hideBelow: "md",
      accessor: (r) => <span className="block max-w-48 truncate text-sm">{r.camp?.title ?? "—"}</span>,
    },
    {
      key: "items",
      header: "Medicines",
      hideBelow: "lg",
      accessor: (r) => (
        <span className="text-xs text-muted-foreground">
          {itemsOf(r).length} medicine{itemsOf(r).length === 1 ? "" : "s"}
        </span>
      ),
    },
    { key: "status", header: "Status", accessor: (r) => <StatusBadge status={r.status} tone={RX_TONE[r.status]} /> },
    {
      key: "when",
      header: "Prescribed",
      hideBelow: "sm",
      accessor: (r) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {r.createdAt ? formatDateTime(r.createdAt) : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-20",
      accessor: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {r.status !== "CANCELLED" ? (
            <Button variant="ghost" size="icon" className="size-8" aria-label={`Print prescription ${r.code ?? ""}`} onClick={() => print(r)}>
              <Printer className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" className="size-8" aria-label={`View prescription ${r.code ?? ""}`} onClick={() => openDetail(r.id)}>
            <Pill className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ),
    },
  ];

  const filtersActive = q !== "" || status !== "ALL" || campId !== "ALL";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-56">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prescriptions…"
            aria-label="Search prescriptions"
            className="h-11 sm:h-9"
          />
        </div>
        <FilterChips label="Filter prescriptions by status" options={RX_FILTERS} value={status} onChange={setStatus} />
        <div className="min-w-56">
          <CampSelect value={campId} onChange={setCampId} allowAll placeholder="All camps" />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${rows.length} prescription${rows.length === 1 ? "" : "s"}`}
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ExportMenu columns={csv} rows={rows} filename="uar-prescriptions" disabled={rows.length === 0} />
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={<Pill className="size-8" aria-hidden="true" />}
          title="Prescriptions could not load"
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
          rowKey={(r) => r.id}
          loading={loading}
          skeletonRows={8}
          height="fill"
          fillOffset={420}
          onRowClick={(r) => openDetail(r.id)}
          itemLabel="prescriptions"
          empty={
            <EmptyState
              icon={<Pill className="size-8" aria-hidden="true" />}
              title={filtersActive ? "No prescriptions match these filters" : "No prescriptions yet"}
              hint="Doctors write prescriptions in the doctor portal during camp consultations — the feed appears here for oversight and printing."
            />
          }
        />
      )}

      {/* detail sheet */}
      <DetailSheet
        open={!!detailId}
        onOpenChange={(o) => {
          if (!o) {
            setDetailId(null);
            setDetail(null);
          }
        }}
        eyebrow={`Prescription · ${detail?.code ?? ""}`}
        title={detail?.beneficiary?.name ?? "Prescription"}
        description={detail ? [detail.doctor?.name, detail.camp?.title].filter(Boolean).join(" · ") : undefined}
        status={detail ? <StatusBadge status={detail.status} tone={RX_TONE[detail.status]} /> : null}
        loading={detailLoading && !detail}
        actions={
          detail && detail.status !== "CANCELLED" ? (
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="min-h-9" onClick={() => print(detail)}>
                <Printer className="size-3.5" aria-hidden="true" /> Print
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                onClick={() => {
                  setCancelTarget(detail);
                  setCancelReason("");
                }}
              >
                <X className="size-3.5" aria-hidden="true" /> Cancel
              </Button>
            </div>
          ) : null
        }
      >
        {detail ? (
          <>
            <DetailSection title="Details">
              <DetailGrid cols={3}>
                <DataField label="Beneficiary" value={detail.beneficiary?.name ?? null} />
                <DataField label="Doctor" value={detail.doctor?.name ?? null} />
                <DataField label="Camp" value={detail.camp?.title ?? null} />
                <DataField label="Prescribed" value={detail.createdAt ? formatDateTime(detail.createdAt) : null} />
                <DataField label="Status" value={<StatusBadge status={detail.status} tone={RX_TONE[detail.status]} />} />
                <DataField label="Cancel reason" value={detail.cancelReason ?? null} />
              </DetailGrid>
            </DetailSection>

            <DetailSection title="Medicines" description="What the doctor ordered.">
              {itemsOf(detail).length === 0 ? (
                <p className="text-sm text-muted-foreground">No line items recorded.</p>
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/70">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Medicine</th>
                        <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dose</th>
                        <th scope="col" className="hidden px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">Frequency</th>
                        <th scope="col" className="hidden px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:table-cell">Duration</th>
                        <th scope="col" className="hidden px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:table-cell">Instructions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemsOf(detail).map((it, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2 font-medium">{it.name ?? "—"}</td>
                          <td className="px-3 py-2">{it.dose ?? "—"}</td>
                          <td className="hidden px-3 py-2 sm:table-cell">{it.frequency ?? "—"}</td>
                          <td className="hidden px-3 py-2 md:table-cell">{it.duration ?? "—"}</td>
                          <td className="hidden max-w-56 truncate px-3 py-2 text-muted-foreground lg:table-cell">
                            {it.instructions ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DetailSection>

            <DetailSection title="Dispense history" description="Fulfilled by the pharmacist portal — read-only here.">
              {(detail.dispenses ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing dispensed yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(detail.dispenses ?? []).map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        {d.itemName ?? "Medicine"} {d.quantity ? `· ${d.quantity}` : ""}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {[d.by, d.dispensedAt ? formatDateTime(d.dispensedAt) : ""].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>
          </>
        ) : null}
      </DetailSheet>

      {/* cancel with reason */}
      <FormSheet
        open={!!cancelTarget}
        onOpenChange={(o) => {
          if (!o) setCancelTarget(null);
        }}
        title="Cancel prescription"
        description="Only cancel for clinical safety reasons — the pharmacist sees cancellations immediately."
        size="sm"
        submitLabel="Cancel prescription"
        loading={acting}
        dirty={!!cancelReason.trim()}
        onSubmit={runCancel}
      >
        <FormSection title="Reason">
          <TextareaField
            label="Cancellation reason"
            value={cancelReason}
            onChange={setCancelReason}
            rows={3}
            placeholder="e.g. Duplicate issued, wrong dosage transcribed…"
          />
        </FormSection>
      </FormSheet>
    </div>
  );
}

/** Prescription items may arrive as an array or a JSON string. */
function itemsOf(rx: PrescriptionRow | null): Array<{ name?: string | null; dose?: string | null; frequency?: string | null; duration?: string | null; instructions?: string | null }> {
  if (!rx?.items) return [];
  if (Array.isArray(rx.items)) return rx.items;
  try {
    const parsed = JSON.parse(rx.items);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [{ name: String(rx.items) }];
  }
}
