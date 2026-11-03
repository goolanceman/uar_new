"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Info,
  MapPin,
  PackageOpen,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, post } from "@/lib/api-client";
import { formatINR, titleCase } from "@/lib/format";
import { cn, timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

interface Beneficiary {
  id: string;
  name: string;
  city?: string | null;
}

interface Distribution {
  id: string;
  type: string;
  quantity: number;
  value?: number | null;
  location?: string | null;
  notes?: string | null;
  distributedAt: string;
  beneficiary?: { name: string } | null;
  campaign?: { title?: string } | null;
}

interface ItemRow {
  name: string;
  qty: string;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

const TYPES = [
  "FOOD",
  "SANITARY_PADS",
  "MEDICAL",
  "ANIMAL_FEED",
  "EDUCATION_MATERIAL",
  "CLOTHING",
  "CASH",
  "OTHER",
] as const;

const TYPE_STYLES: Record<string, string> = {
  FOOD: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  SANITARY_PADS: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-400",
  MEDICAL: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  ANIMAL_FEED: "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-400",
  EDUCATION_MATERIAL: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  CLOTHING: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  CASH: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  OTHER: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
};

export default function VolunteerDistributions({
  volunteer,
}: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [history, setHistory] = useState<Distribution[]>([]);
  const [loading, setLoading] = useState(true);

  // Form
  const [type, setType] = useState("FOOD");
  const [beneficiaryId, setBeneficiaryId] = useState("walk-in");
  const [quantity, setQuantity] = useState("1");
  const [value, setValue] = useState("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, h] = await Promise.all([
        get<unknown>("/api/beneficiaries").catch(() => []),
        get<unknown>("/api/distributions?mine=1&limit=50"),
      ]);
      setBeneficiaries(asArray<Beneficiary>(b).slice(0, 200));
      setHistory(asArray<Distribution>(h));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load distributions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const useMyArea = () => {
    if (volunteer?.assignedArea) {
      setLocation(volunteer.assignedArea);
    } else {
      toast.info("No area assigned yet — your coordinator sets it on your volunteer profile.");
    }
  };

  const addItemRow = () => setItems((prev) => [...prev, { name: "", qty: "1" }]);
  const removeItemRow = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));
  const updateItemRow = (idx: number, patchRow: Partial<ItemRow>) =>
    setItems((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patchRow } : r)));

  const submit = async () => {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 1) {
      toast.error("Quantity must be at least 1");
      return;
    }
    if (!location.trim()) {
      toast.error("Location is required — use “Use my area” or type the spot");
      return;
    }
    const cleanItems = items
      .map((r) => ({ name: r.name.trim(), qty: Math.max(1, Math.round(Number(r.qty) || 1)) }))
      .filter((r) => r.name.length > 0);
    setSubmitting(true);
    try {
      await post("/api/distributions", {
        type,
        beneficiaryId: beneficiaryId === "walk-in" ? undefined : beneficiaryId,
        quantity: Math.round(qty),
        value: value.trim() ? Number(value) : undefined,
        items: cleanItems.length > 0 ? cleanItems : undefined,
        location: location.trim(),
        notes: notes.trim() || undefined,
      });
      toast.success("Distribution recorded — thank you for being on ground!");
      setType("FOOD");
      setBeneficiaryId("walk-in");
      setQuantity("1");
      setValue("");
      setItems([]);
      setNotes("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record distribution");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Distributions"
        description="Log every handover — it feeds the impact dashboard in real time."
        icon={<PackageOpen className="size-5" />}
      />

      {/* ---------- Record form ---------- */}
      <SectionCard
        title="Record a distribution"
        description="Kits, pads, medicines, feed or cash support — record it as soon as it's handed over."
        icon={<Plus className="size-5" />}
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dist-type">What was distributed?</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="dist-type" className="w-full">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {titleCase(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dist-beneficiary">Beneficiary</Label>
              <Select value={beneficiaryId} onValueChange={setBeneficiaryId}>
                <SelectTrigger id="dist-beneficiary" className="w-full">
                  <SelectValue placeholder="Select beneficiary" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="walk-in">Walk-in (not registered)</SelectItem>
                  {beneficiaries.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                      {b.city ? ` — ${b.city}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dist-qty">Quantity (families / units)</Label>
              <Input
                id="dist-qty"
                type="number"
                min={1}
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dist-value">Estimated value (₹, optional)</Label>
              <Input
                id="dist-value"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="e.g. 4500"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="dist-location">Location (required)</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <MapPin
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="dist-location"
                    className="pl-9"
                    placeholder="e.g. Ejipura community hall"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0 gap-1.5"
                  onClick={useMyArea}
                  aria-label="Prefill location with my assigned area"
                >
                  <MapPin className="size-4" aria-hidden="true" />
                  Use my area
                </Button>
              </div>
            </div>
          </div>

          {/* Items rows */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Item breakdown (optional)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 gap-1 sm:min-h-9"
                onClick={addItemRow}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add item
              </Button>
            </div>
            {items.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                e.g. 20 rice bags + 20 dal packs inside a single distribution.
              </p>
            ) : (
              <div className="space-y-2">
                {items.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      placeholder={`Item ${idx + 1} — e.g. Rice bags`}
                      value={row.name}
                      onChange={(e) => updateItemRow(idx, { name: e.target.value })}
                      aria-label={`Item ${idx + 1} name`}
                    />
                    <Input
                      className="w-20"
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={row.qty}
                      onChange={(e) => updateItemRow(idx, { qty: e.target.value })}
                      aria-label={`Item ${idx + 1} quantity`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                      onClick={() => removeItemRow(idx)}
                      aria-label={`Remove item ${idx + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="dist-notes">Notes (optional)</Label>
            <Textarea
              id="dist-notes"
              rows={3}
              placeholder="Anything the coordinator should know…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button className="min-h-11 gap-1.5" onClick={submit} disabled={submitting}>
            <Send className="size-4" aria-hidden="true" />
            {submitting ? "Recording…" : "Record distribution"}
          </Button>
        </div>
      </SectionCard>

      {/* Pad drive note */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border border-pink-500/30 bg-pink-500/10 p-4 text-sm text-pink-900 dark:text-pink-200"
      >
        <Info className="mt-0.5 size-5 shrink-0 text-pink-600 dark:text-pink-400" aria-hidden="true" />
        <p>
          <span className="font-semibold">Running a school pad drive?</span>{" "}
          Record the pads handed out here with type{" "}
          <Badge
            variant="outline"
            className="mx-0.5 rounded-full border-pink-500/30 bg-pink-500/10 text-[10px] text-pink-700 dark:text-pink-400"
          >
            Sanitary pads
          </Badge>{" "}
          — school-level sessions (girls count, awareness session) are logged
          separately by the coordinator.
        </p>
      </div>

      {/* ---------- My history ---------- */}
      <SectionCard
        title="My history"
        description="Everything you've logged, newest first"
        icon={<PackageOpen className="size-5" />}
      >
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <EmptyState
            icon={<PackageOpen className="size-5" />}
            title="No distributions recorded yet"
            hint="Your first entry will show up here the moment you record a handover."
          />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto pr-1 scrollbar-thin">
            {history.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <PackageOpen className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn("rounded-full text-[10px]", TYPE_STYLES[d.type] ?? TYPE_STYLES.OTHER)}
                    >
                      {titleCase(d.type)}
                    </Badge>
                    {d.beneficiary?.name ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="size-3" aria-hidden="true" />
                        {d.beneficiary.name}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Walk-in</span>
                    )}
                    {d.value ? (
                      <span className="text-xs text-muted-foreground">
                        ≈ {formatINR(d.value)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {d.location ? `${d.location} · ` : ""}
                    {timeAgo(d.distributedAt)}
                    {d.notes ? ` · ${d.notes}` : ""}
                  </p>
                </div>
                <p className="text-sm font-bold">×{d.quantity}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
