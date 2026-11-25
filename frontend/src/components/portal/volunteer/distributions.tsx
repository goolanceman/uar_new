"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Info,
  MapPin,
  PackageOpen,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, post } from "@/lib/api-client";
import { formatINR, formatDateTime, titleCase } from "@/lib/format";
import { cn, timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  TextareaField,
  TextField,
} from "@/components/shared/form-fields";
import { ExportMenu, downloadCsv, type CsvColumn } from "@/components/shared/csv";
import { ViewSwitcher, useViewPref, type DataViewMode } from "@/components/shared/view-switcher";
import { AvailableToDistribute } from "@/components/shared/available-to-distribute";
import { amountRule, fieldError, required } from "@/lib/validators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

const TYPE_OPTIONS = TYPES.map((t) => ({ value: t, label: titleCase(t) }));

// Filter chips above the history list: the six main programme types plus
// "Other" (CASH + anything not in the main set).
type TypeFilterKey = "all" | "other" | (typeof TYPES)[number];

const CORE_TYPE_KEYS: string[] = ["FOOD", "SANITARY_PADS", "MEDICAL", "EDUCATION_MATERIAL", "CLOTHING", "ANIMAL_FEED"];

const TYPE_FILTERS: Array<{ key: TypeFilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "FOOD", label: "Food" },
  { key: "SANITARY_PADS", label: "Sanitary pads" },
  { key: "MEDICAL", label: "Medical" },
  { key: "EDUCATION_MATERIAL", label: "Education" },
  { key: "CLOTHING", label: "Clothing" },
  { key: "ANIMAL_FEED", label: "Animal feed" },
  { key: "other", label: "Other" },
];

function matchesTypeFilter(type: string, filter: TypeFilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "other") return !CORE_TYPE_KEYS.includes(type);
  return type === filter;
}

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

const CSV_COLUMNS: CsvColumn<Distribution>[] = [
  { header: "Type", value: (d) => titleCase(d.type) },
  { header: "Beneficiary", value: (d) => d.beneficiary?.name ?? "Walk-in" },
  { header: "Quantity", value: (d) => d.quantity },
  { header: "Value (INR)", value: (d) => d.value ?? "" },
  { header: "Location", value: (d) => d.location ?? "" },
  { header: "When", value: (d) => formatDateTime(d.distributedAt) },
  { header: "Notes", value: (d) => d.notes ?? "" },
];

interface DistForm {
  type: string;
  beneficiaryId: string; // "walk-in" | Beneficiary.id
  quantity: string;
  value: string;
  location: string;
  notes: string;
}

const EMPTY_FORM: DistForm = {
  type: "FOOD",
  beneficiaryId: "walk-in",
  quantity: "1",
  value: "",
  location: "",
  notes: "",
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilterKey>("all");

  const [form, setForm] = useState<DistForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof DistForm, string | null>>>({});
  const [items, setItems] = useState<ItemRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [view, setView] = useViewPref("volunteer-distributions", "list");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, h] = await Promise.all([
        // Role contract: the directory endpoint is open to ADMIN + VOLUNTEER.
        // Wrapped anyway — if it 403s in some deployment, we degrade to walk-in.
        get<unknown>("/api/beneficiaries").catch(() => []),
        get<unknown>("/api/distributions?mine=1&limit=100"),
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

  const openSheet = () => {
    setForm({ ...EMPTY_FORM, location: volunteer?.assignedArea ?? "" });
    setItems([]);
    setErrors({});
    setSheetOpen(true);
  };

  const useMyArea = () => {
    if (volunteer?.assignedArea) {
      setForm((f) => ({ ...f, location: volunteer.assignedArea ?? "" }));
    } else {
      toast.info("No area assigned yet — your coordinator sets it on your volunteer profile.");
    }
  };

  const addItemRow = () => setItems((prev) => [...prev, { name: "", qty: "1" }]);
  const removeItemRow = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));
  const updateItemRow = (idx: number, patchRow: Partial<ItemRow>) =>
    setItems((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patchRow } : r)));

  const submit = async () => {
    const errs = {
      type: fieldError(form.type, [required("Distribution type")]),
      quantity: fieldError(form.quantity, [
        required("Quantity"),
        amountRule({ min: 1, max: 100_000, label: "Quantity" }),
      ]),
      value: fieldError(form.value, [amountRule({ min: 0, optional: true, label: "Estimated value" })]),
      location: fieldError(form.location, [required("Location")]),
    };
    setErrors(errs);
    if (errs.type || errs.quantity || errs.value || errs.location) return;

    const cleanItems = items
      .map((r) => ({ name: r.name.trim(), qty: Math.max(1, Math.round(Number(r.qty) || 1)) }))
      .filter((r) => r.name.length > 0);

    setSubmitting(true);
    try {
      await post("/api/distributions", {
        type: form.type,
        beneficiaryId: form.beneficiaryId === "walk-in" ? undefined : form.beneficiaryId,
        quantity: Math.round(Number(form.quantity)),
        value: form.value.trim() ? Number(form.value) : undefined,
        items: cleanItems.length > 0 ? cleanItems : undefined,
        location: form.location.trim(),
        notes: form.notes.trim() || undefined,
      });
      toast.success("Distribution recorded — thank you for being on ground!");
      setSheetOpen(false);
      setForm(EMPTY_FORM);
      setItems([]);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record distribution");
    } finally {
      setSubmitting(false);
    }
  };

  const totals = useMemo(
    () => ({
      count: history.length,
      units: history.reduce((s, d) => s + (d.quantity || 0), 0),
      value: history.reduce((s, d) => s + (d.value || 0), 0),
    }),
    [history]
  );

  // Per-chip counts across the full history.
  const typeCounts = useMemo(() => {
    const counts = new Map<TypeFilterKey, number>();
    for (const f of TYPE_FILTERS) counts.set(f.key, 0);
    for (const d of history) {
      counts.set("all", (counts.get("all") ?? 0) + 1);
      const key: TypeFilterKey = CORE_TYPE_KEYS.includes(d.type) ? (d.type as TypeFilterKey) : "other";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [history]);

  const filteredHistory = useMemo(
    () => history.filter((d) => matchesTypeFilter(d.type, typeFilter)),
    [history, typeFilter]
  );

  const filteredSummary = useMemo(
    () => ({
      count: filteredHistory.length,
      units: filteredHistory.reduce((s, d) => s + (d.quantity || 0), 0),
    }),
    [filteredHistory]
  );

  const activeTypeLabel = TYPE_FILTERS.find((f) => f.key === typeFilter)?.label ?? "all";

  const exportCsv = () => {
    if (history.length === 0) {
      toast.info("No distributions to export yet");
      return;
    }
    downloadCsv("uar-my-distributions", CSV_COLUMNS, history);
    toast.success("History exported to CSV");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Distributions"
        description="Log every handover — it feeds the impact dashboard in real time."
        icon={<PackageOpen className="size-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              columns={CSV_COLUMNS}
              rows={history}
              filename="uar-my-distributions"
              disabled={loading || history.length === 0}
            />
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-1.5 sm:min-h-9"
              onClick={load}
              aria-label="Refresh history"
            >
              Refresh
            </Button>
            <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={openSheet}>
              <Plus className="size-4" aria-hidden="true" />
              Record distribution
            </Button>
          </div>
        }
      />

      {/* Totals strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SectionCard title="Handovers logged" icon={<PackageOpen className="size-5" />}>
          {loading ? <Skeleton className="h-7 w-16" /> : <p className="text-2xl font-bold">{totals.count}</p>}
        </SectionCard>
        <SectionCard title="Families / units reached" icon={<Users className="size-5" />}>
          {loading ? <Skeleton className="h-7 w-16" /> : <p className="text-2xl font-bold">{totals.units}</p>}
        </SectionCard>
        <SectionCard title="Recorded value" icon={<Info className="size-5" />}>
          {loading ? <Skeleton className="h-7 w-16" /> : <p className="text-2xl font-bold">{formatINR(totals.value)}</p>}
        </SectionCard>
      </div>

      {/* Pad drive note */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border border-pink-500/30 bg-pink-500/10 p-4 text-sm text-pink-900 dark:text-pink-200"
      >
        <Info className="mt-0.5 size-5 shrink-0 text-pink-600 dark:text-pink-400" aria-hidden="true" />
        <p>
          <span className="font-semibold">Running a school pad drive?</span> Record the pads
          handed out here with type{" "}
          <Badge
            variant="outline"
            className="mx-0.5 rounded-full border-pink-500/30 bg-pink-500/10 text-[10px] text-pink-700 dark:text-pink-400"
          >
            Sanitary pads
          </Badge>{" "}
          — school-level sessions (girls count, awareness session) are logged separately by
          the coordinator.
        </p>
      </div>

      {/* ---------- Available to distribute ---------- */}
      <SectionCard
        title="Available to distribute"
        description="Everything in stock or packed as kits right now — tap any card to hand it out in one step."
        icon={<PackageOpen className="size-5" />}
      >
        <AvailableToDistribute
          beneficiaries={beneficiaries}
          defaultLocation={volunteer?.assignedArea ?? ""}
          onDistributed={load}
        />
      </SectionCard>

      {/* ---------- My history ---------- */}
      <SectionCard
        title="My history"
        description="Everything you've logged, newest first"
        icon={<PackageOpen className="size-5" />}
        actions={<ViewSwitcher value={view} onChange={(m: DataViewMode) => setView(m)} options={["table", "list"]} />}
      >
        {/* Type filter chips + summary */}
        <div className="space-y-2">
          <div
            role="group"
            aria-label="Filter distributions by type"
            className="flex flex-wrap items-center gap-1.5"
          >
            {TYPE_FILTERS.map(({ key, label }) => {
              const active = typeFilter === key;
              return (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "min-h-9 gap-1.5 rounded-full px-3 text-xs",
                    active && "border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                  )}
                  onClick={() => setTypeFilter((prev) => (prev === key ? "all" : key))}
                  aria-pressed={active}
                >
                  {label}
                  <span className="rounded-full bg-background/60 px-1.5 text-[10px] font-semibold tabular-nums">
                    {typeCounts.get(key) ?? 0}
                  </span>
                </Button>
              );
            })}
          </div>
          {typeFilter !== "all" && !loading && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {filteredSummary.count} handovers · {filteredSummary.units} units
            </p>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <EmptyState
            icon={<PackageOpen className="size-5" />}
            title="No distributions recorded yet"
            hint="Record your first handover — it takes under a minute and keeps the impact numbers honest."
          >
            <Button className="min-h-11 gap-1.5" onClick={openSheet}>
              <Plus className="size-4" aria-hidden="true" />
              Record distribution
            </Button>
          </EmptyState>
        ) : filteredHistory.length === 0 ? (
          <EmptyState
            icon={<PackageOpen className="size-5" />}
            title={`No ${activeTypeLabel.toLowerCase()} handovers yet`}
            hint="Try a different type filter to see the rest of your history."
          >
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-1.5 sm:min-h-9"
              onClick={() => setTypeFilter("all")}
            >
              Show all types
            </Button>
          </EmptyState>
        ) : view === "table" ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Beneficiary</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Value</TableHead>
                  <TableHead className="hidden md:table-cell">Location</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <span className={cn("rounded-full border px-1.5 text-[10px]", TYPE_STYLES[d.type] ?? TYPE_STYLES.OTHER)}>
                        {titleCase(d.type)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-40 truncate">{d.beneficiary?.name ?? "Walk-in"}</TableCell>
                    <TableCell className="text-right font-semibold">×{d.quantity}</TableCell>
                    <TableCell className="hidden text-right text-muted-foreground md:table-cell">
                      {d.value ? formatINR(d.value) : "—"}
                    </TableCell>
                    <TableCell className="hidden max-w-48 truncate text-muted-foreground md:table-cell">
                      {d.location ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                      {formatDateTime(d.distributedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto pr-1 scrollbar-thin">
            {filteredHistory.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <PackageOpen className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full border px-1.5 text-[10px]", TYPE_STYLES[d.type] ?? TYPE_STYLES.OTHER)}>
                      {titleCase(d.type)}
                    </span>
                    {d.beneficiary?.name ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="size-3" aria-hidden="true" />
                        {d.beneficiary.name}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Walk-in</span>
                    )}
                    {d.value ? (
                      <span className="text-xs text-muted-foreground">≈ {formatINR(d.value)}</span>
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

      {/* ---------- Record FormSheet ---------- */}
      <FormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Record a distribution"
        description="Kits, pads, medicines, feed or cash support — record it as soon as it's handed over."
        submitLabel="Record distribution"
        loading={submitting}
        dirty={form.location.trim().length > 0 || form.notes.trim().length > 0 || form.quantity !== "1" || Boolean(form.value.trim())}
        size="md"
        onSubmit={submit}
        footerExtra={<span className="hidden sm:inline">Feeds the public impact numbers</span>}
      >
        <FormSection title="What was handed over" description="Count only what physically left with a family.">
          <FieldGrid>
            <SelectField
              label="Type"
              required
              value={form.type}
              onChange={(v) => setForm((f) => ({ ...f, type: v }))}
              options={TYPE_OPTIONS as Array<{ value: string; label: string }>}
              error={errors.type}
            />
            <SelectField
              label="Beneficiary"
              value={form.beneficiaryId}
              onChange={(v) => setForm((f) => ({ ...f, beneficiaryId: v }))}
              options={[
                { value: "walk-in", label: "Walk-in (not registered)" },
                ...beneficiaries.map((b) => ({
                  value: b.id,
                  label: b.city ? `${b.name} — ${b.city}` : b.name,
                })),
              ]}
              hint={beneficiaries.length === 0 ? "Directory unavailable — walk-in is fine" : undefined}
            />
          </FieldGrid>
          <FieldGrid>
            <TextField
              label="Quantity (families / units)"
              required
              inputMode="numeric"
              value={form.quantity}
              onChange={(v) => setForm((f) => ({ ...f, quantity: v.replace(/[^\d]/g, "") }))}
              error={errors.quantity}
            />
            <TextField
              label="Estimated value"
              prefix="₹"
              inputMode="numeric"
              placeholder="e.g. 4500"
              value={form.value}
              onChange={(v) => setForm((f) => ({ ...f, value: v.replace(/[^\d]/g, "") }))}
              error={errors.value}
              hint="Optional — rough market value of the handover"
            />
          </FieldGrid>
          <TextField
            label="Location"
            required
            value={form.location}
            onChange={(v) => setForm((f) => ({ ...f, location: v }))}
            error={errors.location}
            hint="Where the handover happened"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 gap-1.5 sm:min-h-9"
              onClick={useMyArea}
              aria-label="Prefill location with my assigned area"
            >
              <MapPin className="size-4" aria-hidden="true" />
              Use my area{volunteer?.assignedArea ? ` (${volunteer.assignedArea})` : ""}
            </Button>
          </div>
        </FormSection>

        <FormSection title="Item breakdown (optional)" description="e.g. 20 rice bags + 20 dal packs inside a single distribution.">
          {items.length === 0 ? (
            <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1 sm:min-h-9" onClick={addItemRow}>
              <Plus className="size-4" aria-hidden="true" />
              Add item
            </Button>
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
              <Button type="button" variant="ghost" size="sm" className="min-h-11 gap-1 sm:min-h-9" onClick={addItemRow}>
                <Plus className="size-4" aria-hidden="true" />
                Add another
              </Button>
            </div>
          )}
        </FormSection>

        <FormSection title="Notes" description="Anything the coordinator should know.">
          <TextareaField
            label="Notes (optional)"
            rows={3}
            placeholder="e.g. Ration kits handed to 18 widows registered with the Anganwadi…"
            value={form.notes}
            onChange={(v) => setForm((f) => ({ ...f, notes: v }))}
          />
        </FormSection>
      </FormSheet>
    </div>
  );
}
