"use client";

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
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { formatDate, formatINR, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  category: "FOOD_KIT",
  unit: "pack",
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

/* ---------------------------------- view ----------------------------------- */

export default function InventoryView() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [sheet, setSheet] = useState<InventoryItem | null>(null);
  const [itemDialog, setItemDialog] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_ITEM_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);

  const [stockTarget, setStockTarget] = useState<InventoryItem | null>(null);
  const [stockForm, setStockForm] = useState<StockForm>(EMPTY_STOCK_FORM);
  const [addingStock, setAddingStock] = useState(false);

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

  const stats = useMemo(
    () => ({
      total: items.length,
      low: items.filter(isLowStock).length,
      value: items.reduce((s, i) => s + (i.pricePerUnit ?? 0) * i.quantity, 0),
    }),
    [items]
  );

  /* ------------------------------ form actions ----------------------------- */

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_ITEM_FORM, unit: unitOptions.options[0]?.value ?? "pack" });
    setItemDialog(true);
  };

  const openEdit = (i: InventoryItem) => {
    setEditing(i);
    setForm({
      name: i.name ?? "",
      description: i.description ?? "",
      category: i.category ?? "OTHER",
      unit: i.unit ?? "pack",
      quantity: String(i.quantity ?? 0),
      minStock: String(i.minStock ?? 0),
      pricePerUnit: i.pricePerUnit != null ? String(i.pricePerUnit) : "",
      location: i.location ?? "",
      expiryDate: i.expiryDate ? i.expiryDate.slice(0, 10) : "",
    });
    setItemDialog(true);
  };

  const validate = (): string | null => {
    if (!form.name.trim()) return "Item name is required";
    const qty = Number(form.quantity);
    if (!Number.isFinite(qty) || qty < 0) return "Quantity must be 0 or more";
    const min = Number(form.minStock);
    if (!Number.isFinite(min) || min < 0) return "Minimum stock must be 0 or more";
    if (form.pricePerUnit) {
      const price = Number(form.pricePerUnit);
      if (!Number.isFinite(price) || price < 0) return "Price per unit must be 0 or more";
    }
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        category: form.category,
        unit: form.unit,
        quantity: Math.trunc(Number(form.quantity)),
        minStock: Math.trunc(Number(form.minStock)),
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
      setItemDialog(false);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addStock = async () => {
    if (!stockTarget) return;
    const qty = Math.trunc(Number(stockForm.quantity));
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Quantity to add must be at least 1");
      return;
    }
    setAddingStock(true);
    try {
      const body: Record<string, unknown> = { addQuantity: qty };
      if (stockForm.pricePerUnit !== "") body.pricePerUnit = Number(stockForm.pricePerUnit);
      await patch(`/api/inventory/${stockTarget.id}`, body);
      toast.success(
        `+${qty} ${stockTarget.unit} added to ${stockTarget.name}${
          stockForm.supplier ? ` (supplier: ${stockForm.supplier.trim()})` : ""
        }`
      );
      setStockTarget(null);
      setStockForm(EMPTY_STOCK_FORM);
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

  const stockCell = (i: InventoryItem) => (
    <span className={cn("inline-flex items-center gap-1 font-medium", isLowStock(i) && "text-amber-700 dark:text-amber-400")}>
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
      <Button variant="outline" size="sm" onClick={() => setStockTarget(i)} aria-label={`Add stock to ${i.name}`}>
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

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Stock of ration supplies, sanitary pads, medicine and equipment."
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
        <StatCard
          label="Low stock"
          value={stats.low}
          accent="amber"
          icon={<AlertTriangle className="size-5" aria-hidden="true" />}
          loading={loading}
          hint="At or below minimum"
        />
        <StatCard label="Stock value" value={formatINR(stats.value)} accent="teal" icon={<Package className="size-5" aria-hidden="true" />} loading={loading} hint="Qty × unit price" />
        <StatCard
          label="Expiring ≤30 days"
          value={items.filter(isExpiring).length}
          accent="red"
          icon={<CalendarClock className="size-5" aria-hidden="true" />}
          loading={loading}
        />
      </div>

      {/* table */}
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
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
        <>
          {/* mobile cards */}
          <ul className="space-y-2 sm:hidden">
            {items.map((i) => (
              <li
                key={i.id}
                className={cn("rounded-lg border p-3", isLowStock(i) && "border-amber-500/40 bg-amber-500/5")}
              >
                <button type="button" className="w-full text-left" onClick={() => setSheet(i)} aria-label={`Open ${i.name}`}>
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{i.name}</span>
                    {isLowStock(i) && <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {labelOf(categoryOptions.options, i.category)} · {i.location || "—"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {stockCell(i)}
                    <span className="text-xs text-muted-foreground">min {i.minStock}</span>
                    {expiryChip(i)}
                  </div>
                </button>
                <div className="mt-2 flex gap-1.5">{rowActions(i)}</div>
              </li>
            ))}
          </ul>
          {/* desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border sm:block">
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
                {items.map((i) => (
                  <TableRow key={i.id} className={cn(isLowStock(i) && "bg-amber-500/5")}>
                    <TableCell>
                      <button type="button" className="text-left font-medium hover:text-primary" onClick={() => setSheet(i)} aria-label={`Open ${i.name}`}>
                        {i.name}
                      </button>
                      {isLowStock(i) ? (
                        <span className="block text-xs text-amber-700 dark:text-amber-400">Low stock — reorder</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{labelOf(categoryOptions.options, i.category)}</TableCell>
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
        </>
      )}

      {/* ============================== DETAIL SHEET ============================= */}
      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
          {sheet && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle>{sheet.name}</SheetTitle>
                <SheetDescription>{labelOf(categoryOptions.options, sheet.category)}</SheetDescription>
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

              <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                Purchase history is not exposed by the inventory API yet — stock movements are
                applied directly with “Add stock”.
              </div>

              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button size="sm" onClick={() => setStockTarget(sheet)}>
                  <PackagePlus className="size-3.5" aria-hidden="true" /> Add stock
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

      {/* ============================== ADD STOCK =============================== */}
      <Dialog open={!!stockTarget} onOpenChange={(o) => !o && setStockTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add stock — {stockTarget?.name}</DialogTitle>
            <DialogDescription>
              Currently {stockTarget?.quantity} {stockTarget?.unit} in stock. The quantity is added
              immediately; supplier and invoice are noted in the activity log.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="stock-qty">Quantity to add *</Label>
              <Input
                id="stock-qty"
                type="number"
                min={1}
                value={stockForm.quantity}
                onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })}
                placeholder="50"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="stock-price">Price per unit (₹)</Label>
              <Input
                id="stock-price"
                type="number"
                min={0}
                value={stockForm.pricePerUnit}
                onChange={(e) => setStockForm({ ...stockForm, pricePerUnit: e.target.value })}
                placeholder="Leave blank to keep current"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="stock-supplier">Supplier</Label>
                <Input
                  id="stock-supplier"
                  value={stockForm.supplier}
                  onChange={(e) => setStockForm({ ...stockForm, supplier: e.target.value })}
                  placeholder="Sri Traders"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="stock-invoice">Invoice number</Label>
                <Input
                  id="stock-invoice"
                  value={stockForm.invoiceNumber}
                  onChange={(e) => setStockForm({ ...stockForm, invoiceNumber: e.target.value })}
                  placeholder="INV-2026-0042"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Note: the inventory API currently applies stock as a direct quantity increment; a
              purchase-log endpoint can be attached later without UI changes.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockTarget(null)}>
              Cancel
            </Button>
            <Button onClick={addStock} disabled={addingStock}>
              {addingStock ? "Adding…" : "Add stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================ CREATE / EDIT ============================= */}
      <Dialog open={itemDialog} onOpenChange={setItemDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "New inventory item"}</DialogTitle>
            <DialogDescription>Categories and units come from the Masters (MDM) registry.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="inv-name">Name *</Label>
              <Input
                id="inv-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Rice (5 kg bags)"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger aria-label="Category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Unit</Label>
                <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                  <SelectTrigger aria-label="Unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="inv-qty">Quantity</Label>
                <Input
                  id="inv-qty"
                  type="number"
                  min={0}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="inv-min">Minimum stock</Label>
                <Input
                  id="inv-min"
                  type="number"
                  min={0}
                  value={form.minStock}
                  onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="inv-price">Price per unit (₹)</Label>
                <Input
                  id="inv-price"
                  type="number"
                  min={0}
                  value={form.pricePerUnit}
                  onChange={(e) => setForm({ ...form, pricePerUnit: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="inv-expiry">Expiry date</Label>
                <Input
                  id="inv-expiry"
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                  aria-label="Expiry date"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="inv-location">Location</Label>
              <Input
                id="inv-location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Main godown — Rack B2"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="inv-desc">Description</Label>
              <Textarea
                id="inv-desc"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialog(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================ DELETE CONFIRM ============================ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The item and its purchase history are removed permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep item</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                remove();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
