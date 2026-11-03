"use client";

/**
 * Activity Logs — round-5: DataTable (fill height, skeleton rows, built-in
 * pagination), full-screen DetailSheet with log details rendered as readable
 * key-value pairs (JSON-aware), action/entity filters + date range and CSV
 * export via the shared ExportMenu.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Braces,
  Fingerprint,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDateTime, initials, titleCase } from "@/lib/format";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { PageHeader } from "@/components/shared/page-header";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import {
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

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

function ActionPill({ action, className }: { action: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
        actionTone(action),
        className
      )}
    >
      {titleCase(action.replace(/_/g, " "))}
    </span>
  );
}

/** Try to parse the details blob as JSON for a readable key-value rendering. */
function parseDetails(details?: string | null): { entries: [string, string][]; raw: string } {
  const raw = details ?? "";
  if (!raw) return { entries: [], raw: "" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>).map(
        ([k, v]) =>
          [
            titleCase(k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase()),
            v === null || v === undefined
              ? "—"
              : typeof v === "object"
                ? JSON.stringify(v)
                : String(v),
          ] as [string, string]
      );
      if (entries.length > 0) return { entries, raw };
    }
  } catch {
    // not JSON — render as plain text
  }
  return { entries: [], raw };
}

/** One fetch of the newest entries; pagination over this pool is client-side. */
const FETCH_LIMIT = 500;

/* ---------------------------------- view ----------------------------------- */

export default function ActivityView() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // filters
  const [q, setQ] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [entityFilter, setEntityFilter] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // pagination + detail sheet
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [detail, setDetail] = useState<LogRow | null>(null);

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

  const actionOptions = useMemo(() => {
    const set = new Map<string, number>();
    for (const r of rows) set.set(r.action, (set.get(r.action) ?? 0) + 1);
    return Array.from(set.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 40)
      .map(([a]) => a);
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromDate = from ? new Date(`${from}T00:00:00`) : null;
    const toDate = to ? new Date(`${to}T23:59:59.999`) : null;
    return rows.filter((r) => {
      if (actionFilter !== "ALL" && r.action !== actionFilter) return false;
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
  }, [rows, q, actionFilter, entityFilter, from, to]);

  // reset to the first page whenever filters change
  useEffect(() => {
    setPage(1);
  }, [q, actionFilter, entityFilter, from, to, pageSize]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));

  // keep the page in range when the pool shrinks after a refresh
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const toggleEntity = (t: string) =>
    setEntityFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const hasFilters =
    q.trim() !== "" || actionFilter !== "ALL" || entityFilter.length > 0 || from !== "" || to !== "";

  const resetFilters = () => {
    setQ("");
    setActionFilter("ALL");
    setEntityFilter([]);
    setFrom("");
    setTo("");
  };

  const csvColumns: CsvColumn<LogRow>[] = useMemo(
    () => [
      { header: "Timestamp", value: (r) => formatDateTime(r.createdAt) },
      { header: "Actor", value: (r) => r.actorName || "System" },
      { header: "Action", value: (r) => r.action },
      { header: "Entity type", value: (r) => r.entityType },
      { header: "Entity ID", value: (r) => r.entityId ?? "" },
      { header: "Details", value: (r) => r.details ?? "" },
      { header: "IP address", value: (r) => r.ipAddress ?? "" },
    ],
    []
  );

  const detailParsed = parseDetails(detail?.details);

  const columns: DataTableColumn<LogRow>[] = [
    { key: "actor", header: "Actor" },
    { key: "action", header: "Action" },
    { key: "entity", header: "Entity", hideBelow: "sm" },
    { key: "details", header: "Details", hideBelow: "lg" },
    { key: "time", header: "Time", hideBelow: "md" },
    { key: "actions", header: "", align: "right", className: "w-10" },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Activity Logs"
        description="Immutable audit trail of every action across the trust — auto-refreshes every 15s."
        icon={<Activity className="size-5" aria-hidden="true" />}
        actions={
          <>
            <ExportMenu
              columns={csvColumns}
              rows={filtered}
              filename="uar-activity-logs"
              disabled={filtered.length === 0}
            />
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
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by action">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="ALL">All actions</SelectItem>
                {actionOptions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {titleCase(a.replace(/_/g, " "))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label htmlFor="act-from" className="text-xs text-muted-foreground">From</Label>
            <Input id="act-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" aria-label="Activity from date" />
            <Label htmlFor="act-to" className="text-xs text-muted-foreground">To</Label>
            <Input id="act-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" aria-label="Activity to date" />
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
                    "min-h-9 rounded-full border px-3 text-xs font-medium transition-colors",
                    on
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {titleCase(t)}
                </button>
              );
            })}
            {hasFilters && (
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

      <DataTable
        columns={columns}
        rows={filtered.slice((page - 1) * pageSize, page * pageSize)}
        rowKey={(r) => r.id}
        loading={loading}
        skeletonRows={8}
        height="fill"
        fillOffset={300}
        onRowClick={(r) => setDetail(r)}
        page={page}
        pages={pages}
        total={filtered.length}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={setPageSize}
        itemLabel="entries"
        empty={
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
        }
      >
        {(r, col) => {
          switch (col.key) {
            case "actor":
              return (
                <div className="flex items-center gap-2">
                  <Avatar className="size-7">
                    <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                      {initials(r.actorName ?? "System")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="max-w-32 truncate text-sm font-medium">{r.actorName || "System"}</span>
                </div>
              );
            case "action":
              return <ActionPill action={r.action} />;
            case "entity":
              return (
                <span className="whitespace-nowrap text-sm text-muted-foreground">
                  {titleCase(r.entityType)}
                  {r.entityId && (
                    <span className="ml-1 font-mono text-[10px] opacity-70">{r.entityId.slice(0, 8)}…</span>
                  )}
                </span>
              );
            case "details":
              return <span className="block max-w-xs truncate text-sm text-muted-foreground">{r.details || "—"}</span>;
            case "time":
              return <span className="whitespace-nowrap text-sm">{formatDateTime(r.createdAt)}</span>;
            default:
              return null;
          }
        }}
      </DataTable>

      {!loading && rows.length >= FETCH_LIMIT && (
        <p className="text-center text-xs text-muted-foreground">
          Showing the latest {FETCH_LIMIT} entries — narrow the filters to dig deeper.
        </p>
      )}

      {/* ------------------------------ Detail sheet ----------------------------- */}
      <DetailSheet
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        eyebrow="Activity log"
        title={detail ? titleCase(detail.action.replace(/_/g, " ")) : "Log entry"}
        description={detail ? `${detail.actorName || "System"} · ${formatDateTime(detail.createdAt)}` : ""}
        status={detail ? <ActionPill action={detail.action} /> : undefined}
      >
        {detail ? (
          <>
            <DetailSection
              title="Entry"
              description="Who did what, to which record and when."
            >
              <DetailGrid cols={2}>
                <DataField label="Actor" icon={<UserRound className="size-3" aria-hidden="true" />} value={detail.actorName || "System"} />
                <DataField label="Actor user ID" icon={<Fingerprint className="size-3" aria-hidden="true" />} value={detail.userId} mono copy />
                <DataField label="Entity type" value={titleCase(detail.entityType)} />
                <DataField label="Entity ID" value={detail.entityId} mono copy />
                <DataField label="Timestamp" value={formatDateTime(detail.createdAt)} />
                <DataField label="Log ID" value={detail.id} mono copy />
              </DetailGrid>
            </DetailSection>

            <DetailSection
              title="Details"
              description={detailParsed.entries.length > 0 ? "Structured payload attached to this action." : "Free-text note attached to this action."}
            >
              {detailParsed.entries.length > 0 ? (
                <div className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
                  {detailParsed.entries.map(([k, v]) => (
                    <DataField key={k} label={k} value={v} mono className="min-w-0" />
                  ))}
                </div>
              ) : detail.details ? (
                <p className="whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed">
                  {detail.details}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No details were recorded for this entry.</p>
              )}
            </DetailSection>

            <DetailSection title="Request metadata" description="Client context captured with the log entry.">
              <DetailGrid cols={1}>
                <DataField label="IP address" value={detail.ipAddress} mono copy />
                <DataField label="User agent" value={detail.userAgent} />
              </DetailGrid>
              {detailParsed.raw && detailParsed.entries.length > 0 ? (
                <div className="mt-3 rounded-lg border border-dashed bg-muted/40 p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <Braces className="size-3" aria-hidden="true" /> Raw JSON
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {JSON.stringify(JSON.parse(detailParsed.raw), null, 2)}
                  </pre>
                </div>
              ) : null}
            </DetailSection>
          </>
        ) : null}
      </DetailSheet>
    </div>
  );
}
