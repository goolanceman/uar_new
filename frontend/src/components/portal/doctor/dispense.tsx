"use client";

/**
 * Pharmacist tab — Dispensing workbench. Search signed prescriptions
 * (by code or patient), dispense per item against MEDICINE inventory stock
 * (partial dispensing supported, 409 stock errors surfaced), and review the
 * dispensing history.
 */

import { useCallback, useEffect, useState } from "react";
import { Package, Pill, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, post } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormSheet } from "@/components/shared/form-sheet";
import { Field, FieldGrid, TextField, TextareaField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ageSexLine,
  asArray,
  ListSkeleton,
  medTone,
  QuietEmpty,
  toastError,
  type InventoryRow,
  type PrescriptionItemRow,
  type PrescriptionRow,
} from "./shared";

interface DispenseDraft {
  itemId?: string;
  itemName: string;
  remaining: number;
  inventoryItemId: string;
  quantity: string;
  batchNo: string;
  expiryDate: string;
}

export default function PharmacistDispense({ user }: { user: SessionUser }) {
  const [rows, setRows] = useState<PrescriptionRow[]>([]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [invLoading, setInvLoading] = useState(false);

  const [target, setTarget] = useState<PrescriptionRow | null>(null);
  const [drafts, setDrafts] = useState<DispenseDraft[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Debounce the search box (300ms).
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<unknown>(
        `/api/prescriptions?status=SIGNED${query ? `&q=${encodeURIComponent(query)}` : ""}`
      );
      setRows(asArray<PrescriptionRow>(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load prescriptions");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  const loadInventory = useCallback(async () => {
    setInvLoading(true);
    try {
      const data = await get<unknown>("/api/inventory?category=MEDICINE");
      setInventory(asArray<InventoryRow>(data));
    } catch {
      setInventory([]);
    } finally {
      setInvLoading(false);
    }
  }, []);

  const openDispense = (p: PrescriptionRow) => {
    const items = p.items ?? [];
    if (items.length === 0) {
      toast.error("This prescription has no medicine items");
      return;
    }
    setDrafts(
      items.map((it: PrescriptionItemRow) => ({
        itemId: it.id,
        itemName: it.medicineName,
        remaining: Math.max(0, (it.quantity ?? 0) - (it.dispensedQty ?? 0)),
        inventoryItemId: "",
        quantity: "",
        batchNo: "",
        expiryDate: "",
      }))
    );
    setNotes("");
    setTarget(p);
    void loadInventory();
  };

  const setDraft = (i: number, key: keyof DispenseDraft, v: string) => {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, [key]: v } : d)));
  };

  const save = async () => {
    if (!target) return;
    const valid = drafts.filter((d) => d.inventoryItemId && Number(d.quantity) > 0);
    if (valid.length === 0) {
      toast.error("Fill in at least one medicine with inventory stock and quantity");
      return;
    }
    const over = valid.find((d) => Number(d.quantity) > d.remaining);
    if (over) {
      toast.error(`Quantity for ${over.itemName} is more than the remaining ${over.remaining}`);
      return;
    }
    setSaving(true);
    try {
      await post(`/api/prescriptions/${target.id}/dispense`, {
        dispenses: valid.map((d) => ({
          itemId: d.itemId,
          inventoryItemId: d.inventoryItemId,
          quantity: Number(d.quantity),
          batchNo: d.batchNo.trim() || undefined,
          expiryDate: d.expiryDate || undefined,
        })),
        notes: notes.trim() || undefined,
      });
      toast.success("Dispensed — stock has been updated");
      setTarget(null);
      await load();
    } catch (e) {
      // Stock conflicts come back as 409 — surface the server message as-is.
      toastError(e, "Could not dispense");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispensing"
        description="Signed prescriptions waiting for medicines — dispense fully or in parts."
        icon={<Pill className="size-5" />}
        actions={
          <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={load} aria-label="Refresh prescriptions">
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <SectionCard
        title="Signed prescriptions"
        description="Search by prescription code or patient name"
        icon={<Search className="size-5" />}
      >
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. UAR-RX-00012"
          aria-label="Search prescriptions by code or patient"
          className="h-11"
        />
        <div className="mt-4">
          {loading ? (
            <ListSkeleton rows={4} />
          ) : rows.length === 0 ? (
            <QuietEmpty
              icon={<Pill className="size-5" />}
              title="No signed prescriptions waiting"
              error={error}
            />
          ) : (
            <ul className="max-h-[32rem] divide-y overflow-y-auto scrollbar-thin">
              {rows.map((p) => {
                const items = p.items ?? [];
                return (
                  <li key={p.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {p.code ? `${p.code} · ` : ""}
                        {p.beneficiary?.name ?? "Patient"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {ageSexLine(p.beneficiary)}
                        {p.createdAt ? ` · ${formatDateTime(p.createdAt)}` : ""}
                        {p.diagnosis ? ` · ${p.diagnosis}` : ""}
                      </p>
                      {items.length > 0 && (
                        <ul className="mt-1.5 space-y-1">
                          {items.map((it, i) => {
                            const remaining = Math.max(0, (it.quantity ?? 0) - (it.dispensedQty ?? 0));
                            return (
                              <li key={it.id ?? i} className="text-xs text-muted-foreground">
                                {it.medicineName}
                                {it.strength ? ` ${it.strength}` : ""}
                                {it.frequency ? ` · ${it.frequency}` : ""}
                                {" — "}
                                {remaining === 0 ? (
                                  <span className="font-medium text-emerald-600 dark:text-emerald-400">fully dispensed</span>
                                ) : (
                                  <span>
                                    {remaining} of {it.quantity} remaining
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {p.dispenses && p.dispenses.length > 0 && (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          Dispense history:{" "}
                          {p.dispenses
                            .map((d) => {
                              const name =
                                p.items?.find((it) => it.id === d.itemId)?.medicineName ?? "item";
                              return `${name} ×${d.quantity}${d.batchNo ? ` (batch ${d.batchNo})` : ""}`;
                            })
                            .join("; ")}
                        </p>
                      )}
                    </div>
                    <StatusBadge status={p.status} tone={medTone(p.status)} />
                    <Button
                      size="sm"
                      className="min-h-11 gap-1.5 sm:min-h-9"
                      onClick={() => openDispense(p)}
                      aria-label={`Dispense prescription ${p.code ?? ""}`}
                    >
                      <Package className="size-4" aria-hidden="true" />
                      Dispense
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SectionCard>

      {/* Dispense FormSheet */}
      <FormSheet
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Dispense medicines"
        description={target ? `${target.code ?? "Prescription"} · ${target.beneficiary?.name ?? "Patient"}` : undefined}
        size="lg"
        submitLabel="Confirm dispense"
        onSubmit={save}
        loading={saving}
        dirty={drafts.some((d) => d.quantity !== "" || d.batchNo !== "")}
      >
        {invLoading && <p className="text-xs text-muted-foreground">Loading medicine stock…</p>}
        {!invLoading && inventory.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No medicine stock found in inventory — add MEDICINE items in inventory first.
          </p>
        )}
        {drafts.map((d, i) => {
          const stock = inventory.find((inv) => inv.id === d.inventoryItemId);
          return (
            <fieldset key={i} className="rounded-xl border p-4" aria-label={`Dispense ${d.itemName}`}>
              <legend className="px-1 text-xs font-semibold">
                {d.itemName} · {d.remaining} remaining
              </legend>
              <FieldGrid>
                <Field label="Inventory item" required className="sm:col-span-2">
                  <select
                    value={d.inventoryItemId}
                    onChange={(e) => setDraft(i, "inventoryItemId", e.target.value)}
                    aria-label={`Stock item for ${d.itemName}`}
                    className="h-11 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">Select medicine stock…</option>
                    {inventory.map((inv) => (
                      <option key={inv.id} value={inv.id} disabled={inv.quantity <= 0}>
                        {inv.name} — {inv.quantity} {inv.unit ?? "units"} in stock
                      </option>
                    ))}
                  </select>
                </Field>
                <TextField
                  label={`Quantity (max ${d.remaining})`}
                  required
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={String(d.remaining)}
                  value={d.quantity}
                  onChange={(v) => setDraft(i, "quantity", v)}
                />
                <TextField
                  label="Batch no."
                  value={d.batchNo}
                  onChange={(v) => setDraft(i, "batchNo", v)}
                  placeholder={stock ? "From the physical pack" : undefined}
                />
                <TextField
                  label="Expiry date"
                  type="date"
                  value={d.expiryDate}
                  onChange={(v) => setDraft(i, "expiryDate", v)}
                />
              </FieldGrid>
            </fieldset>
          );
        })}
        <TextareaField
          label="Notes (optional)"
          value={notes}
          onChange={setNotes}
          placeholder="e.g. Patient counselled on dosage; 2 tablets short — partial dispense."
        />
        <p className="text-xs text-muted-foreground">
          Partial dispensing is supported — dispense what&apos;s in stock and the rest stays pending.
          Stock shortfalls are rejected by the server and shown here as an error.
        </p>
      </FormSheet>
    </div>
  );
}
