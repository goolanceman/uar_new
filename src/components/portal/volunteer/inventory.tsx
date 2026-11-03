"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  MapPin,
  RefreshCw,
  ScrollText,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, patch } from "@/lib/api-client";
import { titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";

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

const formatNumber = (n: number) => n.toLocaleString("en-IN");

export default function VolunteerInventory({
  volunteer,
}: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  // Stock movement dialog
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveItemId, setMoveItemId] = useState("");
  const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [moveQty, setMoveQty] = useState("");
  const [moveNotes, setMoveNotes] = useState("");
  const [moving, setMoving] = useState(false);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        titleCase(i.category).toLowerCase().includes(q) ||
        (i.location ?? "").toLowerCase().includes(q)
    );
  }, [items, query]);

  const lowItems = useMemo(
    () => items.filter((i) => i.quantity <= i.minStock),
    [items]
  );

  const openMove = () => {
    setMoveItemId(lowItems[0]?.id ?? filtered[0]?.id ?? items[0]?.id ?? "");
    setDirection("IN");
    setMoveQty("");
    setMoveNotes("");
    setMoveOpen(true);
  };

  const submitMove = async () => {
    const qty = Number(moveQty);
    if (!moveItemId) {
      toast.error("Select an item");
      return;
    }
    if (!Number.isFinite(qty) || qty < 1) {
      toast.error("Enter a quantity of at least 1");
      return;
    }
    setMoving(true);
    try {
      await patch(`/api/inventory/${moveItemId}`, {
        addQuantity: direction === "IN" ? Math.round(qty) : -Math.round(qty),
      });
      toast.success(
        direction === "IN"
          ? `Stock in recorded (+${Math.round(qty)}) — the movement is audit-logged under your name.`
          : `Stock out recorded (−${Math.round(qty)}) — the movement is audit-logged under your name.`
      );
      setMoveOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record stock movement");
    } finally {
      setMoving(false);
    }
  };

  const LowBadge = () => (
    <Badge
      variant="outline"
      className="gap-1 rounded-full border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
    >
      <AlertTriangle className="size-3" aria-hidden="true" />
      Low
    </Badge>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description={
          loading
            ? "Loading stock rooms…"
            : `${items.length} items · ${lowItems.length} low on stock`
        }
        icon={<Boxes className="size-5" />}
        actions={
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
              onClick={openMove}
              disabled={items.length === 0}
            >
              <ArrowDownToLine className="size-4" aria-hidden="true" />
              Log stock in/out
            </Button>
          </div>
        }
      />

      {/* Search */}
      {!loading && items.length > 0 && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            placeholder="Search items, categories or locations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search inventory"
          />
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <SectionCard title="Stock" icon={<Boxes className="size-5" />}>
          <EmptyState
            icon={<Boxes className="size-5" />}
            title="No inventory items yet"
            hint="Items are created from the admin console — once stocked, they appear here."
          />
        </SectionCard>
      ) : filtered.length === 0 ? (
        <SectionCard title="Search" icon={<Search className="size-5" />}>
          <EmptyState
            icon={<Search className="size-5" />}
            title="Nothing matches your search"
            hint="Try a shorter term — item names, categories or storage locations."
          >
            <Button variant="outline" className="min-h-11" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </EmptyState>
        </SectionCard>
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
                {filtered.map((i) => {
                  const low = i.quantity <= i.minStock;
                  return (
                    <TableRow key={i.id} className={cn(low && "bg-amber-500/10")}>
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {titleCase(i.category)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-semibold",
                          low && "text-amber-700 dark:text-amber-400"
                        )}
                      >
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
                      <TableCell>{low ? <LowBadge /> : null}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="grid gap-3 md:hidden">
            {filtered.map((i) => {
              const low = i.quantity <= i.minStock;
              return (
                <div
                  key={i.id}
                  className={cn(
                    "rounded-xl border bg-card p-4",
                    low && "border-amber-500/40 bg-amber-500/10"
                  )}
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
                      <p
                        className={cn(
                          "text-base font-bold",
                          low && "text-amber-700 dark:text-amber-400"
                        )}
                      >
                        {formatNumber(i.quantity)}
                      </p>
                      <p className="text-xs text-muted-foreground">{i.unit}</p>
                    </div>
                  </div>
                  {low && (
                    <div className="mt-2">
                      <LowBadge />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ---------- Stock movement dialog ---------- */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log stock in / out</DialogTitle>
            <DialogDescription>
              Received a purchase or donation? Moving stock out for a drive? Record
              it — every movement is audit-logged with your name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Movement direction">
              <Button
                type="button"
                variant={direction === "IN" ? "default" : "outline"}
                className={cn("min-h-11 gap-1.5", direction === "OUT" && "border-zinc-500/30")}
                onClick={() => setDirection("IN")}
                aria-pressed={direction === "IN"}
              >
                <ArrowDownToLine className="size-4" aria-hidden="true" />
                Stock in
              </Button>
              <Button
                type="button"
                variant={direction === "OUT" ? "default" : "outline"}
                className={cn("min-h-11 gap-1.5", direction === "IN" && "border-zinc-500/30")}
                onClick={() => setDirection("OUT")}
                aria-pressed={direction === "OUT"}
              >
                <ArrowUpFromLine className="size-4" aria-hidden="true" />
                Stock out
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-item">Item</Label>
              <Select value={moveItemId} onValueChange={setMoveItemId}>
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
              <Label htmlFor="inv-qty">
                Quantity {direction === "IN" ? "received" : "issued"}
              </Label>
              <Input
                id="inv-qty"
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="e.g. 50"
                value={moveQty}
                onChange={(e) => setMoveQty(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-notes">Notes (optional)</Label>
              <Textarea
                id="inv-notes"
                rows={2}
                placeholder={
                  direction === "IN"
                    ? "e.g. Received from donor Amit — 50 rice bags"
                    : volunteer?.assignedArea
                      ? `e.g. Issued for ${volunteer.assignedArea} drive`
                      : "e.g. Issued for Saturday drive"
                }
                value={moveNotes}
                onChange={(e) => setMoveNotes(e.target.value)}
              />
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <ScrollText className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Stock-outs can&apos;t push a quantity below zero. Deleting items is
              admin-only — volunteers adjust quantities safely here.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setMoveOpen(false)}
            >
              Cancel
            </Button>
            <Button className="min-h-11" onClick={submitMove} disabled={moving}>
              {moving ? "Recording…" : direction === "IN" ? "Record stock in" : "Record stock out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
