"use client";

/**
 * Health Programme — Registrations tab (global register).
 *
 * Cross-camp registration list: camp filter (CampSelect), status chips,
 * CSV export, quick-register flow (camp select + beneficiary search +
 * registeredVia). Confirm/cancel actions patch individual registrations.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ClipboardList, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { get, patch, post } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { humanize, StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SelectField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import type { TabProps } from "./overview";
import {
  asPaged,
  BeneficiarySearch,
  CampSelect,
  errorText,
  FilterChips,
  REGISTER_VIA,
  useDebounced,
  type RegRow,
} from "./shared";

const REG_STATUSES = ["ALL", "PENDING", "CONFIRMED", "CANCELLED", "REJECTED"];

export default function RegistrationsTab({ revision }: TabProps) {
  const [rows, setRows] = useState<RegRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const [campId, setCampId] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const pageSize = 25;

  const [quickCamp, setQuickCamp] = useState("");
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [via, setVia] = useState("DESK");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (q) sp.set("q", q);
      if (campId !== "ALL") sp.set("campId", campId);
      if (status !== "ALL") sp.set("status", status);
      const d = await get<unknown>(`/api/camp-registrations?${sp.toString()}`);
      const p = asPaged<RegRow>(d);
      setRows(p.items);
      setTotal(p.total);
      setPages(Math.max(1, p.pages));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [q, campId, status, page]);

  useEffect(() => {
    load();
  }, [load, revision]);

  useEffect(() => {
    setPage(1);
  }, [q, campId, status]);

  const quickRegister = async () => {
    if (!quickCamp || !picked) {
      toast.error("Pick both a camp and a beneficiary");
      return;
    }
    setSaving(true);
    try {
      await post("/api/camp-registrations", { campId: quickCamp, beneficiaryId: picked.id, registeredVia: via });
      toast.success("Beneficiary registered");
      setPicked(null);
      await load();
    } catch (e) {
      toast.error(errorText(e)); // duplicate / capacity 409 messages surface here
    } finally {
      setSaving(false);
    }
  };

  const setStatusOn = useCallback(
    async (row: RegRow, next: string) => {
      try {
        await patch(`/api/camp-registrations/${row.id}`, { status: next });
        toast.success(`Registration ${next.toLowerCase()}`);
        await load();
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    [load]
  );

  const csv: CsvColumn<RegRow>[] = useMemo(
    () => [
      { header: "Code", value: (r) => r.code ?? "" },
      { header: "Camp", value: (r) => r.camp?.title ?? "" },
      { header: "Beneficiary", value: (r) => r.beneficiary?.name ?? "" },
      { header: "Phone", value: (r) => r.beneficiary?.phone ?? "" },
      { header: "Status", value: (r) => r.status },
      { header: "Registered via", value: (r) => r.registeredVia ?? "" },
      { header: "Registered at", value: (r) => (r.createdAt ? formatDateTime(r.createdAt) : "") },
    ],
    []
  );

  const columns: DataTableColumn<RegRow>[] = [
    {
      key: "beneficiary",
      header: "Beneficiary",
      accessor: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.beneficiary?.name ?? "—"}</p>
          <p className="truncate text-xs text-muted-foreground">{r.beneficiary?.phone || r.beneficiary?.code || "—"}</p>
        </div>
      ),
    },
    {
      key: "camp",
      header: "Camp",
      hideBelow: "sm",
      accessor: (r) => <span className="block max-w-52 truncate text-sm">{r.camp?.title ?? "—"}</span>,
    },
    { key: "code", header: "Reg. code", mono: true, hideBelow: "md", accessor: (r) => r.code || "—" },
    { key: "status", header: "Status", accessor: (r) => <StatusBadge status={r.status} /> },
    {
      key: "via",
      header: "Via",
      hideBelow: "lg",
      accessor: (r) => <span className="text-xs text-muted-foreground">{r.registeredVia ? humanize(r.registeredVia) : "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-24",
      accessor: (r) =>
        r.status === "PENDING" ? (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="size-8 text-emerald-600 dark:text-emerald-400" aria-label="Confirm registration" onClick={() => setStatusOn(r, "CONFIRMED")}>
              <Check className="size-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8 text-red-600 dark:text-red-400" aria-label="Cancel registration" onClick={() => setStatusOn(r, "CANCELLED")}>
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  const filtersActive = q !== "" || campId !== "ALL" || status !== "ALL";

  return (
    <div className="space-y-4">
      {/* quick register */}
      <div className="rounded-xl border bg-muted/30 p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Plus className="size-4 text-primary" aria-hidden="true" /> Quick register
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-56 flex-1">
            <CampSelect value={quickCamp} onChange={setQuickCamp} placeholder="Pick a camp…" />
          </div>
          <div className="min-w-56 flex-1">
            {picked ? (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-primary/5 px-3 py-2">
                <span className="truncate text-sm font-medium">{picked.label}</span>
                <Button variant="ghost" size="sm" className="h-8 px-2" aria-label="Clear selected beneficiary" onClick={() => setPicked(null)}>
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <BeneficiarySearch compact onPick={(b) => setPicked({ id: b.id, label: b.name })} placeholder="Search beneficiary…" />
            )}
          </div>
          <div className="w-40">
            <SelectField
              label=""
              value={via}
              onChange={setVia}
              options={REGISTER_VIA.map((v) => ({ value: v, label: humanize(v) }))}
            />
          </div>
          <Button className="min-h-11 sm:min-h-9" onClick={quickRegister} disabled={saving || !quickCamp || !picked}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
            Register
          </Button>
        </div>
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search registrations…"
            aria-label="Search registrations"
            className="h-11 sm:h-9"
          />
        </div>
        <div className="min-w-56">
          <CampSelect
            value={campId}
            onChange={setCampId}
            allowAll
            placeholder="All camps"
          />
        </div>
        <FilterChips label="Filter registrations by status" options={REG_STATUSES} value={status} onChange={setStatus} />
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${total} registration${total === 1 ? "" : "s"}`}
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ExportMenu columns={csv} rows={rows} filename="uar-camp-registrations" disabled={rows.length === 0} />
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={<ClipboardList className="size-8" aria-hidden="true" />}
          title="Registrations could not load"
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
          fillOffset={470}
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPage={setPage}
          itemLabel="registrations"
          empty={
            <EmptyState
              icon={<ClipboardList className="size-8" aria-hidden="true" />}
              title={filtersActive ? "No registrations match these filters" : "No camp registrations yet"}
              hint="Register beneficiaries from here or from a camp's desk — registrations turn into queue tokens at check-in."
            />
          }
        />
      )}
    </div>
  );
}
