"use client";

/**
 * Food Security — Food Inventory tab.
 * Batch-level food stock: goods receipt (donated/purchased/CSR/partner/
 * recovered), quality inspection, quarantine, expiry tracking and waste
 * write-offs. Expired/quarantined stock can never be reserved (FEFO guard).
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, PackageSearch, PackageX, ShieldCheck, Timer } from "lucide-react";
import { toast } from "sonner";
import { get, post, patch } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { DataTable } from "@/components/shared/data-table";
import { FormSheet } from "@/components/shared/form-sheet";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { FieldGrid, TextField, TextareaField, SelectField } from "@/components/shared/form-fields";
import { asArray, labelOf, FOOD_SOURCES, type FoodBatch, type TabProps } from "./shared";
import { FOOD_BATCH_QUALITY_TRANSITIONS } from "@/lib/food-workflows";

interface InvItem { id: string; code: string; name: string; unit: string; quantity: number; category: string }

interface BatchForm {
  itemId: string; batchNo: string; source: string; donorName: string; supplierName: string;
  quantityReceived: string; mfgDate: string; expiryDate: string; tempRequirement: string; storageNotes: string;
}

const EMPTY: BatchForm = {
  itemId: "", batchNo: "", source: "DONATED", donorName: "", supplierName: "",
  quantityReceived: "", mfgDate: "", expiryDate: "", tempRequirement: "AMBIENT", storageNotes: "",
};

const availableOf = (b: FoodBatch) =>
  b.quantityReceived - b.quantityReserved - b.quantityConsumed - b.quantityWasted - b.quantityReturned;

export default function BatchesTab({ revision, isAdmin }: TabProps) {
  const [rows, setRows] = useState<FoodBatch[]>([]);
  const [items, setItems] = useState<InvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expiryDays, setExpiryDays] = useState(14);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<BatchForm>(EMPTY);
  const [inspect, setInspect] = useState<FoodBatch | null>(null);
  const [inspectNote, setInspectNote] = useState("");
  const [wasteQty, setWasteQty] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k: keyof BatchForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled([
      get<unknown>("/api/food/batches").then((d) => setRows(asArray<FoodBatch>(d))).catch(() => setRows([])),
      get<unknown>("/api/inventory").then((d) =>
        setItems(asArray<InvItem>(d).filter((i) => i.category === "FOOD_KIT"))
      ).catch(() => setItems([])),
      // configured expiry-alert window (falls back to the default when the
      // viewer is a volunteer without settings access)
      get<Record<string, string>>("/api/settings").catch(() => null).then((s) => {
        const n = parseInt(s?.["food.expiryAlertDays"] ?? "", 10);
        if (Number.isFinite(n) && n >= 1) setExpiryDays(n);
      }),
    ]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, revision]);

  const save = async () => {
    if (!form.itemId || !form.batchNo.trim() || !Number(form.quantityReceived)) {
      toast.error("Item, batch number and received quantity are required");
      return;
    }
    setSaving(true);
    try {
      await post("/api/food/batches", {
        ...form,
        quantityReceived: Number(form.quantityReceived),
        mfgDate: form.mfgDate || null,
        expiryDate: form.expiryDate || null,
        donorName: form.source === "DONATED" ? form.donorName || null : null,
        supplierName: form.source !== "DONATED" ? form.supplierName || null : null,
      });
      toast.success("Food batch received into stock");
      setOpen(false);
      setForm(EMPTY);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const decide = async (quality: "PASSED" | "QUARANTINED" | "REJECTED") => {
    if (!inspect) return;
    if (quality === "REJECTED" && !inspectNote.trim()) {
      toast.error("A rejection reason is required");
      return;
    }
    setSaving(true);
    try {
      await patch(`/api/food/batches/${inspect.id}`, {
        qualityStatus: quality,
        rejectionReason: inspectNote || undefined,
        ...(Number(wasteQty) > 0 ? { wasteQty: Number(wasteQty), wasteReason: inspectNote || "damaged" } : {}),
      });
      toast.success(`Batch ${quality.toLowerCase()}`);
      setInspect(null);
      setInspectNote("");
      setWasteQty("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setSaving(false);
    }
  };

  const now = Date.now();
  const expiring = rows.filter(
    (b) => b.status === "ACTIVE" && b.qualityStatus === "PASSED" &&
      b.expiryDate && new Date(b.expiryDate).getTime() < now + expiryDays * 86400000
  );
  const pending = rows.filter((b) => b.qualityStatus === "PENDING");
  const totalAvailable = rows
    .filter((b) => b.qualityStatus === "PASSED" && b.status === "ACTIVE")
    .reduce((sum, b) => sum + availableOf(b), 0);

  // Reconciliation vs master inventory (same source as #/admin/inventory):
  // every FOOD_KIT item's master quantity must equal its batch ledger sum.
  const ledgerByItem = new Map<string, number>();
  for (const b of rows) {
    ledgerByItem.set(
      b.itemId,
      (ledgerByItem.get(b.itemId) ?? 0) +
        b.quantityReceived - b.quantityConsumed - b.quantityWasted - b.quantityReturned
    );
  }
  const itemStock = new Map<string, number>();
  for (const it of items) itemStock.set(it.id, it.quantity);
  const reconciliations = Array.from(new Set([...ledgerByItem.keys(), ...items.filter((i) => i.category === "FOOD_KIT").map((i) => i.id)]))
    .map((id) => ({
      id,
      name: items.find((i) => i.id === id)?.name ?? "—",
      unit: items.find((i) => i.id === id)?.unit ?? "",
      master: itemStock.get(id) ?? 0,
      ledger: ledgerByItem.get(id) ?? 0,
    }))
    .filter((r) => r.master !== 0 || r.ledger !== 0);
  const mismatches = reconciliations.filter((r) => r.master !== r.ledger);

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Batches in stock" value={rows.filter((b) => b.status === "ACTIVE").length} icon={<PackageSearch className="size-5" />} accent="emerald" loading={loading} hint={`${totalAvailable} unit(s) available`} />
        <StatCard label="Awaiting inspection" value={pending.length} icon={<ShieldCheck className="size-5" />} accent="amber" loading={loading} hint="Stock cannot be reserved until inspected" />
        <StatCard label={`Expiring within ${expiryDays} days`} value={expiring.length} icon={<Timer className="size-5" />} accent="red" loading={loading} hint="Prioritise these batches (FEFO) — window configurable in Settings → Food Security" />
      </section>

      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)} disabled={!isAdmin}>
          <Plus className="size-4" /> Receive food stock
        </Button>
      </div>

      <SectionCard
        title="Reconciliation with master inventory"
        description={mismatches.length === 0 ? "Batch ledger matches #/admin/inventory exactly for every food item" : "Ledger drift detected — investigate before your next distribution"}
        icon={mismatches.length === 0 ? <ShieldCheck className="size-4" /> : <Timer className="size-4" />}
        className={mismatches.length > 0 ? "border-destructive/40" : ""}
      >
        <ul className="divide-y px-5 pb-5">
          {reconciliations.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="truncate">{r.name}</span>
              <span className="flex items-center gap-3 tabular-nums">
                <span className="text-muted-foreground">master {r.master}{r.unit ? ` ${r.unit}` : ""}</span>
                <span className={r.master === r.ledger ? "font-medium text-emerald-600 dark:text-emerald-400" : "font-semibold text-destructive"}>
                  ledger {r.ledger}{r.unit ? ` ${r.unit}` : ""}
                </span>
              </span>
            </li>
          ))}
          {reconciliations.length === 0 && (
            <li className="py-2 text-sm text-muted-foreground">No food batches yet — receive stock to start the ledger.</li>
          )}
        </ul>
      </SectionCard>

      <DataTable
        columns={[
          { key: "batch", header: "Batch", mono: true },
          { key: "item", header: "Item" },
          { key: "source", header: "Source", hideBelow: "md" },
          { key: "received", header: "Received", align: "right" },
          { key: "available", header: "Available", align: "right" },
          { key: "expiry", header: "Expiry", hideBelow: "sm" },
          { key: "quality", header: "Quality" },
          { key: "actions", header: "" },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        height="auto"
        onRowClick={(b) => isAdmin && (setInspect(b), setInspectNote(b.rejectionReason ?? ""))}
        empty={
          <EmptyState
            icon={<PackageSearch className="size-8" />}
            title="No food batches yet"
            hint="Record every food donation or procurement receipt as a traceable batch with expiry."
          />
        }
      >
        {(row, col) => {
          if (col.key === "batch")
            return (
              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-medium">{row.batchNo}</p>
                <p className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</p>
              </div>
            );
          if (col.key === "item") return <span className="text-sm">{row.item?.name ?? "—"}</span>;
          if (col.key === "source") return <span className="text-sm">{labelOf(FOOD_SOURCES, row.source)}</span>;
          if (col.key === "received") return <span className="text-sm tabular-nums">{row.quantityReceived}</span>;
          if (col.key === "available") return <span className="text-sm font-semibold tabular-nums">{availableOf(row)}</span>;
          if (col.key === "expiry")
            return (
              <span className={`text-sm ${row.expiryDate && new Date(row.expiryDate).getTime() < now + 14 * 86400000 ? "font-semibold text-destructive" : ""}`}>
                {row.expiryDate ? formatDate(row.expiryDate) : "—"}
              </span>
            );
          if (col.key === "quality") return <StatusBadge status={row.qualityStatus} />;
          if (col.key === "actions")
            return (
              <Button
                variant="outline" size="sm" disabled={!isAdmin}
                onClick={(e) => { e.stopPropagation(); setInspect(row); setInspectNote(row.rejectionReason ?? ""); }}
              >
                Inspect
              </Button>
            );
          return null;
        }}
      </DataTable>

      {/* goods receipt sheet */}
      <FormSheet open={open} onOpenChange={setOpen} title="Receive food stock" description="Every receipt creates a traceable batch. Master item stock increases immediately; quality inspection gates distribution." onSubmit={save} loading={saving} size="lg">
        <div className="space-y-4">
          <FieldGrid>
            <SelectField label="Inventory item" required value={form.itemId} onChange={set("itemId")}
              options={items.map((i) => ({ value: i.id, label: `${i.name} (${i.quantity} ${i.unit} in stock)` }))} />
            <TextField label="Batch / lot number" required value={form.batchNo} onChange={set("batchNo")} placeholder="BATCH-2026-041" />
          </FieldGrid>
          <FieldGrid cols={3}>
            <SelectField label="Source" value={form.source} onChange={set("source")} options={FOOD_SOURCES} />
            <TextField label={form.source === "DONATED" ? "Donor name" : "Supplier name"} value={form.source === "DONATED" ? form.donorName : form.supplierName}
              onChange={(v) => set(form.source === "DONATED" ? "donorName" : "supplierName")(v)} />
            <TextField label="Quantity received" required inputMode="numeric" value={form.quantityReceived} onChange={set("quantityReceived")} />
          </FieldGrid>
          <FieldGrid cols={3}>
            <TextField label="Manufacturing date" type="date" value={form.mfgDate} onChange={set("mfgDate")} />
            <TextField label="Expiry date" type="date" value={form.expiryDate} onChange={set("expiryDate")} />
            <SelectField label="Temperature" value={form.tempRequirement} onChange={set("tempRequirement")}
              options={[{ value: "AMBIENT", label: "Ambient" }, { value: "COOL", label: "Cool / refrigerated" }, { value: "FROZEN", label: "Frozen" }, { value: "HOT_HOLD", label: "Hot hold (cooked)" }]} />
          </FieldGrid>
          <TextareaField label="Storage notes / packaging condition" value={form.storageNotes} onChange={set("storageNotes")} />
        </div>
      </FormSheet>

      {/* inspection dialog */}
      <FormSheet
        open={!!inspect}
        onOpenChange={(o) => !o && setInspect(null)}
        title={inspect ? `Inspect batch ${inspect.batchNo}` : ""}
        description={inspect ? `${inspect.item?.name} · received ${formatDateTime(inspect.createdAt)} · ${inspect.quantityReceived} unit(s)` : ""}
        badge={inspect ? <StatusBadge status={inspect.qualityStatus} /> : null}
        size="md"
      >
        {inspect && (
          <div className="space-y-4">
            <TextareaField
              label="Inspection findings (packaging condition, seal integrity, smell, temperature compliance…)"
              value={inspectNote}
              onChange={setInspectNote}
              placeholder="Seals intact, within expiry, dry storage compliant."
            />
            {inspect.qualityStatus === "PASSED" && (
              <TextField label="Write off damaged units (optional)" inputMode="numeric" value={wasteQty} onChange={setWasteQty} placeholder="0" />
            )}
            <div className="flex flex-wrap gap-2">
              {(FOOD_BATCH_QUALITY_TRANSITIONS[inspect.qualityStatus] ?? []).includes("PASSED") && (
                <Button onClick={() => decide("PASSED")} disabled={saving}>
                  <ShieldCheck className="size-4" /> Pass inspection
                </Button>
              )}
              {(FOOD_BATCH_QUALITY_TRANSITIONS[inspect.qualityStatus] ?? []).includes("QUARANTINED") && (
                <Button variant="outline" onClick={() => decide("QUARANTINED")} disabled={saving}>Quarantine</Button>
              )}
              {(FOOD_BATCH_QUALITY_TRANSITIONS[inspect.qualityStatus] ?? []).includes("REJECTED") && (
                <Button variant="destructive" onClick={() => decide("REJECTED")} disabled={saving}>
                  <PackageX className="size-4" /> Reject
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Only PASSED, unexpired batches can be reserved for distributions (FEFO). Rejections require a reason — this is a hard food-safety rule, AI never overrides it.
            </p>
          </div>
        )}
      </FormSheet>
    </div>
  );
}
