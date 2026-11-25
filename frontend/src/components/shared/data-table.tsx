"use client";

/**
 * DataTable — the standard modern data table for every list page.
 *
 * Features per design spec:
 *  - Sticky header + vertically scrollable body inside a fixed height that
 *    adapts to the screen (`height="fill"` → calc(100vh - offset)); any
 *    max-h-* class also works and ALWAYS yields an inner scroll area.
 *  - Loading skeleton rows (no layout shift)
 *  - Premium pagination footer: page-size selector, compact numbered
 *    pagination, range counts, first/last buttons
 *  - Empty state hook, row click support, column alignment
 *  - Columns keyed "actions" with a blank header automatically get a proper
 *    (screen-reader visible) "Actions" caption so the header is never missing.
 *  - Fully theme-aware (light + dark tokens)
 *
 * Usage:
 *   <DataTable
 *     columns={[{key,header,className?,align?,mono?}, …]}
 *     rows={data}
 *     loading={isLoading}
 *     skeletonRows={8}
 *     height="fill"          // or "auto" or a max-h class
 *     rowKey={(r) => r.id}
 *     onRowClick={(r) => openDetail(r)}
 *     page={page} pages={pages} total={total} pageSize={size}
 *     onPage={setPage} onPageSize={setSize}
 *     empty={<EmptyState …/>}
 *   >{(row, col) => cell}</DataTable>
 *
 * `children` receives (row, column) and returns the cell content; if not
 * provided, rows are rendered as plain cells keyed by column.key.
 */

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Inbox,
} from "lucide-react";
import { PageSizeSelect } from "@/components/shared/view-switcher";

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  /** Render mono/tabular numerals (amounts, codes). */
  mono?: boolean;
  /** Visually hidden on small screens (secondary columns). */
  hideBelow?: "sm" | "md" | "lg";
  accessor?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  skeletonRows?: number;
  /** "fill" = adapt to remaining viewport; "auto" = natural height; or a class like "max-h-[32rem]". */
  height?: "fill" | "auto" | string;
  /** Viewport offset (px) used with height="fill". */
  fillOffset?: number;
  onRowClick?: (row: T) => void;
  children?: (row: T, column: DataTableColumn<T>) => React.ReactNode;
  empty?: React.ReactNode;
  page?: number;
  pages?: number;
  total?: number;
  pageSize?: number;
  onPage?: (p: number) => void;
  onPageSize?: (n: number) => void;
  itemLabel?: string;
  className?: string;
}

const HIDE: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

const ALIGN: Record<string, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  skeletonRows = 8,
  height = "auto",
  fillOffset = 260,
  onRowClick,
  children,
  empty,
  page,
  pages,
  total,
  pageSize,
  onPage,
  onPageSize,
  itemLabel = "records",
  className,
}: DataTableProps<T>) {
  const isFill = height === "fill";
  const isAuto = height === "auto";

  const showPager =
    page !== undefined && pages !== undefined && total !== undefined && onPage;

  const pageNumbers = (() => {
    if (!showPager) return [];
    const win: number[] = [];
    const start = Math.max(1, (page as number) - 1);
    const end = Math.min(pages as number, start + 2);
    for (let i = Math.max(1, end - 2); i <= end; i++) win.push(i);
    return win;
  })();

  const rangeLabel = (() => {
    if (!showPager || (total as number) === 0) return `0 ${itemLabel}`;
    const size = pageSize ?? (total as number);
    const from = ((page as number) - 1) * size + 1;
    const to = Math.min((page as number) * size, total as number);
    return `${from}–${to} of ${total} ${itemLabel}`;
  })();

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      {/* Outer card: flex column so the scroll area can always be constrained */}
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs",
          !isAuto && !isFill && height ? height : ""
        )}
        style={
          isFill
            ? { maxHeight: `calc(100vh - ${fillOffset}px)`, minHeight: 240 }
            : undefined
        }
      >
        {/* Inner scroll region: flex-1 + min-h-0 guarantees scrolling */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full caption-bottom border-collapse text-sm">
            <thead className="sticky top-0 z-[1] bg-muted/70 backdrop-blur">
              <tr className="border-b">
                {columns.map((c) => {
                  // Auto-caption for blank action columns so the header is
                  // never missing (visible to screen readers, styled subtly).
                  const isBlankAction =
                    c.key === "actions" &&
                    (c.header === "" || c.header === undefined || c.header === null);
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      className={cn(
                        "h-10 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                        isBlankAction ? "text-right" : ALIGN[c.align ?? "left"],
                        c.hideBelow ? HIDE[c.hideBelow] : "",
                        c.className
                      )}
                    >
                      {isBlankAction ? (
                        <span className="text-muted-foreground/70">Actions</span>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: skeletonRows }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b/60">
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          "h-12 px-3",
                          c.hideBelow ? HIDE[c.hideBelow] : ""
                        )}
                      >
                        <Skeleton
                          className="h-4"
                          style={{
                            width: `${52 + ((i * 13 + c.key.length * 7) % 34)}%`,
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="p-0">
                    {empty ?? (
                      <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
                        <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
                          <Inbox className="size-5 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-medium">Nothing here yet</p>
                        <p className="max-w-xs text-xs text-muted-foreground">
                          Records will appear as soon as they are created.
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === "Enter") onRowClick(row);
                          }
                        : undefined
                    }
                    className={cn(
                      "border-b transition-colors last:border-b-0",
                      onRowClick &&
                        "cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                    )}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          "h-12 whitespace-nowrap px-3 align-middle",
                          ALIGN[c.align ?? "left"],
                          c.mono && "font-mono text-[13px] tabular-nums",
                          c.hideBelow ? HIDE[c.hideBelow] : ""
                        )}
                      >
                        {children ? (
                          children(row, c)
                        ) : c.accessor ? (
                          c.accessor(row)
                        ) : (
                          String((row as Record<string, unknown>)[c.key] ?? "")
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showPager ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground tabular-nums">
              {rangeLabel}
            </p>
            {onPageSize ? (
              <PageSizeSelect
                value={pageSize ?? 25}
                onChange={(n) => {
                  onPageSize(n);
                  onPage?.(1);
                }}
              />
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={(page as number) <= 1}
              onClick={() => onPage?.(1)}
              aria-label="First page"
            >
              <ChevronsLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={(page as number) <= 1}
              onClick={() => onPage?.((page as number) - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            {pageNumbers.map((n) => (
              <Button
                key={n}
                variant={n === page ? "default" : "outline"}
                size="icon"
                className="size-8 text-xs tabular-nums"
                onClick={() => onPage?.(n)}
                aria-label={`Page ${n}`}
                aria-current={n === page ? "page" : undefined}
              >
                {n}
              </Button>
            ))}
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={(page as number) >= (pages as number)}
              onClick={() => onPage?.((page as number) + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={(page as number) >= (pages as number)}
              onClick={() => onPage?.(pages as number)}
              aria-label="Last page"
            >
              <ChevronsRight className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
