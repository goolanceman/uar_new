"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  MapPin,
  PackagePlus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, patch } from "@/lib/api-client";
import { cn, formatNumber, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface InventoryItem {
  id: string;
  name: string;
  category: string; // FOOD_KIT | SANITARY_PADS | MEDICINE | ANIMAL_FEED | EQUIPMENT | CLOTHING | OTHER
  quantity: number;
  minStock: number;
  unit: string;
  location?: string | null;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

export default function VolunteerInventory(_props: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [addItemId, setAddItemId] = useState("");
  const [addQty, setAddQty] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<unknown>("/api/inventory");
      const list = asArray<InventoryItem>(data);
      list.sort((a, b) => a.name.localeCompare(b.name));
      setItems(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load inventory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const lowItems = useMemo(
    () => items.filter((i) => i.quantity <= i.minStock),
    [items]
  );

  const openAdd = () => {
    setAddItemId(lowItems[0]?.id ?? items[0]?.id ?? "");
    setAddQty("");
    setAddOpen(true);
  };

  const submitAdd = async () => {
    const qty = Number(addQty);
    if (!addItemId) {
      toast.error("Select an item");
      return;
    }
    if (!Number.isFinite(qty) || qty < 1) {
      toast.error("Enter a quantity of at least 1");
      return;
    }
    setAdding(true);
    try {
      await patch(`/api/inventory/${addItemId}`, { addQuantity: Math.round(qty) });
      toast.success("Stock added — inventory updated");
      setAddOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add stock");
    } finally {
      setAdding(false);
    }
  };

  const lowBadge = (i: InventoryItem) =>
    i.quantity <= i.minStock ? (
      <Badge
        variant="outline"
        className="gap-1 rounded-full border-amber-200 bg-amber-50 text-[10px] text-amber-700"
      >
        <AlertTriangle className="size-3" aria-hidden="true" />
        Low
      </Badge>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Inventory
          </h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${items.length} items · ${lowItems.length} low on stock`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 gap-1.5 sm:min-h-9"
            onClick={load}
            aria-label="Refresh inventory"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
          <Button
            size="sm"
            className="min-h-11 gap-1.5 sm:min-h-9"
            onClick={openAdd}
            disabled={items.length === 0}
          >
            <PackagePlus className="size-4" aria-hidden="true" />
            Add stock
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Boxes className="size-8 text-primary/60" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              No inventory items yet — the admin creates items from the admin console.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Min stock</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="w-16" aria-label="Status" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => {
                  const low = i.quantity <= i.minStock;
                  return (
                    <TableRow
                      key={i.id}
                      className={cn(low && "bg-amber-50/70")}
                    >
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {titleCase(i.category)}
                      </TableCell>
                      <TableCell className={cn("text-right font-semibold", low && "text-amber-700")}>
                        {formatNumber(i.quantity)} {i.unit}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatNumber(i.minStock)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" aria-hidden="true" />
                          {i.location ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell>{lowBadge(i)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="grid gap-3 md:hidden">
            {items.map((i) => {
              const low = i.quantity <= i.minStock;
              return (
                <Card
                  key={i.id}
                  className={cn("p-4", low && "border-amber-200 bg-amber-50/60")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{i.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {titleCase(i.category)} · min {formatNumber(i.minStock)}
                      </p>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" aria-hidden="true" />
                        {i.location ?? "—"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn("text-base font-bold", low && "text-amber-700")}>
                        {formatNumber(i.quantity)}
                      </p>
                      <p className="text-xs text-muted-foreground">{i.unit}</p>
                    </div>
                  </div>
                  {low && (
                    <div className="mt-2">{lowBadge(i)}</div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* ---------- Add stock dialog ---------- */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add stock</DialogTitle>
            <DialogDescription>
              Received a fresh purchase or donation? Top up the item here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="inv-item">Item</Label>
              <Select value={addItemId} onValueChange={setAddItemId}>
                <SelectTrigger id="inv-item" className="w-full">
                  <SelectValue placeholder="Select item" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name} ({formatNumber(i.quantity)} {i.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-qty">Quantity to add</Label>
              <Input
                id="inv-qty"
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="e.g. 50"
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </Button>
            <Button className="min-h-11" onClick={submitAdd} disabled={adding}>
              {adding ? "Adding…" : "Add stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
