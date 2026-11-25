"use client";

/**
 * "Available to Distribute" — a modern, self-contained grid of everything
 * ready to hand out right now: master inventory items with stock, and kit
 * batches with unused units. Tapping a card opens a minimal one-step "Quick
 * Distribute" sheet (type + beneficiary + quantity + location) that posts
 * straight to POST /api/distributions, reusing the exact same stock/kit
 * consumption logic as the full admin wizard.
 *
 * Used by both /admin/distributions ("Available" tab) and the volunteer
 * portal's Distributions page, so the experience — and the underlying
 * stock math — is identical for both roles.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  Boxes,
  Clock,
  MapPin,
  Package,
  PackageCheck,
  PackageOpen,
  QrCode,
  RefreshCw,
  ScanLine,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { get, post } from "@/lib/api-client";
import { titleCase, formatDateTime } from "@/lib/format";
import { timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { FieldGrid, SelectField, TextareaField, TextField } from "@/components/shared/form-fields";
import { amountRule, fieldError, required } from "@/lib/validators";

/* ------------------------------- types ------------------------------- */

interface InventoryLite {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  minStock: number;
}

interface KitBatchLite {
  id: string;
  name: string;
  totalUnits: number;
  scannedUnits: number;
  status: string;
  template: { name: string; kind: string; costPerUnit: number; items?: string };
}

interface BeneficiaryLite {
  id: string;
  name: string;
  city?: string | null;
}

type PickTarget =
  | { kind: "item"; item: InventoryLite }
  | { kind: "kit"; batch: KitBatchLite };

interface DistLogEntry {
  id: string;
  type: string;
  quantity: number;
  kitQuantity?: number | null;
  location?: string | null;
  distributedAt?: string | null;
  beneficiary?: { name: string; city?: string | null } | null;
  volunteer?: { user?: { name?: string | null } | null } | null;
}

interface KitUnitLite {
  id: string;
  code: string;
  status: string;
  location?: string | null;
  scannedAt?: string | null;
}

function parseTemplateItems(json: string | undefined): { name: string; qty: number; unit?: string }[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((i: Record<string, unknown>) => ({
      name: String(i?.name ?? ""),
      qty: Number(i?.qty ?? 0),
      unit: i?.unit ? String(i.unit) : undefined,
    }));
  } catch {
    return [];
  }
}

/** Short scannable payload printed/encoded on each card's QR — paste or scan it into the "Scan code" box to jump straight to that item/kit. */
function qrPayload(t: PickTarget): string {
  return t.kind === "item" ? `UAR-ITEM:${t.item.id}` : `UAR-KIT:${t.batch.id}`;
}

const TYPES = [
  "FOOD",
  "SANITARY_PADS",
  "MEDICAL",
  "ANIMAL_FEED",
  "CLOTHING",
  "EDUCATION_MATERIAL",
  "CASH",
  "OTHER",
] as const;

const TYPE_OPTIONS = TYPES.map((t) => ({ value: t, label: titleCase(t) }));

/** Best-guess distribution type from an inventory category / kit kind — always editable by the user. */
const TYPE_FROM_CATEGORY: Record<string, string> = {
  FOOD_KIT: "FOOD",
  SANITARY_PADS: "SANITARY_PADS",
  MEDICINE: "MEDICAL",
  ANIMAL_FEED: "ANIMAL_FEED",
  EQUIPMENT: "OTHER",
  EDUCATION_MATERIAL: "EDUCATION_MATERIAL",
  CLOTHING: "CLOTHING",
  OTHER: "OTHER",
};

const TYPE_FROM_KIT_KIND: Record<string, string> = {
  RATION: "FOOD",
  FOOD: "FOOD",
  EDUCATION: "EDUCATION_MATERIAL",
  MEDICAL: "MEDICAL",
  HYGIENE: "SANITARY_PADS",
  CLOTHING: "CLOTHING",
  EMERGENCY: "OTHER",
  CUSTOM: "OTHER",
};

function kitAvailable(b: KitBatchLite): number {
  return Math.max(0, b.totalUnits - b.scannedUnits);
}

interface QuickForm {
  type: string;
  beneficiaryId: string;
  quantity: string;
  location: string;
  notes: string;
}

const EMPTY_QUICK: QuickForm = {
  type: "FOOD",
  beneficiaryId: "walk-in",
  quantity: "1",
  location: "",
  notes: "",
};

export interface AvailableToDistributeProps {
  beneficiaries: BeneficiaryLite[];
  defaultLocation?: string;
  /** Called after a successful quick-distribute post — refresh your history list. */
  onDistributed?: () => void;
}

export function AvailableToDistribute({
  beneficiaries,
  defaultLocation,
  onDistributed,
}: AvailableToDistributeProps) {
  const [items, setItems] = useState<InventoryLite[]>([]);
  const [batches, setBatches] = useState<KitBatchLite[]>([]);
  const [loading, setLoading] = useState(true);

  const [target, setTarget] = useState<PickTarget | null>(null);
  const [quickForm, setQuickForm] = useState<QuickForm>(EMPTY_QUICK);
  const [quickErrors, setQuickErrors] = useState<Partial<Record<keyof QuickForm, string | null>>>({});
  const [submitting, setSubmitting] = useState(false);

  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [scanCode, setScanCode] = useState("");

  /* kit batch detail slideover: selected kit + its component list + full distribution/scan log */
  const [kitDetail, setKitDetail] = useState<KitBatchLite | null>(null);
  const [kitLog, setKitLog] = useState<DistLogEntry[]>([]);
  const [kitUnits, setKitUnits] = useState<KitUnitLite[]>([]);
  const [kitLogLoading, setKitLogLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, b] = await Promise.all([
        get<InventoryLite[]>("/api/inventory").catch(() => []),
        get<KitBatchLite[]>("/api/kit-batches").catch(() => []),
      ]);
      setItems(Array.isArray(i) ? i : []);
      setBatches(Array.isArray(b) ? b : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const availableItems = useMemo(() => items.filter((i) => i.quantity > 0), [items]);
  const availableBatches = useMemo(
    () => batches.filter((b) => kitAvailable(b) > 0 && b.status !== "DEPLETED"),
    [batches]
  );

  // Generate one QR code per card so a volunteer's phone camera (any generic QR
  // scanner app) or the "Scan code" box below can jump straight to a hand-out.
  useEffect(() => {
    let cancelled = false;
    const targets: PickTarget[] = [
      ...availableBatches.map((batch) => ({ kind: "kit" as const, batch })),
      ...availableItems.map((item) => ({ kind: "item" as const, item })),
    ];
    const missing = targets.filter((t) => !qrMap[qrPayload(t)]);
    if (missing.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (t) => {
          const payload = qrPayload(t);
          try {
            const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 120 });
            return [payload, dataUrl] as const;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      setQrMap((m) => {
        const next = { ...m };
        for (const e of entries) if (e) next[e[0]] = e[1];
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [availableBatches, availableItems, qrMap]);

  const openKitDetail = useCallback(async (batch: KitBatchLite) => {
    setKitDetail(batch);
    setKitLogLoading(true);
    try {
      const [dist, units] = await Promise.all([
        get<DistLogEntry[]>(`/api/distributions?kitBatchId=${batch.id}&limit=100`).catch(() => []),
        get<KitUnitLite[]>(`/api/kit-units?batchId=${batch.id}&status=SCANNED&limit=200`).catch(() => []),
      ]);
      setKitLog(Array.isArray(dist) ? dist : []);
      setKitUnits(Array.isArray(units) ? units : []);
    } finally {
      setKitLogLoading(false);
    }
  }, []);

  const submitScanCode = () => {
    const raw = scanCode.trim();
    if (!raw) return;
    const itemMatch = raw.match(/^UAR-ITEM:(.+)$/i);
    const kitMatch = raw.match(/^UAR-KIT:(.+)$/i);
    if (itemMatch) {
      const found = availableItems.find((i) => i.id === itemMatch[1]);
      if (found) {
        openQuick({ kind: "item", item: found });
        setScanCode("");
        return;
      }
    } else if (kitMatch) {
      const found = availableBatches.find((b) => b.id === kitMatch[1]);
      if (found) {
        openKitDetail(found);
        setScanCode("");
        return;
      }
    }
    toast.error("Code didn't match anything currently available — it may be out of stock or already fully used.");
  };

  const openQuick = (t: PickTarget) => {
    const maxQty = t.kind === "item" ? t.item.quantity : kitAvailable(t.batch);
    setTarget(t);
    setQuickForm({
      type:
        t.kind === "item"
          ? TYPE_FROM_CATEGORY[t.item.category] ?? "OTHER"
          : TYPE_FROM_KIT_KIND[t.batch.template.kind] ?? "FOOD",
      beneficiaryId: "walk-in",
      quantity: String(Math.min(1, maxQty) || 1),
      location: defaultLocation ?? "",
      notes: "",
    });
    setQuickErrors({});
  };

  const maxQty = target ? (target.kind === "item" ? target.item.quantity : kitAvailable(target.batch)) : 0;

  const submitQuick = async () => {
    if (!target) return;
    const errs = {
      type: fieldError(quickForm.type, [required("Type")]),
      quantity: fieldError(quickForm.quantity, [
        required("Quantity"),
        amountRule({ min: 1, max: Math.max(1, maxQty), label: "Quantity" }),
      ]),
      location: fieldError(quickForm.location, [required("Location")]),
    };
    setQuickErrors(errs);
    if (errs.type || errs.quantity || errs.location) return;

    const qty = Math.round(Number(quickForm.quantity));
    setSubmitting(true);
    try {
      await post("/api/distributions", {
        type: quickForm.type,
        beneficiaryId: quickForm.beneficiaryId === "walk-in" ? undefined : quickForm.beneficiaryId,
        quantity: qty,
        location: quickForm.location.trim(),
        notes: quickForm.notes.trim() || undefined,
        ...(target.kind === "item"
          ? { items: [{ itemId: target.item.id, name: target.item.name, qty, unit: target.item.unit }] }
          : { kitBatchId: target.batch.id, kitQuantity: qty }),
      });
      toast.success(
        target.kind === "item"
          ? `${target.item.name} handed out — stock updated.`
          : `${qty} unit(s) of "${target.batch.name}" handed out.`
      );
      setTarget(null);
      await load();
      if (target.kind === "kit" && kitDetail?.id === target.batch.id) {
        await openKitDetail(target.batch);
      }
      onDistributed?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the distribution");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Ready right now
          </h3>
          <p className="text-xs text-muted-foreground">
            Everything in stock or packed as kits — tap any card to hand it out in one step.
          </p>
        </div>
        <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={load} aria-label="Refresh available stock">
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-3 sm:flex-row sm:items-center">
        <QrCode className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
        <Input
          value={scanCode}
          onChange={(e) => setScanCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitScanCode()}
          placeholder="Scan or paste a card's QR code (UAR-ITEM:… / UAR-KIT:…)…"
          className="min-h-10 flex-1 font-mono text-xs"
          aria-label="Scan code to jump to an item or kit"
        />
        <Button variant="secondary" size="sm" className="min-h-10 gap-1.5" onClick={submitScanCode}>
          <ScanLine className="size-3.5" aria-hidden="true" /> Open
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : availableItems.length === 0 && availableBatches.length === 0 ? (
        <EmptyState
          icon={<PackageOpen className="size-5" />}
          title="Nothing available right now"
          hint="Inventory is empty or fully committed — check back after the next stock purchase or kit batch."
        />
      ) : (
        <>
          {availableBatches.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Boxes className="size-3.5" aria-hidden="true" /> Kit batches
              </h4>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {availableBatches.map((b) => {
                  const avail = kitAvailable(b);
                  const pct = Math.round((b.scannedUnits / Math.max(1, b.totalUnits)) * 100);
                  const qr = qrMap[qrPayload({ kind: "kit", batch: b })];
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => openKitDetail(b)}
                      className="group flex flex-col gap-2 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          <Boxes className="size-4.5" aria-hidden="true" />
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="rounded-full text-[10px]">
                            {titleCase(b.template.kind)}
                          </Badge>
                          {qr && (
                            <img src={qr} alt="" className="size-9 rounded border bg-white p-0.5" aria-hidden="true" />
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="truncate text-sm font-semibold">{b.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{b.template.name}</p>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                          {avail} unit{avail === 1 ? "" : "s"} ready
                        </span>
                        <span className="text-muted-foreground">{b.scannedUnits}/{b.totalUnits} used</span>
                      </div>
                      <span className="mt-1 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                        <Boxes className="size-3.5" aria-hidden="true" />
                        View kit, items &amp; log
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {availableItems.length > 0 && (
            <div>
              <h4 className="mb-2 mt-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Package className="size-3.5" aria-hidden="true" /> Master inventory items
              </h4>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {availableItems.map((it) => {
                  const low = it.quantity <= it.minStock;
                  const qr = qrMap[qrPayload({ kind: "item", item: it })];
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => openQuick({ kind: "item", item: it })}
                      className="group flex flex-col gap-2 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                          <PackageCheck className="size-4.5" aria-hidden="true" />
                        </span>
                        <div className="flex items-center gap-1.5">
                          {low && (
                            <Badge variant="outline" className="rounded-full border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
                              Low stock
                            </Badge>
                          )}
                          {qr && (
                            <img src={qr} alt="" className="size-9 rounded border bg-white p-0.5" aria-hidden="true" />
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="truncate text-sm font-semibold">{it.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{titleCase(it.category)}</p>
                      </div>
                      <p className="text-xs">
                        <span className="text-sm font-bold">{it.quantity}</span>{" "}
                        <span className="text-muted-foreground">{it.unit} in stock</span>
                      </p>
                      <span className="mt-1 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                        <Send className="size-3.5" aria-hidden="true" />
                        Give to beneficiary
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ---------- Quick Distribute (single-step hand-out) ---------- */}
      <FormSheet
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Quick distribute"
        description={
          target
            ? target.kind === "item"
              ? `Hand out "${target.item.name}" — ${target.item.quantity} ${target.item.unit} available.`
              : `Hand out units from "${target.batch.name}" — ${kitAvailable(target.batch)} ready.`
            : undefined
        }
        submitLabel="Hand over now"
        loading={submitting}
        dirty
        size="sm"
        onSubmit={submitQuick}
      >
        {target && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {target.kind === "kit" ? <Boxes className="size-5" aria-hidden="true" /> : <PackageCheck className="size-5" aria-hidden="true" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {target.kind === "item" ? target.item.name : target.batch.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {target.kind === "item"
                    ? `${target.item.quantity} ${target.item.unit} in stock`
                    : `${kitAvailable(target.batch)} unit(s) ready \u00b7 ${target.batch.template.name}`}
                </p>
              </div>
            </div>

            <SelectField
              label="Distribution type"
              required
              value={quickForm.type}
              onChange={(v) => setQuickForm((f) => ({ ...f, type: v }))}
              options={TYPE_OPTIONS as Array<{ value: string; label: string }>}
              error={quickErrors.type}
              hint="Pre-filled from the item/kit — change it if needed"
            />
            <FieldGrid>
              <SelectField
                label="Beneficiary"
                value={quickForm.beneficiaryId}
                onChange={(v) => setQuickForm((f) => ({ ...f, beneficiaryId: v }))}
                options={[
                  { value: "walk-in", label: "Walk-in (not registered)" },
                  ...beneficiaries.map((b) => ({
                    value: b.id,
                    label: b.city ? `${b.name} \u2014 ${b.city}` : b.name,
                  })),
                ]}
              />
              <TextField
                label={`Quantity (max ${maxQty})`}
                required
                inputMode="numeric"
                value={quickForm.quantity}
                onChange={(v) => setQuickForm((f) => ({ ...f, quantity: v.replace(/[^\d]/g, "") }))}
                error={quickErrors.quantity}
              />
            </FieldGrid>
            <TextField
              label="Location"
              required
              value={quickForm.location}
              onChange={(v) => setQuickForm((f) => ({ ...f, location: v }))}
              error={quickErrors.location}
              hint="Where the handover happened"
            />
            <TextareaField
              label="Notes (optional)"
              rows={2}
              value={quickForm.notes}
              onChange={(v) => setQuickForm((f) => ({ ...f, notes: v }))}
            />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              Submitting deducts stock immediately and shows an error if it would go negative.
            </p>
          </div>
        )}
      </FormSheet>

      {/* ---------- Kit batch detail: selected kit, its items, QR, and full distribution/scan log ---------- */}
      <Sheet open={kitDetail !== null} onOpenChange={(open) => !open && setKitDetail(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
          {kitDetail && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Boxes className="size-4.5 text-primary" aria-hidden="true" />
                  {kitDetail.name}
                </SheetTitle>
                <SheetDescription>
                  {kitDetail.template.name} · {titleCase(kitDetail.template.kind)} ·{" "}
                  {kitAvailable(kitDetail)} of {kitDetail.totalUnits} unit(s) still available
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-6 sm:px-6">
                <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
                  {qrMap[qrPayload({ kind: "kit", batch: kitDetail })] && (
                    <img
                      src={qrMap[qrPayload({ kind: "kit", batch: kitDetail })]}
                      alt={`QR code for ${kitDetail.name}`}
                      className="size-16 rounded border bg-white p-1"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Scan this QR, or paste its code above, to jump straight here.</p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">{qrPayload({ kind: "kit", batch: kitDetail })}</p>
                  </div>
                </div>

                <Progress
                  value={Math.round((kitDetail.scannedUnits / Math.max(1, kitDetail.totalUnits)) * 100)}
                  className="h-2"
                />

                <Button
                  className="min-h-11 w-full gap-1.5"
                  onClick={() => openQuick({ kind: "kit", batch: kitDetail })}
                  disabled={kitAvailable(kitDetail) <= 0}
                >
                  <Send className="size-4" aria-hidden="true" />
                  Hand out unit(s) from this kit
                </Button>

                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Contains (per kit)
                  </h4>
                  <div className="space-y-1.5">
                    {parseTemplateItems(kitDetail.template.items).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No itemised component list on file.</p>
                    ) : (
                      parseTemplateItems(kitDetail.template.items).map((ci, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded-lg border bg-card px-3 py-1.5 text-xs">
                          <span className="font-medium">{ci.name}</span>
                          <span className="text-muted-foreground">{ci.qty} {ci.unit ?? ""}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Send className="size-3.5" aria-hidden="true" /> Distribution log
                  </h4>
                  {kitLogLoading ? (
                    <div className="space-y-2">
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-12 w-full rounded-lg" />
                      ))}
                    </div>
                  ) : kitLog.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No hand-outs recorded from this batch yet.</p>
                  ) : (
                    <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
                      {kitLog.map((d) => (
                        <li key={d.id} className="rounded-lg border bg-card px-3 py-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1 font-medium">
                              <Users className="size-3" aria-hidden="true" />
                              {d.beneficiary?.name ?? "Community hand-out"}
                            </span>
                            <span className="font-semibold">{d.kitQuantity ?? d.quantity} unit(s)</span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between text-muted-foreground">
                            <span className="truncate">{d.location ?? "—"}</span>
                            <span className="flex shrink-0 items-center gap-1">
                              <Clock className="size-3" aria-hidden="true" />
                              {formatDateTime(d.distributedAt)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <QrCode className="size-3.5" aria-hidden="true" /> QR-scanned unit codes
                  </h4>
                  {kitUnits.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No individual QR-labelled units scanned from this batch yet — use Kit Management’s scanner for per-unit handovers.
                    </p>
                  ) : (
                    <ul className="max-h-48 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
                      {kitUnits.map((u) => (
                        <li key={u.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-1.5 text-xs">
                          <span className="font-mono font-medium">{u.code}</span>
                          <span className="flex items-center gap-1 text-muted-foreground">
                            {u.location ?? "—"} · {timeAgo(u.scannedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
