"use client";

/**
 * ViewSwitcher + PaginationBar + useViewPref — the list-page layout toolkit.
 * Every list page can offer Table / Grid / List layouts with a persisted
 * preference (localStorage per module key), plus consistent pagination.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import {
  LayoutGrid, List, Table2, ChevronLeft, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type DataViewMode = "table" | "grid" | "list";

const VALID: DataViewMode[] = ["table", "grid", "list"];

// ─── module-level store (hydration-safe, lint-clean) ─────────────────────────
const listeners = new Set<() => void>();
const cache = new Map<string, DataViewMode>();

function read(key: string, initial: DataViewMode): DataViewMode {
  const cached = cache.get(key);
  if (cached) return cached;
  let v = initial;
  try {
    const saved = window.localStorage.getItem(`uar-view-${key}`);
    if (saved && VALID.includes(saved as DataViewMode)) v = saved as DataViewMode;
  } catch {
    // storage unavailable
  }
  cache.set(key, v);
  return v;
}

function write(key: string, m: DataViewMode): void {
  cache.set(key, m);
  try {
    window.localStorage.setItem(`uar-view-${key}`, m);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

/** Persisted per-module view preference. */
export function useViewPref(
  moduleKey: string,
  initial: DataViewMode = "table"
): [DataViewMode, (m: DataViewMode) => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    []
  );
  const getSnapshot = useCallback(() => read(moduleKey, initial), [moduleKey, initial]);
  const getServerSnapshot = useCallback(() => initial, [initial]);
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const update = useCallback((m: DataViewMode) => write(moduleKey, m), [moduleKey]);
  return [mode, update];
}

export function ViewSwitcher({
  value,
  onChange,
  options,
  className,
}: {
  value: DataViewMode;
  onChange: (m: DataViewMode) => void;
  /** Subset to offer, e.g. ["table","grid"] */
  options?: DataViewMode[];
  className?: string;
}) {
  const opts = options ?? ["table", "grid", "list"];
  const meta: Record<DataViewMode, { icon: React.ReactNode; label: string }> = {
    table: { icon: <Table2 className="size-4" />, label: "Table view" },
    grid: { icon: <LayoutGrid className="size-4" />, label: "Grid view" },
    list: { icon: <List className="size-4" />, label: "List view" },
  };
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as DataViewMode)}
      variant="outline"
      size="sm"
      className={cn("bg-background", className)}
      aria-label="Switch list layout"
    >
      {opts.map((o) => (
        <ToggleGroupItem key={o} value={o} aria-label={meta[o].label} title={meta[o].label}>
          {meta[o].icon}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function PaginationBar({
  page,
  pages,
  total,
  onPage,
  itemLabel = "records",
  className,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
  itemLabel?: string;
  className?: string;
}) {
  if (pages <= 1) {
    return (
      <div className={cn("flex items-center justify-between px-1 text-xs text-muted-foreground", className)}>
        <span>
          {total} {itemLabel}
        </span>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 px-1", className)}>
      <span className="text-xs text-muted-foreground">
        Page {page} of {pages} · {total} {itemLabel}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" /> Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          Next <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** Simple page-size selector shown next to the pagination bar. */
export function PageSizeSelect({
  value,
  onChange,
  options = [25, 50, 100],
}: {
  value: number;
  onChange: (n: number) => void;
  options?: number[];
}) {
  return (
    <select
      aria-label="Rows per page"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-8 rounded-md border bg-background px-2 text-xs text-muted-foreground"
    >
      {options.map((n) => (
        <option key={n} value={n}>
          {n} / page
        </option>
      ))}
    </select>
  );
}
