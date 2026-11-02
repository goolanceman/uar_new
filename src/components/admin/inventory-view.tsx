"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes, Minus, Pencil, Plus, RefreshCw, Search, Trash2, TriangleAlert, X,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { useMasters } from "@/hooks/use-masters";
import { cn, formatINR, formatNumber, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  minStock: number;
  pricePerUnit?: number | null;
  location?: string | null;
}

interface ItemForm {
  name: string;
  category: string;
  unit: string;
  quantity: string;
  minStock: string;
  pricePerUnit: string;
  location: string;
}

const CATEGORY_CLS: Record<string, string> = {
  FOOD_KIT: "border-emerald-200 bg-emerald-50 text-emerald-800",
  RATION: "border-emerald-200 bg-emerald-50 text-emerald-800",
  SANITARY_PADS: "border-pink-200 bg-pink-50 text-pink-800",
  HYGIENE: "border-pink-200 bg-pink-50 text-pink-800",
  MEDICINE: "border-teal-200 bg-teal-50 text-teal-800",
  ANIMAL_FEED: "border-lime-200 bg-lime-50 text-lime-800",
  EQUIPMENT: "border-amber-200 bg-amber-50 text-amber-800",
  CLOTHING: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800",
  OTHER: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

const EMPTY_FORM: ItemForm = {
  name: "",
  category: "FOOD_KIT",
  unit: "pcs",
  quantity: "0",
  minStock: "10",
  pricePerUnit: "",
  location: "",
};

export default function InventoryView() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [category, setCategory] = useState("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);

  const categoryOptions = useMasters("INVENTORY_CATEGORY");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (appliedQ.trim()) params.set("q", appliedQ.trim());
      if (category !== "all") params.set("category", category);
      const data = await get<InventoryItem[]>(`/api/inventory?${params.toString()}`);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, [appliedQ, category]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, category: category !== "all" ? category : "FOOD_KIT" });
    setDialogOpen(true);
  };

  const openEdit = (it: InventoryItem) => {
    setEditing(it);
    setForm({
      name: it.name ?? "",
      category: it.category ?? "OTHER",
      unit: it.unit ?? "pcs",
      quantity: String(it.quantity ?? 0),
      minStock: String(it.minStock ?? 10),
      pricePerUnit: it.pricePerUnit != null ? String(it.pricePerUnit) : "",
      location: it.location ?? "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Item name is required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        category: form.category,
        unit: form.unit.trim() || "pcs",
        quantity: Number(form.quantity) || 0,
        minStock: Number(form.minStock) || 0,
        pricePerUnit: form.pricePerUnit ? Number(form.pricePerUnit) : null,
        location: form.location.trim(),
      };
      if (editing) {
        await patch(`/api/inventory/${editing.id}`, body);
        toast.success(`${body.name} updated`);
      } else {
        await post("/api/inventory", body);
        toast.success(`${body.name} added to inventory`);
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const adjustStock = async (it: InventoryItem, delta: number) => {
    if (delta < 0 && (it.quantity || 0) <= 0) {
      toast.error(`${it.name} is already out of stock`);
      return;
    }
    try {
      await patch(`/api/inventory/${it.id}`, { addQuantity: delta });
      toast.success(`${it.name}: ${delta > 0 ? "+" : ""}${delta} ${it.unit}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stock update failed");
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await del(`/api/inventory/${deleteTarget.id}`);
      toast.success(`${deleteTarget.name} removed`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const lowItems = useMemo(
    () => items.filter((it) => (it.quantity || 0) <= (it.minStock || 0)),
    [items]
  );

  return (
    <div className="space-y-4">
      {/* search + filters */}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedQ(q);
        }}
      >
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search items…"
            className="pl-8"
            aria-label="Search inventory"
          />
        </div>
        <Button type="submit" variant="outline" aria-label="Run search">
          Search
        </Button>
        {appliedQ ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear search"
            onClick={() => {
              setQ("");
              setAppliedQ("");
            }}
          >
            <X className="size-4" />
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="icon" onClick={load} aria-label="Refresh inventory">
            <RefreshCw className="size-4" />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Add item
          </Button>
        </div>
      </form>

      {/* category chips */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
        <Button
          type="button"
          size="sm"
          variant={category === "all" ? "default" : "outline"}
          className="h-8 rounded-full"
          onClick={() => setCategory("all")}
        >
          All
        </Button>
        {categoryOptions.options.map((o) => (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant={category === o.value ? "default" : "outline"}
            className="h-8 rounded-full"
            onClick={() => setCategory(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>

      {/* low-stock banner */}
      {!loading && lowItems.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="status"
        >
          <TriangleAlert className="size-4 shrink-0" />
          <span className="font-semibold">
            {lowItems.length} item{lowItems.length === 1 ? "" : "s"} at or below minimum stock:
          </span>
          <span className="min-w-0 truncate text-xs">
            {lowItems.map((it) => `${it.name} (${it.quantity} ${it.unit})`).join(" · ")}
          </span>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <Boxes className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No inventory items found</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {appliedQ || category !== "all"
              ? "Try a different search or category filter."
              : "Add your first stock item to start tracking."}
          </p>
        </div>
      ) : (
        <>
          {/* desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Min stock</TableHead>
                  <TableHead className="w-40">Level</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Quick stock</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => {
                  const low = (it.quantity || 0) <= (it.minStock || 0);
                  const pct = Math.min(
                    100,
                    Math.round(((it.quantity || 0) / Math.max((it.minStock || 0) * 4, it.quantity || 1)) * 100)
                  );
                  return (
                    <TableRow key={it.id}>
                      <TableCell>
                        <span className="block font-medium">{it.name}</span>
                        {it.pricePerUnit != null ? (
                          <span className="text-xs text-muted-foreground">
                            {formatINR(it.pricePerUnit)} / {it.unit}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("whitespace-nowrap", CATEGORY_CLS[it.category] ?? CATEGORY_CLS.OTHER)}>
                          {titleCase(it.category)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">
                        {formatNumber(it.quantity)} {it.unit}
                        {low ? (
                          <Badge variant="outline" className="ml-1.5 border-red-200 bg-red-50 text-red-800">
                            LOW
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(it.minStock)}</TableCell>
                      <TableCell>
                        <Progress
                          value={pct}
                          className={cn("h-2", low ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-600")}
                          aria-label={`${it.name} stock level ${pct}%`}
                        />
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">{pct}%</span>
                      </TableCell>
                      <TableCell>{it.location ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2"
                            onClick={() => adjustStock(it, 10)}
                            aria-label={`Add 10 ${it.unit} to ${it.name}`}
                          >
                            +10
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2"
                            onClick={() => adjustStock(it, 50)}
                            aria-label={`Add 50 ${it.unit} to ${it.name}`}
                          >
                            +50
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2"
                            onClick={() => adjustStock(it, -1)}
                            disabled={(it.quantity || 0) <= 0}
                            aria-label={`Remove 1 ${it.unit} from ${it.name}`}
                          >
                            <Minus className="size-3" />1
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(it)}
                            aria-label={`Edit ${it.name}`}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => setDeleteTarget(it)}
                            aria-label={`Delete ${it.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* mobile cards */}
          <div className="grid gap-3 md:hidden">
            {items.map((it) => {
              const low = (it.quantity || 0) <= (it.minStock || 0);
              const pct = Math.min(
                100,
                Math.round(((it.quantity || 0) / Math.max((it.minStock || 0) * 4, it.quantity || 1)) * 100)
              );
              return (
                <Card key={it.id}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="min-w-0 flex-1 truncate font-semibold">{it.name}</p>
                      <Badge
                        variant="outline"
                        className={cn("whitespace-nowrap", CATEGORY_CLS[it.category] ?? CATEGORY_CLS.OTHER)}
                      >
                        {titleCase(it.category)}
                      </Badge>
                      {low ? (
                        <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">
                          LOW
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold">
                        {formatNumber(it.quantity)} {it.unit}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        min {formatNumber(it.minStock)} · {it.location ?? "no location"}
                      </span>
                    </div>
                    <Progress
                      value={pct}
                      className={cn("h-2", low ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-600")}
                      aria-label={`${it.name} stock level ${pct}%`}
                    />
                    <div className="flex flex-wrap gap-1.5 border-t pt-2">
                      <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => adjustStock(it, 10)} aria-label={`Add 10 ${it.unit} to ${it.name}`}>
                        +10
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => adjustStock(it, 50)} aria-label={`Add 50 ${it.unit} to ${it.name}`}>
                        +50
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2"
                        onClick={() => adjustStock(it, -1)}
                        disabled={(it.quantity || 0) <= 0}
                        aria-label={`Remove 1 ${it.unit} from ${it.name}`}
                      >
                        <Minus className="size-3" />1
                      </Button>
                      <Button size="sm" variant="outline" className="ml-auto" onClick={() => openEdit(it)} aria-label={`Edit ${it.name}`}>
                        <Pencil className="size-3.5" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setDeleteTarget(it)}
                        aria-label={`Delete ${it.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* ============ CREATE / EDIT DIALOG ============ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Boxes className="size-4" />
              {editing ? `Edit ${editing.name}` : "Add inventory item"}
            </DialogTitle>
            <DialogDescription>Stock tracked for kits, pads, medicine and animal feed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="i-name">Item name *</Label>
              <Input
                id="i-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Rice (per kg packs)"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger aria-label="Category">
                    <SelectValue placeholder="Select category" />
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
                <Label htmlFor="i-unit">Unit</Label>
                <Input
                  id="i-unit"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  placeholder="kg / pcs / litre / box"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="i-qty">Quantity</Label>
                <Input
                  id="i-qty"
                  type="number"
                  min={0}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="i-min">Min stock</Label>
                <Input
                  id="i-min"
                  type="number"
                  min={0}
                  value={form.minStock}
                  onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="i-price">Price per unit (₹)</Label>
                <Input
                  id="i-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.pricePerUnit}
                  onChange={(e) => setForm({ ...form, pricePerUnit: e.target.value })}
                  placeholder="42"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="i-location">Location</Label>
                <Input
                  id="i-location"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Main godown, rack B2"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ DELETE CONFIRM ============ */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the item and its stock history links.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Keep
            </Button>
            <Button variant="destructive" onClick={remove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
