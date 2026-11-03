"use client";

/**
 * Inventory — admin module.
 * Stock items with categories/units from the MDM registry, low-stock and
 * expiry monitoring, table/grid/list views, CSV export and a stock-in flow.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
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
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { CsvColumn, ExportMenu } from "@/components/shared/csv";
import {
  DataViewMode,
  PaginationBar,
  PageSizeSelect,
  useViewPref,
  ViewSwitcher,
} from "@/components/shared/view-switcher";
import { Badge } from "@/components/ui/badge";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

/** Healthy-level progress: 100% means stock is at 2× the minimum. */
function stockPct(i: InventoryItem): number {
  const healthy = Math.max(i.minStock * 2, 1);
  return Math.min(100, Math.round((i.quantity / healthy) * 100));
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
  const [formTouched, setFormTouched] = useState(false);
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
  const paged = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  const stats = useMemo(
    () => ({
      total: items.length,
      low: items.filter(isLowStock).length,
      value: items.reduce((s, i) => s + (i.pricePerUnit ?? 0) * i.quantity, 0),
      expiring: items.filter(isExpiring).length,
    }),
    [items]
  );

  /* ------------------------------ form actions ----------------------------- */

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...EMPTY_ITEM_FORM,
      category: mergedCategories[0]?.value ?? "OTHER",
      unit: mergedUnits[0]?.value ?? "pcs",
    });
    setFormTouched(false);
    setFormOpen(true);
  };

  const openEdit = (i: InventoryItem) => {
    setEditing(i);
    setForm({
      name: i.name ?? "",
      description: i.description ?? "",
      category: i.category ?? "OTHER",
      unit: i.unit ?? "pcs",
      quantity: String(i.quantity ?? 0),
      minStock: String(i.minStock ?? 0),
      pricePerUnit: i.pricePerUnit != null ? String(i.pricePerUnit) : "",
      location: i.location ?? "",
      expiryDate: i.expiryDate ? i.expiryDate.slice(0, 10) : "",
    });
    setFormTouched(false);
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Item name is required");
      return;
    }
    const qty = Number(form.quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error("Quantity must be 0 or more");
      return;
    }
    const min = Number(form.minStock);
    if (!Number.isFinite(min) || min < 0) {
      toast.error("Minimum stock must be 0 or more");
      return;
    }
    if (form.pricePerUnit) {
      const price = Number(form.pricePerUnit);
      if (!Number.isFinite(price) || price < 0) {
        toast.error("Price per unit must be 0 or more");
        return;
      }
    }
    const dateErr = dateRule(true)(form.expiryDate);
    if (dateErr) {
      toast.error(dateErr);
      return;
    }
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
        expiryDate: form.expiryDate || undefined,
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

  const openStockIn = (i: InventoryItem) => {
    setStockTarget(i);
    setStockForm(EMPTY_STOCK_FORM);
  };

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

  const stockCell = (i: InventoryItem) => (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        isLowStock(i) && "text-amber-700 dark:text-amber-400"
      )}
    >
      {isLowStock(i) && <AlertTriangle className="size-3.5" aria-hidden="true" />}
      {i.quantity} {i.unit}
    </span>
  );

  const expiryChip = (i: InventoryItem) =>
    i.expiryDate ? (
      <Badge
        variant="outline"
        className={cn(
          isExpiring(i)
            ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
            : "text-muted-foreground"
        )}
      >
        <CalendarClock className="size-3" aria-hidden="true" />
        {isExpiring(i) ? "Expires " : "Exp. "}
        {formatDate(i.expiryDate)}
      </Badge>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );

  const rowActions = (i: InventoryItem) => (
    <>
      <Button variant="outline" size="sm" onClick={() => openStockIn(i)} aria-label={`Stock in ${i.name}`}>
        <PackagePlus className="size-3.5" aria-hidden="true" />
      </Button>
      <Button variant="outline" size="sm" onClick={() => openEdit(i)} aria-label={`Edit ${i.name}`}>
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
        onClick={() => setDeleteTarget(i)}
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

      {/* list */}
      <SectionCard
        title="Stock items"
        description={`${filtered.length} of ${items.length} item${items.length === 1 ? "" : "s"} shown`}
        actions={
          <>
            <ExportMenu columns={csvColumns} rows={filtered} filename="uar-inventory" disabled={filtered.length === 0} />
            <ViewSwitcher value={view} onChange={setView} />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 pb-4">
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
            onClick={() => {
              setLowOnly((v) => !v);
              setPage(1);
            }}
            aria-pressed={lowOnly}
          >
            <AlertTriangle className="size-4" aria-hidden="true" /> Low stock
          </Button>
          <Button size="sm" className="sm:ml-auto" onClick={openCreate}>
            <Plus className="size-4" aria-hidden="true" /> Add item
          </Button>
        </div>

        {loading ? (
          view === "grid" ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          )
        ) : filtered.length === 0 ? (
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
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setCatFilter("ALL");
                  setLowOnly(false);
                  setPage(1);
                }}
              >
                Reset filters
              </Button>
            </EmptyState>
          )
        ) : view === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((i) => {
              const pct = stockPct(i);
              return (
                <div
                  key={i.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm",
                    isLowStock(i) && "border-amber-500/40 bg-amber-500/5"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => openSheet(i)}
                      aria-label={`Open ${i.name}`}
                    >
                      <p className="truncate font-semibold leading-tight">{i.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {labelOf(mergedCategories, i.category)} · {i.location || "No location"}
                      </p>
                    </button>
                    {isLowStock(i) && (
                      <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className={cn("font-medium", isLowStock(i) && "text-amber-700 dark:text-amber-400")}>
                        {i.quantity} {i.unit} in stock
                      </span>
                      <span className="text-muted-foreground">min {i.minStock}</span>
                    </div>
                    <Progress
                      value={pct}
                      className={cn("h-2", isLowStock(i) ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-600")}
                      aria-label={`Stock at ${pct}% of healthy level`}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{i.pricePerUnit != null ? formatINR(i.pricePerUnit) : "No price"}</Badge>
                    {expiryChip(i)}
                  </div>
                  <div className="mt-auto flex gap-1.5 border-t pt-3">{rowActions(i)}</div>
                </div>
              );
            })}
          </div>
        ) : view === "list" ? (
          <div className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin" role="list" aria-label="Inventory items">
            {filtered.map((i) => (
              <div
                key={i.id}
                className={cn("flex items-center gap-3 rounded-lg border p-3", isLowStock(i) && "border-amber-500/40 bg-amber-500/5")}
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
                <span className="hidden text-xs text-muted-foreground sm:block">min {i.minStock}</span>
                {stockCell(i)}
                {rowActions(i)}
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Min</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((i) => (
                    <TableRow key={i.id} className={cn(isLowStock(i) && "bg-amber-500/5")}>
                      <TableCell>
                        <button
                          type="button"
                          className="text-left font-medium hover:text-primary"
                          onClick={() => openSheet(i)}
                          aria-label={`Open ${i.name}`}
                        >
                          {i.name}
                        </button>
                        {isLowStock(i) ? (
                          <span className="block text-xs text-amber-700 dark:text-amber-400">Low stock — reorder</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{labelOf(mergedCategories, i.category)}</TableCell>
                      <TableCell className="text-right">{stockCell(i)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{i.minStock}</TableCell>
                      <TableCell className="text-right">{i.pricePerUnit != null ? formatINR(i.pricePerUnit) : "—"}</TableCell>
                      <TableCell className="max-w-36 truncate">{i.location || "—"}</TableCell>
                      <TableCell>{expiryChip(i)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">{rowActions(i)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
              <PaginationBar
                page={pageSafe}
                pages={pages}
                total={filtered.length}
                onPage={setPage}
                itemLabel="items"
              />
              <PageSizeSelect
                value={pageSize}
                onChange={(n) => {
                  setPageSize(n);
                  setPage(1);
                }}
              />
            </div>
          </>
        )}
      </SectionCard>

      {/* ============================== DETAIL SHEET ============================= */}
      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
          {sheet && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle>{sheet.name}</SheetTitle>
                <SheetDescription>{labelOf(mergedCategories, sheet.category)}</SheetDescription>
              </SheetHeader>

              {isLowStock(sheet) && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  At or below minimum stock ({sheet.minStock} {sheet.unit}) — reorder soon.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <DataField label="In stock" value={`${sheet.quantity} ${sheet.unit}`} />
                <DataField label="Minimum stock" value={`${sheet.minStock} ${sheet.unit}`} />
                <DataField label="Price per unit" value={sheet.pricePerUnit != null ? formatINR(sheet.pricePerUnit) : "—"} />
                <DataField label="Stock value" value={formatINR((sheet.pricePerUnit ?? 0) * sheet.quantity)} />
                <DataField label="Location" value={sheet.location || "—"} />
                <DataField label="Expiry" value={sheet.expiryDate ? formatDate(sheet.expiryDate) : "No expiry"} />
              </div>

              {sheet.description ? (
                <SectionCard title="Description">
                  <p className="text-sm leading-relaxed text-muted-foreground">{sheet.description}</p>
                </SectionCard>
              ) : null}

              <SectionCard title="Purchase history" description="Stock-ins recorded against this item.">
                {purchases === null ? (
                  <div className="space-y-2" aria-busy="true">
                    <Skeleton className="h-9 rounded-lg" />
                    <Skeleton className="h-9 rounded-lg" />
                  </div>
                ) : purchases.length === 0 ? (
                  <div>
                    <DataField label="Purchases" value="—" />
                    <p className="mt-2 text-xs text-muted-foreground">
                      The inventory API doesn&apos;t return purchase records yet — stock-ins are applied as direct
                      quantity updates and supplier/invoice notes land in the activity log.
                    </p>
                  </div>
                ) : (
                  <ul className="max-h-56 space-y-1.5 overflow-y-auto text-sm scrollbar-thin">
                    {purchases.map((p) => (
                      <li key={p.id} className="rounded-md bg-muted/50 px-2.5 py-1.5">
                        <span className="font-medium">+{p.quantity}</span>
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
              </SectionCard>

              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button size="sm" onClick={() => openStockIn(sheet)}>
                  <PackagePlus className="size-3.5" aria-hidden="true" /> Stock in
                </Button>
                <Button variant="outline" size="sm" onClick={() => openEdit(sheet)}>
                  <Pencil className="size-3.5" aria-hidden="true" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  onClick={() => setDeleteTarget(sheet)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============================ STOCK-IN FORMSHEET ========================== */}
      <FormSheet
        open={!!stockTarget}
        onOpenChange={(o) => !o && setStockTarget(null)}
        title={`Stock in — ${stockTarget?.name ?? ""}`}
        description={`Currently ${stockTarget?.quantity ?? 0} ${stockTarget?.unit ?? ""} in stock. The quantity is added immediately.`}
        onSubmit={addStock}
        submitLabel="Add stock"
        loading={addingStock}
        dirty={stockForm.quantity.trim() !== "" || stockForm.supplier.trim() !== "" || stockForm.invoiceNumber.trim() !== ""}
        size="sm"
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
        onOpenChange={setFormOpen}
        title={editing ? `Edit ${editing.name}` : "New inventory item"}
        description="Categories and units come from the Masters (MDM) registry."
        onSubmit={save}
        submitLabel={editing ? "Save changes" : "Add item"}
        loading={saving}
        dirty={formTouched}
        size="md"
      >
        <FormSection title="Item" description="Identity and storage details.">
          <TextField
            label="Name"
            required
            value={form.name}
            onChange={(v) => {
              setForm({ ...form, name: v });
              setFormTouched(true);
            }}
            placeholder="Rice (5 kg bags)"
          />
          <FieldGrid>
            <SelectField
              label="Category"
              value={form.category}
              onChange={(v) => {
                setForm({ ...form, category: v });
                setFormTouched(true);
              }}
              options={mergedCategories}
            />
            <SelectField
              label="Unit"
              value={form.unit}
              onChange={(v) => {
                setForm({ ...form, unit: v });
                setFormTouched(true);
              }}
              options={mergedUnits}
            />
          </FieldGrid>
          <TextField
            label="Location"
            value={form.location}
            onChange={(v) => {
              setForm({ ...form, location: v });
              setFormTouched(true);
            }}
            placeholder="Main godown — Rack B2"
          />
          <TextareaField
            label="Description"
            rows={2}
            value={form.description}
            onChange={(v) => {
              setForm({ ...form, description: v });
              setFormTouched(true);
            }}
          />
        </FormSection>

        <FormSection title="Stock" description="Quantity, reorder level, pricing and expiry.">
          <FieldGrid>
            <TextField
              label="Quantity"
              required
              type="number"
              min="0"
              value={form.quantity}
              onChange={(v) => {
                setForm({ ...form, quantity: v });
                setFormTouched(true);
              }}
            />
            <TextField
              label="Minimum stock"
              required
              type="number"
              min="0"
              value={form.minStock}
              onChange={(v) => {
                setForm({ ...form, minStock: v });
                setFormTouched(true);
              }}
              hint="Low-stock alert fires when quantity ≤ this."
            />
          </FieldGrid>
          <FieldGrid>
            <TextField
              label="Price per unit (₹)"
              prefix="₹"
              type="number"
              min="0"
              value={form.pricePerUnit}
              onChange={(v) => {
                setForm({ ...form, pricePerUnit: v });
                setFormTouched(true);
              }}
              placeholder="Optional"
            />
            <TextField
              label="Expiry date"
              type="date"
              value={form.expiryDate}
              onChange={(v) => {
                setForm({ ...form, expiryDate: v });
                setFormTouched(true);
              }}
              hint="Expiring items are flagged within 30 days."
            />
          </FieldGrid>
        </FormSection>
      </FormSheet>

      {/* ============================ DELETE CONFIRM ============================ */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete item?"
        recordName={deleteTarget ? `${deleteTarget.name} · ${deleteTarget.quantity} ${deleteTarget.unit}` : null}
        description="The item and its purchase history are removed permanently."
        confirmLabel="Delete item"
        loading={false}
        onConfirm={remove}
      />
    </div>
  );
}
