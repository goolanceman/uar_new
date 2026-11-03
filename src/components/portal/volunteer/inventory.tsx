"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  MapPin,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get } from "@/lib/api-client";
import { cn, formatNumber, titleCase } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewSwitcher, useViewPref, type DataViewMode } from "@/components/shared/view-switcher";
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

/** Stock-level bar — quantity relative to 3× the min-stock threshold (healthy buffer). */
function levelPct(item: InventoryItem): number {
  const healthy = Math.max(1, item.minStock * 3);
  return Math.min(100, Math.round((item.quantity / healthy) * 100));
}

export default function VolunteerInventory({
  volunteer: _volunteer,
}: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useViewPref("volunteer-inventory", "table");

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

  const lowItems = useMemo(() => items.filter((i) => i.quantity <= i.minStock), [items]);
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);

  const LevelBar = ({ item }: { item: InventoryItem }) => {
    const pct = levelPct(item);
    return (
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${item.name} stock level`}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            item.quantity <= item.minStock
              ? "bg-amber-500"
              : pct < 50
                ? "bg-teal-500"
                : "bg-emerald-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
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
          <div className="flex flex-wrap items-center gap-2">
            <ViewSwitcher value={view} onChange={(m: DataViewMode) => setView(m)} options={["table", "list"]} />
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
          </div>
        }
      />

      {/* Read-only note + stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Stock items"
          value={loading ? "" : String(items.length)}
          hint="Across all UAR stock rooms"
          icon={<Boxes className="size-5" />}
          accent="emerald"
          loading={loading}
        />
        <StatCard
          label="Low stock"
          value={loading ? "" : String(lowItems.length)}
          hint="At or below minimum — flag to your coordinator"
          icon={<AlertTriangle className="size-5" />}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="Total units"
          value={loading ? "" : formatNumber(totalUnits)}
          hint="All quantities combined"
          icon={<Boxes className="size-5" />}
          accent="teal"
          loading={loading}
        />
      </div>

      <p className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-3 text-xs text-muted-foreground">
        Inventory is read-only in the volunteer portal — stock in/out is logged by the
        admin console. If a drive needs stock, ask your coordinator before handover.
      </p>

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
      ) : view === "table" ? (
        <SectionCard title="Stock list" description="Progress shows quantity against a healthy 3× buffer" bodyClassName="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="w-44">Stock level</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Min</TableHead>
                  <TableHead className="hidden md:table-cell">Location</TableHead>
                  <TableHead className="w-16" aria-label="Status" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((i) => {
                  const low = i.quantity <= i.minStock;
                  return (
                    <TableRow key={i.id} className={cn(low && "bg-amber-500/5")}>
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell className="text-muted-foreground">{titleCase(i.category)}</TableCell>
                      <TableCell>
                        <LevelBar item={i} />
                      </TableCell>
                      <TableCell
                        className={cn("text-right font-semibold", low && "text-amber-700 dark:text-amber-400")}
                      >
                        {formatNumber(i.quantity)} {i.unit}
                      </TableCell>
                      <TableCell className="hidden text-right text-muted-foreground sm:table-cell">
                        {formatNumber(i.minStock)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
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
        </SectionCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((i) => {
            const low = i.quantity <= i.minStock;
            return (
              <div
                key={i.id}
                className={cn(
                  "rounded-xl border bg-card p-4",
                  low && "border-amber-500/40 bg-amber-500/5"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{i.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {titleCase(i.category)} · min {formatNumber(i.minStock)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-base font-bold", low && "text-amber-700 dark:text-amber-400")}>
                      {formatNumber(i.quantity)}
                    </p>
                    <p className="text-xs text-muted-foreground">{i.unit}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <LevelBar item={i} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3" aria-hidden="true" />
                    <span className="truncate">{i.location ?? "—"}</span>
                  </p>
                  {low && <LowBadge />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
