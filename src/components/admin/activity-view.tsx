"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  Download,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDateTime, initials, titleCase } from "@/lib/format";
import { downloadCsv } from "@/components/shared/csv";
import { PaginationBar, PageSizeSelect } from "@/components/shared/view-switcher";
import { PageHeader } from "@/components/shared/page-header";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ------------------------------ types & helpers ----------------------------- */

interface LogRow {
  id: string;
  userId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

function actionTone(action: string): string {
  const a = action.toUpperCase();
  if (a.includes("DELETE") || a.includes("REJECT") || a.includes("FAIL")) return "bg-red-500/10 text-red-700 dark:text-red-400";
  if (a.includes("CREATE") || a.includes("APPROVE") || a.includes("REGISTER")) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (a.includes("UPDATE") || a.includes("PATCH") || a.includes("PAUSE")) return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  if (a.includes("LOGIN") || a.includes("LOGOUT")) return "bg-teal-500/10 text-teal-700 dark:text-teal-400";
  if (a.includes("SCAN") || a.includes("COMPLETE") || a.includes("DISPATCH")) return "bg-lime-500/10 text-lime-700 dark:text-lime-400";
  return "bg-muted text-muted-foreground";
}

/** One fetch of the newest entries; pagination over this pool is client-side. */
const FETCH_LIMIT = 500;

/* ---------------------------------- view ----------------------------------- */

export default function ActivityView() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // filters
  const [q, setQ] = useState("");
  const [entityFilter, setEntityFilter] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // client-side pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await get<LogRow[] | { items?: LogRow[] }>(`/api/activity-logs?limit=${FETCH_LIMIT}`);
      const list = Array.isArray(data) ? data : (data.items ?? []);
      setRows(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load activity logs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // live auto-refresh every 15s
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const entityTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.entityType).filter(Boolean))).sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromDate = from ? new Date(`${from}T00:00:00`) : null;
    const toDate = to ? new Date(`${to}T23:59:59.999`) : null;
    return rows.filter((r) => {
      if (entityFilter.length > 0 && !entityFilter.includes(r.entityType)) return false;
      if (needle) {
        const hay = `${r.action} ${r.entityType} ${r.actorName ?? ""} ${r.details ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      const created = new Date(r.createdAt);
      if (fromDate && created < fromDate) return false;
      if (toDate && created > toDate) return false;
      return true;
    });
  }, [rows, q, entityFilter, from, to]);

  // reset to the first page whenever filters change
  useEffect(() => {
    setPage(1);
  }, [q, entityFilter, from, to, pageSize]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));

  // keep the page in range when the pool shrinks after a refresh
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const pageRows = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const toggleEntity = (t: string) =>
    setEntityFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const hasFilters =
    q.trim() !== "" || entityFilter.length > 0 || from !== "" || to !== "";

  const resetFilters = () => {
    setQ("");
    setEntityFilter([]);
    setFrom("");
    setTo("");
  };

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.info("No log entries match the current filters");
      return;
    }
    downloadCsv("uar-activity-logs", [
      { header: "Timestamp", value: (r: LogRow) => formatDateTime(r.createdAt) },
      { header: "Actor", value: (r: LogRow) => r.actorName || "System" },
      { header: "Action", value: (r: LogRow) => r.action },
      { header: "Entity type", value: (r: LogRow) => r.entityType },
      { header: "Entity ID", value: (r: LogRow) => r.entityId ?? "" },
      { header: "Details", value: (r: LogRow) => r.details ?? "" },
      { header: "IP address", value: (r: LogRow) => r.ipAddress ?? "" },
    ], filtered);
    toast.success(`Exported ${filtered.length} log ${filtered.length === 1 ? "entry" : "entries"}`);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Activity Logs"
        description="Immutable audit trail of every action across the trust — auto-refreshes every 15s."
        icon={<Activity className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} aria-label="Export filtered activity logs as CSV">
              <Download className="size-4" aria-hidden="true" /> Export CSV
            </Button>
            <Button variant="outline" onClick={load} disabled={refreshing} aria-label="Refresh activity logs">
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} /> Refresh
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by action, entity, actor or details…"
              className="pl-9"
              aria-label="Filter activity logs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="act-from" className="text-xs text-muted-foreground">From</Label>
            <Input id="act-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="Activity from date" />
            <Label htmlFor="act-to" className="text-xs text-muted-foreground">To</Label>
            <Input id="act-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="Activity to date" />
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400" role="status">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" aria-hidden="true" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" aria-hidden="true" />
              </span>
              Live · 15s
            </span>
          </div>
        </div>

        {/* Entity type multi-select chips */}
        {entityTypes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by entity type">
            {entityTypes.map((t) => {
              const on = entityFilter.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleEntity(t)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    on
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {titleCase(t)}
                </button>
              );
            })}
            {(entityFilter.length > 0 || from !== "" || to !== "") && (
              <Button variant="ghost" size="sm" onClick={resetFilters} aria-label="Reset activity filters">
                Reset filters
              </Button>
            )}
            <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
              {loading ? "Loading…" : `${filtered.length} of ${rows.length} entries`}
            </span>
          </div>
        )}
      </div>

      {/* Log table */}
      <div className="rounded-xl border bg-card">
        {loading ? (
          <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading activity logs">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <Skeleton className="h-9 w-24 shrink-0 rounded-md" />
                <Skeleton className="h-9 flex-1 rounded-md" />
                <Skeleton className="hidden h-9 w-28 rounded-md sm:block" />
                <Skeleton className="hidden h-9 w-24 rounded-md md:block" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Activity className="size-6" aria-hidden="true" />}
              title="No activity found"
              hint={hasFilters ? "Try a different filter term or date range." : "System actions will be logged here as they happen."}
            >
              {hasFilters && (
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Clear filters
                </Button>
              )}
            </EmptyState>
          </div>
        ) : (
          <div className="max-h-[36rem] overflow-auto scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-10" aria-label="Expand" />
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden sm:table-cell">Entity</TableHead>
                  <TableHead className="hidden lg:table-cell">Details</TableHead>
                  <TableHead className="hidden md:table-cell">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => {
                  const open = expandedId === r.id;
                  return (
                    <TableRow key={r.id} className={cn(open && "bg-accent/40")}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setExpandedId(open ? null : r.id)}
                          aria-expanded={open}
                          aria-label={open ? `Collapse entry ${r.action}` : `Expand entry ${r.action} for details, IP and user agent`}
                          className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        >
                          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="size-7">
                            <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                              {initials(r.actorName ?? "System")}
                            </AvatarFallback>
                          </Avatar>
                          <span className="max-w-32 truncate text-sm font-medium">{r.actorName || "System"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", actionTone(r.action))}>
                          {titleCase(r.action.replace(/_/g, " "))}
                        </span>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground sm:table-cell">
                        {titleCase(r.entityType)}
                        {r.entityId && <span className="ml-1 font-mono text-[10px] opacity-70">{r.entityId.slice(0, 8)}…</span>}
                      </TableCell>
                      <TableCell className="hidden max-w-xs truncate text-sm text-muted-foreground lg:table-cell">
                        {r.details || "—"}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap md:table-cell">
                        <p className="text-sm">{formatDateTime(r.createdAt)}</p>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Expanded detail panel — rendered below the table for the selected row */}
        {!loading && expandedId && (() => {
          const r = rows.find((x) => x.id === expandedId);
          if (!r) return null;
          return (
            <div className="border-t bg-accent/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", actionTone(r.action))}>
                    {titleCase(r.action.replace(/_/g, " "))}
                  </span>
                  <span className="text-muted-foreground">entry details</span>
                </p>
                <Button size="sm" variant="ghost" onClick={() => setExpandedId(null)} aria-label="Close entry details">
                  Close
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                <DataField label="Log ID" value={r.id} mono copy />
                <DataField label="Actor" value={r.actorName || "System"} />
                <DataField label="Actor user ID" value={r.userId} mono />
                <DataField label="Entity type" value={titleCase(r.entityType)} />
                <DataField label="Entity ID" value={r.entityId} mono copy />
                <DataField label="IP address" value={r.ipAddress} mono copy />
                <DataField label="Timestamp" value={formatDateTime(r.createdAt)} />
                <DataField label="User agent" value={r.userAgent} />
              </div>
              {r.details && (
                <div className="mt-4 rounded-md border bg-background/60 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Details</p>
                  <p className="mt-1 break-words text-sm">{r.details}</p>
                </div>
              )}
            </div>
          );
        })()}

        {/* Pagination */}
        {!loading && filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3">
            <PaginationBar
              page={page}
              pages={pages}
              total={filtered.length}
              onPage={setPage}
              itemLabel="entries"
            />
            <PageSizeSelect
              value={pageSize}
              onChange={setPageSize}
              options={[25, 50, 100]}
            />
          </div>
        )}
        {!loading && rows.length >= FETCH_LIMIT && (
          <div className="border-t p-3 text-center text-xs text-muted-foreground">
            Showing the latest {FETCH_LIMIT} entries — narrow the filters to dig deeper.
          </div>
        )}
      </div>
    </div>
  );
}
