"use client";

/**
 * Health Programme — Pharmacy tab (admin oversight).
 *
 *  - Medicine stock from /api/inventory?category=MEDICINE with low-stock and
 *    expiry highlights (expiry shown when the inventory row carries a date).
 *  - Stock receipts: /api/inventory-transactions feed + "Receive stock"
 *    FormSheet (POST type RECEIVED).
 *  - Dispense history: prescriptions feed filtered to dispensed states —
 *    dispensing itself happens in the pharmacist portal (read-only here).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Loader2,
  Package,
  PackageOpen,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { navigate } from "@/lib/router";
import { get, post } from "@/lib/api-client";
import { formatDateTime, formatINR } from "@/lib/format";
import { humanize, StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { FormSheet } from "@/components/shared/form-sheet";
import { FieldGrid, FormSection, SelectField, TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import type { TabProps } from "./overview";
import {
  asPaged,
  CampSelect,
  errorText,
  num,
  type InventoryTxRow,
  type InvItem,
  type PrescriptionRow,
} from "./shared";

export default function PharmacyTab({ revision }: TabProps) {
  const [sub, setSub] = useState("stock");

  /* stock */
  const [items, setItems] = useState<InvItem[] | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);

  /* receipts */
  const [txs, setTxs] = useState<InventoryTxRow[] | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txCamp, setTxCamp] = useState("ALL");

  /* receive stock sheet */
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  /* dispense oversight */
  const [rxs, setRxs] = useState<PrescriptionRow[] | null>(null);
  const [rxError, setRxError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStockError(null);
    setTxError(null);
    setRxError(null);
    const results = await Promise.allSettled([
      get<unknown>("/api/inventory?category=MEDICINE&limit=200"),
      get<unknown>(`/api/inventory-transactions?${txCamp !== "ALL" ? `campId=${txCamp}&` : ""}limit=100`),
      get<unknown>("/api/prescriptions?limit=100"),
    ]);
    const [stock, transactions, prescriptions] = results;
    if (stock.status === "fulfilled") {
      setItems(asPaged<InvItem>(stock.value).items);
    } else {
      setItems([]);
      setStockError(errorText(stock.reason));
    }
    if (transactions.status === "fulfilled") {
      setTxs(asPaged<InventoryTxRow>(transactions.value).items);
    } else {
      setTxs([]);
      setTxError(errorText(transactions.reason));
    }
    if (prescriptions.status === "fulfilled") {
      const list = asPaged<PrescriptionRow>(prescriptions.value).items;
      setRxs(list.filter((r) => ["PARTIALLY_DISPENSED", "FULLY_DISPENSED"].includes(r.status)));
    } else {
      setRxs([]);
      setRxError(errorText(prescriptions.reason));
    }
  }, [txCamp]);

  useEffect(() => {
    load();
  }, [load, revision]);

  const lowStock = useMemo(() => (items ?? []).filter((i) => num(i.minStock) > 0 && i.quantity <= num(i.minStock)), [items]);
  const expiring = useMemo(
    () => (items ?? []).filter((i) => i.expiryDate && new Date(i.expiryDate).getTime() < Date.now() + 90 * 86_400_000),
    [items]
  );
  const stockValue = useMemo(
    () => (items ?? []).reduce((s, i) => s + i.quantity * num(i.pricePerUnit), 0),
    [items]
  );

  const receive = async () => {
    if (!itemId || !qty) {
      toast.error("Pick a medicine and quantity");
      return;
    }
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Quantity must be a positive number");
      return;
    }
    setSaving(true);
    try {
      await post("/api/inventory-transactions", { type: "RECEIVED", itemId, quantity: n, notes: notes.trim() || undefined });
      toast.success("Stock received");
      setReceiveOpen(false);
      setItemId("");
      setQty("");
      setNotes("");
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const stockColumns: DataTableColumn<InvItem>[] = [
    {
      key: "name",
      header: "Medicine",
      accessor: (i) => {
        const low = num(i.minStock) > 0 && i.quantity <= num(i.minStock);
        const expired = i.expiryDate && new Date(i.expiryDate).getTime() < Date.now();
        return (
          <div className="flex min-w-0 items-center gap-2">
            {expired ? (
              <Badge variant="outline" className="shrink-0 gap-1 border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300">
                <TriangleAlert className="size-3" aria-hidden="true" /> Expired
              </Badge>
            ) : low ? (
              <Badge variant="outline" className="shrink-0 gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <TriangleAlert className="size-3" aria-hidden="true" /> Low
              </Badge>
            ) : null}
            <div className="min-w-0">
              <p className="truncate font-medium">{i.name}</p>
              <p className="truncate text-xs text-muted-foreground">{i.location || "—"}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "qty",
      header: "On hand",
      align: "right",
      accessor: (i) => (
        <span className="tabular-nums">
          {i.quantity} {i.unit ?? ""}
        </span>
      ),
    },
    {
      key: "min",
      header: "Min stock",
      align: "right",
      hideBelow: "md",
      accessor: (i) => <span className="tabular-nums text-muted-foreground">{num(i.minStock) || "—"}</span>,
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      mono: true,
      hideBelow: "lg",
      accessor: (i) => (i.pricePerUnit ? formatINR(i.quantity * num(i.pricePerUnit)) : "—"),
    },
    {
      key: "expiry",
      header: "Expiry",
      hideBelow: "lg",
      accessor: (i) => (i.expiryDate ? <StatusBadge status="EXPIRY" tone={new Date(i.expiryDate).getTime() < Date.now() ? "danger" : "warning"}>{String(i.expiryDate).slice(0, 10)}</StatusBadge> : "—"),
    },
  ];

  const txColumns: DataTableColumn<InventoryTxRow>[] = [
    {
      key: "item",
      header: "Medicine",
      accessor: (t) => <span className="truncate font-medium">{t.item?.name ?? t.itemId?.slice(-8) ?? "—"}</span>,
    },
    { key: "type", header: "Type", accessor: (t) => <StatusBadge status={t.type ?? "RECEIVED"} tone={t.type === "RECEIVED" ? "success" : "info"} /> },
    {
      key: "qty",
      header: "Qty",
      align: "right",
      mono: true,
      accessor: (t) => `${t.quantity ?? 0} ${t.item?.unit ?? ""}`,
    },
    {
      key: "when",
      header: "When",
      hideBelow: "sm",
      accessor: (t) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">{t.createdAt ? formatDateTime(t.createdAt) : "—"}</span>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      hideBelow: "lg",
      accessor: (t) => <span className="block max-w-56 truncate text-xs text-muted-foreground">{t.notes ?? "—"}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => navigate("/admin/distributions")}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Dispenses appear in the central Distributions ledger
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </button>
      </div>

      <Tabs value={sub} onValueChange={setSub}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto sm:flex-wrap">
          <TabsTrigger value="stock" className="shrink-0 gap-1.5">
            <Boxes className="size-3.5" aria-hidden="true" /> Medicine stock
          </TabsTrigger>
          <TabsTrigger value="receipts" className="shrink-0 gap-1.5">
            <PackageOpen className="size-3.5" aria-hidden="true" /> Stock receipts
          </TabsTrigger>
          <TabsTrigger value="dispense" className="shrink-0 gap-1.5">
            <CheckCircle2 className="size-3.5" aria-hidden="true" /> Dispense history
          </TabsTrigger>
        </TabsList>

        {/* STOCK */}
        <TabsContent value="stock" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <SectionCard title="Medicines" description="Distinct items in stock">
              <p className="text-3xl font-bold tabular-nums">{items === null ? "…" : items.length}</p>
            </SectionCard>
            <SectionCard title="Low stock" description="At or below min stock">
              <p className={lowStock.length > 0 ? "text-3xl font-bold tabular-nums text-amber-600 dark:text-amber-400" : "text-3xl font-bold tabular-nums"}>
                {items === null ? "…" : lowStock.length}
              </p>
            </SectionCard>
            <SectionCard title="Stock value" description="Qty × unit price">
              <p className="text-3xl font-bold tabular-nums">{items === null ? "…" : formatINR(stockValue)}</p>
            </SectionCard>
          </div>

          {stockError ? (
            <EmptyState icon={<Boxes className="size-8" aria-hidden="true" />} title="Medicine stock could not load" hint={stockError}>
              <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
                Retry
              </Button>
            </EmptyState>
          ) : items === null ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Boxes className="size-8" aria-hidden="true" />}
              title="No MEDICINE inventory items"
              hint="Add medicines in the Inventory module with the MEDICINE category — they show up here for camp pharmacy oversight."
            />
          ) : (
            <DataTable
              columns={stockColumns}
              rows={items}
              rowKey={(i) => i.id}
              loading={false}
              height="max-h-[30rem]"
              itemLabel="medicines"
            />
          )}

          {expiring.length > 0 ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {expiring.length} medicine{expiring.length === 1 ? "" : "s"} expiring within 90 days — review before the next camp.
            </p>
          ) : null}
        </TabsContent>

        {/* RECEIPTS */}
        <TabsContent value="receipts" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-56">
              <CampSelect value={txCamp} onChange={setTxCamp} allowAll placeholder="All camps" />
            </div>
            <Button className="min-h-11 sm:min-h-9 sm:ml-auto" onClick={() => setReceiveOpen(true)}>
              <Plus className="size-4" aria-hidden="true" /> Receive stock
            </Button>
          </div>

          {txError ? (
            <EmptyState icon={<PackageOpen className="size-8" aria-hidden="true" />} title="Transactions could not load" hint={txError}>
              <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
                Retry
              </Button>
            </EmptyState>
          ) : txs === null ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : txs.length === 0 ? (
            <EmptyState
              icon={<PackageOpen className="size-8" aria-hidden="true" />}
              title="No stock movements yet"
              hint="Receive medicine batches here or from the Inventory module — receipts raise on-hand quantities."
            />
          ) : (
            <DataTable columns={txColumns} rows={txs} rowKey={(t) => t.id} loading={false} height="max-h-[30rem]" itemLabel="transactions" />
          )}
        </TabsContent>

        {/* DISPENSE OVERSIGHT */}
        <TabsContent value="dispense" className="mt-4 space-y-4">
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Dispensing happens at the pharmacist portal with stock deduction — this is the audit view.
          </p>
          {rxError ? (
            <EmptyState icon={<CheckCircle2 className="size-8" aria-hidden="true" />} title="Dispense history could not load" hint={rxError}>
              <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
                Retry
              </Button>
            </EmptyState>
          ) : rxs === null ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : rxs.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="size-8" aria-hidden="true" />}
              title="Nothing dispensed yet"
              hint="Fully and partially dispensed prescriptions appear here with their dispense history."
            />
          ) : (
            <ul className="max-h-[30rem] space-y-2 overflow-y-auto scrollbar-thin" aria-label="Dispense history">
              {rxs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.beneficiary?.name ?? "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[r.code, r.doctor?.name, r.createdAt ? formatDateTime(r.createdAt) : ""].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Badge variant="outline" className="tabular-nums">
                    <Package className="mr-1 size-3" aria-hidden="true" />
                    {(r.dispenses ?? []).length} dispense{(r.dispenses ?? []).length === 1 ? "" : "s"}
                  </Badge>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      {/* receive stock FormSheet */}
      <FormSheet
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        title="Receive medicine stock"
        description="Record an inbound medicine batch — on-hand quantity increases immediately."
        size="sm"
        submitLabel="Receive stock"
        loading={saving}
        dirty={!!itemId || !!qty.trim() || !!notes.trim()}
        onSubmit={receive}
      >
        <FormSection title="Receipt">
          <SelectField
            label="Medicine"
            required
            value={itemId}
            onChange={setItemId}
            options={(items ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.quantity} ${i.unit ?? ""} on hand)` }))}
            placeholder="Pick medicine…"
          />
          <FieldGrid>
            <TextField label="Quantity received" required inputMode="numeric" value={qty} onChange={setQty} />
            <TextField label="Notes" value={notes} onChange={setNotes} placeholder="Batch no, supplier…" />
          </FieldGrid>
          {itemId ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="hidden" aria-hidden="true" />
              Type: RECEIVED (stock-in transaction)
            </p>
          ) : null}
        </FormSection>
      </FormSheet>
    </div>
  );
}
