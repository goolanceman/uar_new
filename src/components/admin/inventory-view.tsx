"use client";

/**
 * Inventory — round-5: DataTable (fill height, skeleton rows, built-in
 * pagination), low-stock warning tint + badges, "Restock" quick action with
 * prefilled quantity, full-screen DetailSheet with stock-health progress and
 * movement quick-stats, lg FormSheet with expiry shown only for perishable
 * categories, grid/list views, filter chips and CSV export.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  Gauge,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters, type MasterOption } from "@/hooks/use-masters";
import { formatDate, formatINR, titleCase } from "@/lib/format";
import { dateRule } from "@/lib/validators";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { StatusBadge } from "@/components/shared/status-badge";
import { CsvColumn, ExportMenu } from "@/components/shared/csv";
import {
  DataViewMode,
  PaginationBar,
  useViewPref,
  ViewSwitcher,
} from "@/components/shared/view-switcher";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ---------------------------------- types ---------------------------------- */

interface InventoryItem {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  unit: string;
  quantity: number;
  minStock: number;
  pricePerUnit?: number | null;
  location?: string | null;
  expiryDate?: string | null;
}

interface Purchase {
  id: string;
  quantity: number;
  pricePerUnit?: number | null;
  supplier?: string | null;
  invoiceNumber?: string | null;
  purchaseDate?: string | null;
}

interface ItemForm {
  name: string;
  description: string;
  category: string;
  unit: string;
  quantity: string;
  minStock: string;
  pricePerUnit: string;
  location: string;
  expiryDate: string;
}

interface StockForm {
  quantity: string;
  pricePerUnit: string;
  supplier: string;
  invoiceNumber: string;
}

const EMPTY_ITEM_FORM: ItemForm = {
  name: "",
  description: "",
  category: "RATION",
  unit: "pcs",
  quantity: "0",
  minStock: "10",
  pricePerUnit: "",
  location: "",
  expiryDate: "",
};

const EMPTY_STOCK_FORM: StockForm = {
  quantity: "",
  pricePerUnit: "",
  supplier: "",
  invoiceNumber: "",
};

function isLowStock(i: InventoryItem): boolean {
  return i.quantity <= i.minStock;
}

function isExpiring(i: InventoryItem): boolean {
  if (!i.expiryDate) return false;
  const d = new Date(i.expiryDate);
  if (Number.isNaN(d.getTime())) return false;
  const in30 = Date.now() + 30 * 24 * 60 * 60 * 1000;
  return d.getTime() <= in30;
}

function daysToExpiry(i: InventoryItem): number | null {
  if (!i.expiryDate) return null;
  const d = new Date(i.expiryDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

/** Healthy-level progress: 100% means stock is at 2× the minimum. */
function stockPct(i: InventoryItem): number {
  const healthy = Math.max(i.minStock * 2, 1);
  return Math.min(100, Math.round((i.quantity / healthy) * 100));
}

/** Expiry only applies to perishable categories (food, medicine, feed). */
function isPerishable(category: string): boolean {
  const c = (category ?? "").toUpperCase();
  return c.includes("FOOD") || c.includes("MEDICINE") || c.includes("FEED") || c.includes("PADS");
}

/** Suggested restock quantity to bring the item back to 2× its minimum. */
function restockQty(i: InventoryItem): number {
  return Math.max(i.minStock * 2 - i.quantity, 10);
}

/* ---------------------------------- view ----------------------------------- */

export default function InventoryView() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  /* toolbar */
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [catFilter, setCatFilter] = useState("ALL");
  const [lowOnly, setLowOnly] = useState(false);
  const [view, setView] = useViewPref("inventory");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /* forms */
  const [sheet, setSheet] = useState<InventoryItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_ITEM_FORM);
  const [formSnapshot, setFormSnapshot] = useState<string>(JSON.stringify(EMPTY_ITEM_FORM));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);

  /* stock-in */
  const [stockTarget, setStockTarget] = useState<InventoryItem | null>(null);
  const [stockForm, setStockForm] = useState<StockForm>(EMPTY_STOCK_FORM);
  const [addingStock, setAddingStock] = useState(false);

  /* purchase history (derived if the API ever returns it) */
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);

  const categoryOptions = useMasters("INVENTORY_CATEGORY");
  const unitOptions = useMasters("UNIT");

  const load = useCallback(async () => {
    try {
      const data = await get<InventoryItem[]>("/api/inventory");
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* debounce search input → applied filter */
  useEffect(() => {
    const t = window.setTimeout(() => {
      setAppliedQuery(query);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  /* merge MDM categories/units with values actually present on items */
  const mergedCategories: MasterOption[] = useMemo(() => {
    const seen = new Set(categoryOptions.options.map((o) => o.value));
    const extras = items
      .map((i) => i.category)
      .filter((c) => c && !seen.has(c))
      .map((c) => ({ value: c, label: titleCase(c) }));
    return [...categoryOptions.options, ...extras];
  }, [categoryOptions.options, items]);

  const mergedUnits: MasterOption[] = useMemo(() => {
    const seen = new Set(unitOptions.options.map((o) => o.value));
    const extras = items
      .map((i) => i.unit)
      .filter((u) => u && !seen.has(u))
      .map((u) => ({ value: u, label: u }));
    return [...unitOptions.options, ...extras];
  }, [unitOptions.options, items]);

  const filtered = useMemo(() => {
    const q = appliedQuery.trim().toLowerCase();
    return items.filter((i) => {
      if (lowOnly && !isLowStock(i)) return false;
      if (catFilter !== "ALL" && i.category !== catFilter) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        (i.location ?? "").toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
      );
    });
  }, [items, appliedQuery, catFilter, lowOnly]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, pages);
  const paged = useMemo(
    () => filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize),
    [filtered, pageSafe, pageSize]
  );

  const stats = useMemo(
    () => ({
      total: items.length,
      low: items.filter(isLowStock).length,
      value: items.reduce((s, i) => s + (i.pricePerUnit ?? 0) * i.quantity, 0),
      expiring: items.filter(isExpiring).length,
    }),
    [items]
  );

  const hasFilters = catFilter !== "ALL" || lowOnly || appliedQuery.trim() !== "";

  const clearFilters = () => {
    setQuery("");
    setCatFilter("ALL");
    setLowOnly(false);
    setPage(1);
  };

  /* ------------------------------ form actions ----------------------------- */

  const openCreate = () => {
    setEditing(null);
    const f: ItemForm = {
      ...EMPTY_ITEM_FORM,
      category: mergedCategories[0]?.value ?? "OTHER",
      unit: mergedUnits[0]?.value ?? "pcs",
    };
    setForm(f);
    setFormSnapshot(JSON.stringify(f));
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (i: InventoryItem) => {
    setEditing(i);
    const f: ItemForm = {
      name: i.name ?? "",
      description: i.description ?? "",
      category: i.category ?? "OTHER",
      unit: i.unit ?? "pcs",
      quantity: String(i.quantity ?? 0),
      minStock: String(i.minStock ?? 0),
      pricePerUnit: i.pricePerUnit != null ? String(i.pricePerUnit) : "",
      location: i.location ?? "",
      expiryDate: i.expiryDate ? i.expiryDate.slice(0, 10) : "",
    };
    setForm(f);
    setFormSnapshot(JSON.stringify(f));
    setErrors({});
    setFormOpen(true);
  };

  const formDirty = formOpen && JSON.stringify(form) !== formSnapshot;

  const save = async () => {
    const nextErrors: Record<string, string | undefined> = {};
    if (!form.name.trim()) nextErrors.name = "Item name is required";
    const qty = Number(form.quantity);
    if (!Number.isFinite(qty) || qty < 0) nextErrors.quantity = "Quantity must be 0 or more";
    const min = Number(form.minStock);
    if (!Number.isFinite(min) || min < 0) nextErrors.minStock = "Minimum stock must be 0 or more";
    if (form.pricePerUnit) {
      const price = Number(form.pricePerUnit);
      if (!Number.isFinite(price) || price < 0) nextErrors.pricePerUnit = "Price per unit must be 0 or more";
    }
    const dateErr = dateRule(true)(form.expiryDate);
    if (dateErr) nextErrors.expiryDate = dateErr;
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error(Object.values(nextErrors)[0] as string);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        category: form.category,
        unit: form.unit,
        quantity: Math.trunc(qty),
        minStock: Math.trunc(min),
        pricePerUnit: form.pricePerUnit === "" ? undefined : Number(form.pricePerUnit),
        location: form.location.trim() || undefined,
        expiryDate: isPerishable(form.category) && form.expiryDate ? form.expiryDate : undefined,
      };
      if (editing) {
        await patch(`/api/inventory/${editing.id}`, body);
        toast.success(`${body.name} updated`);
      } else {
        await post("/api/inventory", body);
        toast.success(`${body.name} added to inventory`);
      }
      setFormOpen(false);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  /** Open the stock-in sheet, optionally prefilling a suggested restock qty. */
  const openStockIn = (i: InventoryItem, prefill = false) => {
    setStockTarget(i);
    setStockForm({
      ...EMPTY_STOCK_FORM,
      quantity: prefill ? String(restockQty(i)) : "",
    });
  };

  const stockDirty =
    !!stockTarget &&
    (stockForm.quantity.trim() !== "" ||
      stockForm.pricePerUnit.trim() !== "" ||
      stockForm.supplier.trim() !== "" ||
      stockForm.invoiceNumber.trim() !== "");

  const addStock = async () => {
    if (!stockTarget) return;
    const qty = Math.trunc(Number(stockForm.quantity));
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Quantity to add must be at least 1");
      return;
    }
    if (stockForm.pricePerUnit) {
      const price = Number(stockForm.pricePerUnit);
      if (!Number.isFinite(price) || price < 0) {
        toast.error("Price per unit must be 0 or more");
        return;
      }
    }
    setAddingStock(true);
    try {
      const body: Record<string, unknown> = { addQuantity: qty };
      if (stockForm.pricePerUnit !== "") body.pricePerUnit = Number(stockForm.pricePerUnit);
      if (stockForm.supplier.trim()) body.supplier = stockForm.supplier.trim();
      if (stockForm.invoiceNumber.trim()) body.invoiceNumber = stockForm.invoiceNumber.trim();
      await patch(`/api/inventory/${stockTarget.id}`, body);
      toast.success(
        `+${qty} ${stockTarget.unit} added to ${stockTarget.name}${
          stockForm.supplier.trim() ? ` (supplier: ${stockForm.supplier.trim()})` : ""
        }`
      );
      setStockTarget(null);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add stock failed");
    } finally {
      setAddingStock(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await del(`/api/inventory/${deleteTarget.id}`);
      toast.success(`${deleteTarget.name} removed from inventory`);
      setDeleteTarget(null);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  /* --------------------------- detail: purchases --------------------------- */

  const openSheet = (i: InventoryItem) => {
    setSheet(i);
    setPurchases(null);
    // Forward-compatible: if the item endpoint ever returns purchases, show them.
    get<{ purchases?: Purchase[] }>(`/api/inventory/${i.id}`)
      .then((r) => {
        setPurchases(Array.isArray(r?.purchases) ? r.purchases : []);
      })
      .catch(() => setPurchases([]));
  };

  /* ------------------------------ small pieces ----------------------------- */

  const expiryChip = (i: InventoryItem) =>
    i.expiryDate ? (
      <StatusBadge
        tone={isExpiring(i) ? "danger" : "neutral"}
        className={isExpiring(i) ? "" : "text-muted-foreground"}
      >
        <CalendarClock className="size-3" aria-hidden="true" />
        {isExpiring(i) ? "Expires " : "Exp. "}
        {formatDate(i.expiryDate)}
      </StatusBadge>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );

  const rowActions = (i: InventoryItem) => (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn("min-h-9", isLowStock(i) && "border-amber-500/50 text-amber-700 dark:text-amber-400")}
        onClick={(e) => {
          e.stopPropagation();
          openStockIn(i, isLowStock(i));
        }}
        aria-label={`Restock ${i.name}`}
      >
        <PackagePlus className="size-3.5" aria-hidden="true" />
        <span className="hidden lg:inline">{isLowStock(i) ? "Restock" : "Stock in"}</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="min-h-9"
        onClick={(e) => {
          e.stopPropagation();
          openEdit(i);
        }}
        aria-label={`Edit ${i.name}`}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="min-h-9 text-red-600 hover:bg-red-500/10 dark:text-red-400"
        onClick={(e) => {
          e.stopPropagation();
          setDeleteTarget(i);
        }}
        aria-label={`Delete ${i.name}`}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </>
  );

  const csvColumns: CsvColumn<InventoryItem>[] = useMemo(
    () => [
      { header: "Name", value: (i) => i.name },
      { header: "Category", value: (i) => i.category },
      { header: "Quantity", value: (i) => i.quantity },
      { header: "Unit", value: (i) => i.unit },
      { header: "Min stock", value: (i) => i.minStock },
      { header: "Low stock", value: (i) => (isLowStock(i) ? "YES" : "NO") },
      { header: "Price per unit (INR)", value: (i) => i.pricePerUnit ?? "" },
      { header: "Stock value (INR)", value: (i) => Math.round((i.pricePerUnit ?? 0) * i.quantity) },
      { header: "Location", value: (i) => i.location ?? "" },
      { header: "Expiry", value: (i) => i.expiryDate ? formatDate(i.expiryDate) : "" },
    ],
    []
  );

  /* ------------------------------- table columns ----------------------------- */

  const columns: DataTableColumn<InventoryItem>[] = [
    { key: "name", header: "Item" },
    { key: "category", header: "Category", hideBelow: "md" },
    { key: "stock", header: "Stock", align: "right" },
    { key: "min", header: "Min", align: "right", hideBelow: "sm" },
    { key: "price", header: "Unit price", align: "right", mono: true, hideBelow: "sm" },
    { key: "location", header: "Location", hideBelow: "lg" },
    { key: "expiry", header: "Expiry", hideBelow: "md" },
    { key: "actions", header: "", align: "right", className: "w-32" },
  ];

  const sheetItem = sheet ? (items.find((x) => x.id === sheet.id) ?? sheet) : null;

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Stock of aid supplies — ration, pads, medicine, feed and equipment."
        icon={<Boxes className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={load} aria-label="Refresh inventory">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" /> New item
            </Button>
          </>
        }
      />

      {/* stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total items" value={stats.total} accent="emerald" icon={<Boxes className="size-5" aria-hidden="true" />} loading={loading} />
        <button
          type="button"
          onClick={() => {
            setLowOnly((v) => !v);
            setPage(1);
          }}
          aria-pressed={lowOnly}
          aria-label="Toggle low-stock filter"
          className="w-full rounded-xl text-left focus-visible:outline-2 focus-visible:outline-primary"
        >
          <StatCard
            label="Low stock"
            value={stats.low}
            accent="amber"
            icon={<AlertTriangle className="size-5" aria-hidden="true" />}
            loading={loading}
            hint={lowOnly ? "Filter on — click to clear" : "At or below minimum — click to filter"}
            className={cn("h-full transition", lowOnly && "ring-2 ring-amber-500/50")}
          />
        </button>
        <StatCard label="Stock value" value={formatINR(stats.value)} accent="teal" icon={<Package className="size-5" aria-hidden="true" />} loading={loading} hint="Qty × unit price" />
        <StatCard
          label="Expiring ≤30 days"
          value={stats.expiring}
          accent="red"
          icon={<CalendarClock className="size-5" aria-hidden="true" />}
          loading={loading}
        />
      </div>

      {/* toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, location…"
              aria-label="Search inventory"
              className="pl-9"
            />
          </div>
          <Select
            value={catFilter}
            onValueChange={(v) => {
              setCatFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-48" aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {mergedCategories.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={lowOnly ? "default" : "outline"}
            size="sm"
            className="min-h-9"
            onClick={() => {
              setLowOnly((v) => !v);
              setPage(1);
            }}
            aria-pressed={lowOnly}
          >
            <AlertTriangle className="size-4" aria-hidden="true" /> Low stock
          </Button>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="min-h-9" onClick={clearFilters} aria-label="Clear filters">
              Clear
            </Button>
          )}
          <Button size="sm" className="min-h-9 sm:ml-auto" onClick={openCreate}>
            <Plus className="size-4" aria-hidden="true" /> Add item
          </Button>
        </div>
        {/* active filter chips */}
        {hasFilters && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {appliedQuery.trim() !== "" && (
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                Search: <strong className="font-semibold text-foreground">{appliedQuery.trim()}</strong>
              </span>
            )}
            {catFilter !== "ALL" && (
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                Category: <strong className="font-semibold text-foreground">{labelOf(mergedCategories, catFilter)}</strong>
              </span>
            )}
            {lowOnly && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                Low stock only
              </span>
            )}
            <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
              {loading ? "Loading…" : `${filtered.length} of ${items.length} item${items.length === 1 ? "" : "s"}`}
            </span>
          </div>
        )}
      </div>

      {/* table view */}
      {view === "table" ? (
        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(i) => i.id}
          loading={loading}
          skeletonRows={8}
          height="fill"
          fillOffset={330}
          onRowClick={openSheet}
          page={pageSafe}
          pages={pages}
          total={filtered.length}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          itemLabel="items"
          empty={
            items.length === 0 ? (
              <EmptyState
                icon={<Boxes className="size-8" aria-hidden="true" />}
                title="Inventory is empty"
                hint="Add the first stock item — ration kits, pads, medicine or equipment."
              >
                <Button onClick={openCreate}>
                  <Plus className="size-4" aria-hidden="true" /> New item
                </Button>
              </EmptyState>
            ) : (
              <EmptyState
                icon={<Search className="size-8" aria-hidden="true" />}
                title="No items match the filters"
                hint="Try a different search term, category or clear the low-stock filter."
              >
                <Button variant="outline" onClick={clearFilters}>
                  Reset filters
                </Button>
              </EmptyState>
            )
          }
        >
          {(i, col) => {
            switch (col.key) {
              case "name":
                return (
                  <div
                    className={cn(
                      "min-w-0 border-l-2 py-0.5 pl-2",
                      isLowStock(i) ? "border-amber-500/70" : "border-transparent"
                    )}
                  >
                    <p className="truncate font-medium">{i.name}</p>
                    {isLowStock(i) ? (
                      <StatusBadge tone="warning" className="mt-0.5">
                        <AlertTriangle className="size-3" aria-hidden="true" /> Low — reorder
                      </StatusBadge>
                    ) : null}
                  </div>
                );
              case "category":
                return <span className="text-sm">{labelOf(mergedCategories, i.category)}</span>;
              case "stock":
                return (
                  <span
                    className={cn(
                      "inline-flex items-center justify-end gap-1 font-medium tabular-nums",
                      isLowStock(i) && "text-amber-700 dark:text-amber-400"
                    )}
                  >
                    {isLowStock(i) && <AlertTriangle className="size-3.5" aria-hidden="true" />}
                    {i.quantity} {i.unit}
                  </span>
                );
              case "min":
                return <span className="text-muted-foreground tabular-nums">{i.minStock}</span>;
              case "price":
                return <span>{i.pricePerUnit != null ? formatINR(i.pricePerUnit) : "—"}</span>;
              case "location":
                return <span className="block max-w-36 truncate text-sm text-muted-foreground">{i.location || "—"}</span>;
              case "expiry":
                return expiryChip(i);
              case "actions":
                return <div className="flex justify-end gap-1.5">{rowActions(i)}</div>;
              default:
                return null;
            }
          }}
        </DataTable>
      ) : null}

      {/* grid view */}
      {view === "grid" ? (
        loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search className="size-8" aria-hidden="true" />}
            title="No items match the filters"
            hint="Try a different search term, category or clear the low-stock filter."
          >
            <Button variant="outline" onClick={clearFilters}>
              Reset filters
            </Button>
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {paged.map((i) => {
              const pct = stockPct(i);
              return (
                <div
                  key={i.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition",
                    isLowStock(i) && "border-amber-500/40 bg-amber-500/5"
                  )}
                >
                  <button
                    type="button"
                    className="flex items-start gap-2 text-left"
                    onClick={() => openSheet(i)}
                    aria-label={`Open ${i.name}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold leading-tight">{i.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {labelOf(mergedCategories, i.category)} · {i.location || "No location"}
                      </p>
                    </div>
                    {isLowStock(i) && (
                      <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                    )}
                  </button>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className={cn("font-medium tabular-nums", isLowStock(i) && "text-amber-700 dark:text-amber-400")}>
                        {i.quantity} {i.unit} in stock
                      </span>
                      <span className="text-muted-foreground tabular-nums">min {i.minStock}</span>
                    </div>
                    <Progress
                      value={pct}
                      className={cn("h-2", isLowStock(i) ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-600")}
                      aria-label={`Stock at ${pct}% of healthy level`}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone="neutral">{i.pricePerUnit != null ? formatINR(i.pricePerUnit) : "No price"}</StatusBadge>
                    {expiryChip(i)}
                  </div>
                  <div className="mt-auto flex gap-1.5 border-t pt-3">{rowActions(i)}</div>
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {/* list view */}
      {view === "list" ? (
        loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search className="size-8" aria-hidden="true" />}
            title="No items match the filters"
            hint="Try a different search term, category or clear the low-stock filter."
          >
            <Button variant="outline" onClick={clearFilters}>
              Reset filters
            </Button>
          </EmptyState>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin" role="list" aria-label="Inventory items">
            {paged.map((i) => (
              <div
                key={i.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3",
                  isLowStock(i) && "border-amber-500/40 bg-amber-500/5"
                )}
                role="listitem"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted",
                    isLowStock(i) ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  <Package className="size-4" />
                </span>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openSheet(i)} aria-label={`Open ${i.name}`}>
                  <p className="truncate text-sm font-medium">{i.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {labelOf(mergedCategories, i.category)} · {i.location || "No location"}
                    {i.expiryDate ? ` · exp. ${formatDate(i.expiryDate)}` : ""}
                  </p>
                </button>
                <span className="hidden text-xs text-muted-foreground tabular-nums sm:block">min {i.minStock}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-sm font-medium tabular-nums",
                    isLowStock(i) && "text-amber-700 dark:text-amber-400"
                  )}
                >
                  {isLowStock(i) && <AlertTriangle className="size-3.5" aria-hidden="true" />}
                  {i.quantity} {i.unit}
                </span>
                {rowActions(i)}
              </div>
            ))}
          </div>
        )
      ) : null}

      {/* pagination for grid/list (table paginates inside DataTable) */}
      {view !== "table" && !loading && filtered.length > 0 ? (
        <PaginationBar
          page={pageSafe}
          pages={pages}
          total={filtered.length}
          onPage={setPage}
          itemLabel="items"
        />
      ) : null}

      {/* ============================== DETAIL SHEET ============================= */}
      <DetailSheet
        open={!!sheetItem}
        onOpenChange={(o) => !o && setSheet(null)}
        eyebrow="Inventory"
        title={sheetItem?.name ?? "Item"}
        description={sheetItem ? `${labelOf(mergedCategories, sheetItem.category)} · ${sheetItem.location || "No location"}` : ""}
        status={
          sheetItem ? (
            isLowStock(sheetItem) ? (
              <StatusBadge tone="warning">
                <AlertTriangle className="size-3" aria-hidden="true" /> Low stock
              </StatusBadge>
            ) : (
              <StatusBadge tone="success">Healthy</StatusBadge>
            )
          ) : undefined
        }
        actions={
          sheetItem ? (
            <>
              <Button size="sm" onClick={() => openStockIn(sheetItem, isLowStock(sheetItem))}>
                <PackagePlus className="size-3.5" aria-hidden="true" /> Stock in
              </Button>
              <Button size="sm" variant="outline" onClick={() => openEdit(sheetItem)}>
                <Pencil className="size-3.5" aria-hidden="true" /> Edit
              </Button>
            </>
          ) : undefined
        }
      >
        {sheetItem ? (
          <>
            {isLowStock(sheetItem) && (
              <div
                className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-800 dark:text-amber-300"
                role="alert"
              >
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                At or below minimum stock ({sheetItem.minStock} {sheetItem.unit}) — reorder soon.
              </div>
            )}
            {isExpiring(sheetItem) && (
              <div
                className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-800 dark:text-red-300"
                role="alert"
              >
                <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
                Expires {formatDate(sheetItem.expiryDate)} — use or discard before hand-out.
              </div>
            )}

            <DetailSection title="Stock health" description="Quantity against the reorder minimum.">
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className={cn("font-medium tabular-nums", isLowStock(sheetItem) && "text-amber-700 dark:text-amber-400")}>
                    {sheetItem.quantity} {sheetItem.unit} in stock
                  </span>
                  <span className="text-muted-foreground tabular-nums">min {sheetItem.minStock} {sheetItem.unit}</span>
                </div>
                <Progress
                  value={stockPct(sheetItem)}
                  className={cn("h-2.5", isLowStock(sheetItem) ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-600")}
                  aria-label={`Stock at ${stockPct(sheetItem)}% of healthy level`}
                />
                <p className="text-xs text-muted-foreground">
                  {stockPct(sheetItem)}% of the healthy level (2× minimum) ·{" "}
                  {restockQty(sheetItem)} {sheetItem.unit} would restore it.
                </p>
              </div>
              <DetailGrid cols={2} className="mt-4">
                <DataField label="In stock" value={`${sheetItem.quantity} ${sheetItem.unit}`} />
                <DataField label="Minimum stock" value={`${sheetItem.minStock} ${sheetItem.unit}`} />
                <DataField label="Price per unit" value={sheetItem.pricePerUnit != null ? formatINR(sheetItem.pricePerUnit) : ""} mono />
                <DataField label="Stock value" value={formatINR((sheetItem.pricePerUnit ?? 0) * sheetItem.quantity)} mono />
                <DataField label="Location" value={sheetItem.location} />
                <DataField
                  label="Expiry"
                  value={sheetItem.expiryDate ? formatDate(sheetItem.expiryDate) : ""}
                />
              </DetailGrid>
            </DetailSection>

            {sheetItem.description ? (
              <DetailSection title="Description">
                <p className="text-sm leading-relaxed text-muted-foreground">{sheetItem.description}</p>
              </DetailSection>
            ) : null}

            <DetailSection
              title="Movement quick-stats"
              description="Live stock position and recorded stock-ins for this item."
            >
              <DetailGrid cols={2}>
                <DataField
                  label="Health"
                  icon={<Gauge className="size-3" aria-hidden="true" />}
                  value={
                    <StatusBadge tone={isLowStock(sheetItem) ? "warning" : "success"}>
                      {stockPct(sheetItem)}% of healthy level
                    </StatusBadge>
                  }
                />
                <DataField label="Units to healthy" value={`${restockQty(sheetItem)} ${sheetItem.unit}`} />
                <DataField
                  label="Expiry state"
                  value={
                    sheetItem.expiryDate ? (
                      <StatusBadge tone={isExpiring(sheetItem) ? "danger" : "neutral"}>
                        {isExpiring(sheetItem) ? `Expires in ${daysToExpiry(sheetItem)} day${(daysToExpiry(sheetItem) ?? 0) === 1 ? "" : "s"}` : "Not near expiry"}
                      </StatusBadge>
                    ) : (
                      "No expiry tracked"
                    )
                  }
                />
                <DataField label="Stock-ins recorded" value={purchases === null ? "" : String(purchases.length)} />
              </DetailGrid>
              <div className="mt-4">
                {purchases === null ? (
                  <div className="space-y-2" aria-busy="true">
                    <Skeleton className="h-9 rounded-lg" />
                    <Skeleton className="h-9 rounded-lg" />
                  </div>
                ) : purchases.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    The inventory API doesn&apos;t return purchase records yet — stock-ins are applied as
                    direct quantity updates and supplier/invoice notes land in the activity log.
                  </p>
                ) : (
                  <ul className="max-h-56 space-y-1.5 overflow-y-auto text-sm scrollbar-thin" aria-label="Stock-in history">
                    {purchases.map((p) => (
                      <li key={p.id} className="rounded-md bg-muted/50 px-2.5 py-1.5">
                        <span className="font-medium tabular-nums">+{p.quantity}</span>
                        {p.pricePerUnit != null ? ` @ ${formatINR(p.pricePerUnit)}` : ""}
                        {p.supplier ? ` · ${p.supplier}` : ""}
                        {p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}
                        {p.purchaseDate ? (
                          <span className="block text-xs text-muted-foreground">{formatDate(p.purchaseDate)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </DetailSection>

            <DetailSection title="Manage">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => openStockIn(sheetItem, isLowStock(sheetItem))}>
                  <PackagePlus className="size-4" aria-hidden="true" /> Stock in
                </Button>
                <Button variant="outline" onClick={() => openEdit(sheetItem)}>
                  <Pencil className="size-4" aria-hidden="true" /> Edit item
                </Button>
                <Button
                  variant="outline"
                  className="ml-auto text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                  onClick={() => setDeleteTarget(sheetItem)}
                >
                  <Trash2 className="size-4" aria-hidden="true" /> Delete
                </Button>
              </div>
            </DetailSection>
          </>
        ) : null}
      </DetailSheet>

      {/* ============================ STOCK-IN FORMSHEET ========================== */}
      <FormSheet
        open={!!stockTarget}
        onOpenChange={(o) => {
          if (!o && !addingStock) setStockTarget(null);
        }}
        title={`Stock in — ${stockTarget?.name ?? ""}`}
        description={`Currently ${stockTarget?.quantity ?? 0} ${stockTarget?.unit ?? ""} in stock. The quantity is added immediately.`}
        onSubmit={addStock}
        submitLabel="Add stock"
        loading={addingStock}
        dirty={stockDirty}
        size="sm"
        badge={
          stockTarget && isLowStock(stockTarget) ? (
            <StatusBadge tone="warning">
              <AlertTriangle className="size-3" aria-hidden="true" /> Low stock
            </StatusBadge>
          ) : undefined
        }
      >
        <FormSection title="Stock in" description="Supplier and invoice are noted in the activity log.">
          <FieldGrid>
            <TextField
              label="Quantity to add"
              required
              type="number"
              min="1"
              value={stockForm.quantity}
              onChange={(v) => setStockForm({ ...stockForm, quantity: v })}
              placeholder="50"
              hint={
                stockTarget && isLowStock(stockTarget)
                  ? `Prefilled to restore healthy level (${restockQty(stockTarget)} ${stockTarget.unit}).`
                  : undefined
              }
            />
            <TextField
              label="Price per unit (₹)"
              prefix="₹"
              type="number"
              min="0"
              value={stockForm.pricePerUnit}
              onChange={(v) => setStockForm({ ...stockForm, pricePerUnit: v })}
              placeholder="Leave blank to keep current"
            />
          </FieldGrid>
          <FieldGrid>
            <TextField
              label="Supplier"
              value={stockForm.supplier}
              onChange={(v) => setStockForm({ ...stockForm, supplier: v })}
              placeholder="Sri Traders"
            />
            <TextField
              label="Invoice number"
              value={stockForm.invoiceNumber}
              onChange={(v) => setStockForm({ ...stockForm, invoiceNumber: v })}
              placeholder="INV-2026-0042"
            />
          </FieldGrid>
        </FormSection>
      </FormSheet>

      {/* ============================ ITEM FORMSHEET ============================= */}
      <FormSheet
        open={formOpen}
        onOpenChange={(o) => {
          if (!o && !saving) setFormOpen(false);
        }}
        title={editing ? `Edit ${editing.name}` : "New inventory item"}
        description="Categories and units come from the Masters (MDM) registry."
        onSubmit={save}
        submitLabel={editing ? "Save changes" : "Add item"}
        loading={saving}
        dirty={formDirty}
        size="lg"
      >
        <FormSection title="Item" description="Identity and storage details.">
          <FieldGrid>
            <TextField
              label="Name"
              required
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              error={errors.name}
              placeholder="Rice (5 kg bags)"
            />
            <SelectField
              label="Category"
              value={form.category}
              onChange={(v) => {
                setForm({ ...form, category: v, expiryDate: isPerishable(v) ? form.expiryDate : "" });
              }}
              options={mergedCategories}
            />
            <SelectField
              label="Unit"
              value={form.unit}
              onChange={(v) => setForm({ ...form, unit: v })}
              options={mergedUnits}
            />
            <TextField
              label="Location"
              value={form.location}
              onChange={(v) => setForm({ ...form, location: v })}
              placeholder="Main godown — Rack B2"
            />
          </FieldGrid>
          <TextareaField
            label="Description"
            rows={2}
            value={form.description}
            onChange={(v) => setForm({ ...form, description: v })}
          />
        </FormSection>

        <FormSection title="Stock" description="Quantity, reorder level and pricing.">
          <FieldGrid>
            <TextField
              label="Quantity"
              required
              type="number"
              min="0"
              value={form.quantity}
              onChange={(v) => setForm({ ...form, quantity: v })}
              error={errors.quantity}
            />
            <TextField
              label="Minimum stock"
              required
              type="number"
              min="0"
              value={form.minStock}
              onChange={(v) => setForm({ ...form, minStock: v })}
              error={errors.minStock}
              hint="Low-stock alert fires when quantity ≤ this."
            />
            <TextField
              label="Price per unit (₹)"
              prefix="₹"
              type="number"
              min="0"
              value={form.pricePerUnit}
              onChange={(v) => setForm({ ...form, pricePerUnit: v })}
              error={errors.pricePerUnit}
              placeholder="Optional"
            />
          </FieldGrid>
        </FormSection>

        {isPerishable(form.category) ? (
          <FormSection
            title="Expiry"
            description="Perishable categories (food, pads, medicine, feed) are monitored for expiry."
          >
            <TextField
              label="Expiry date"
              type="date"
              value={form.expiryDate}
              onChange={(v) => setForm({ ...form, expiryDate: v })}
              error={errors.expiryDate}
              hint="Expiring items are flagged within 30 days."
            />
          </FormSection>
        ) : (
          <p className="text-xs text-muted-foreground">
            No expiry tracking for “{labelOf(mergedCategories, form.category)}” — expiry applies to
            perishable categories only.
          </p>
        )}
      </FormSheet>

      {/* ============================ DELETE CONFIRM ============================ */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete item?"
        recordName={deleteTarget ? `${deleteTarget.name} · ${deleteTarget.quantity} ${deleteTarget.unit}` : null}
        description="The item and its purchase history are removed permanently."
        confirmLabel="Delete item"
        onConfirm={remove}
      />
    </div>
  );
}
