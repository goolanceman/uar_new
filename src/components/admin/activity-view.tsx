"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import { cn, formatDateTime, timeAgo, titleCase } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: string | null;
  createdAt: string;
}

function actionBadgeClass(action: string): string {
  const a = action.toUpperCase();
  if (a.includes("DELETE") || a.includes("REJECT") || a.includes("FAIL")) return "bg-red-100 text-red-700";
  if (a.includes("CREATE") || a.includes("APPROVE") || a.includes("REGISTER")) return "bg-emerald-100 text-emerald-700";
  if (a.includes("UPDATE") || a.includes("PATCH") || a.includes("PAUSE")) return "bg-amber-100 text-amber-700";
  if (a.includes("LOGIN") || a.includes("LOGOUT")) return "bg-teal-100 text-teal-700";
  if (a.includes("SCAN") || a.includes("COMPLETE") || a.includes("DISPATCH")) return "bg-lime-100 text-lime-700";
  return "bg-zinc-100 text-zinc-600";
}

/* ---------------------------------- view ----------------------------------- */

export default function ActivityView() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    if (!firstLoad.current) setRefreshing(true);
    try {
      const data = await get<LogRow[] | { items?: LogRow[] }>("/api/activity-logs?limit=100");
      setRows(Array.isArray(data) ? data : (data.items ?? []));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load activity logs");
    } finally {
      setLoading(false);
      setRefreshing(false);
      firstLoad.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const filtered = rows.filter((r) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return (
      r.action.toLowerCase().includes(needle) ||
      r.entityType.toLowerCase().includes(needle) ||
      (r.actorName ?? "").toLowerCase().includes(needle)
    );
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by action, entity or actor…"
            className="pl-9"
            aria-label="Filter activity logs"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700" role="status">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" aria-hidden="true" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" aria-hidden="true" />
            </span>
            Live · auto-refresh 15s
          </span>
          <Button variant="outline" onClick={load} disabled={refreshing} aria-label="Refresh activity logs">
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /> Refresh
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card className="py-0">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Activity className="size-8" aria-hidden="true" />
              <p className="font-medium text-foreground">No activity found</p>
              <p>{q ? "Try a different filter term." : "System actions will be logged here as they happen."}</p>
            </div>
          ) : (
            <div className="max-h-[36rem] overflow-auto scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-36">Time</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="hidden sm:table-cell">Entity</TableHead>
                    <TableHead className="hidden lg:table-cell">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">
                        <p className="text-sm">{formatDateTime(r.createdAt)}</p>
                        <p className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{r.actorName || "System"}</TableCell>
                      <TableCell>
                        <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", actionBadgeClass(r.action))}>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
