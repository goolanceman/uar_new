"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ClipboardList, PackageOpen, Pencil, Plus, Printer, QrCode,
  RefreshCw, Search, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, post, patch } from "@/lib/api-client";
import { useMasters } from "@/hooks/use-masters";
import { cn, formatDateTime, formatINR, formatNumber, titleCase } from "@/lib/utils";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface TplItem {
  name: string;
  qty: string;
  unit: string;
}

interface KitTemplate {
  id: string;
  name: string;
  description?: string | null;
  items: string;
  costPerUnit: number;
}

interface KitBatch {
  id: string;
  templateId: string;
  name: string;
  totalUnits: number;
  scannedUnits: number;
  instructions?: string | null;
  status: string;
  template?: KitTemplate | null;
}

interface KitUnit {
  id: string;
  batchId: string;
  code: string;
  status: string;
  scannedAt?: string | null;
  scannedByName?: string | null;
  location?: string | null;
  batch?: { name?: string | null } | null;
}

interface KitStats {
  totalUnits?: number;
  total?: number;
  ready?: number;
  readyUnits?: number;
  scanned?: number;
  scannedUnits?: number;
  expired?: number;
}

interface BatchForm {
  templateId: string;
  name: string;
  totalUnits: string;
  instructions: string;
}

interface TemplateForm {
  name: string;
  description: string;
  costPerUnit: string;
  items: TplItem[];
}

const BATCH_STATUS: Record<string, string> = {
  READY: "border-emerald-200 bg-emerald-50 text-emerald-800",
  IN_PROGRESS: "border-amber-200 bg-amber-50 text-amber-800",
  DEPLETED: "border-rose-200 bg-rose-50 text-rose-800",
};

const UNIT_STATUS: Record<string, string> = {
  READY: "border-emerald-200 bg-emerald-50 text-emerald-800",
  SCANNED: "border-teal-200 bg-teal-50 text-teal-800",
  EXPIRED: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

const EMPTY_BATCH_FORM: BatchForm = {
  templateId: "",
  name: "",
  totalUnits: "25",
  instructions: "",
};

const EMPTY_TPL_FORM: TemplateForm = {
  name: "",
  description: "",
  costPerUnit: "",
  items: [{ name: "", qty: "1", unit: "kg" }],
};

function parseItems(json: string | null | undefined): TplItem[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { name?: string; qty?: number; unit?: string }[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((i) => ({
      name: String(i?.name ?? "—"),
      qty: String(i?.qty ?? 0),
      unit: String(i?.unit ?? "pcs"),
    }));
  } catch {
    return [];
  }
}

export default function KitsView() {
  const [tab, setTab] = useState("batches");

  // ---------- batches ----------
  const [batches, setBatches] = useState<KitBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [unitsMap, setUnitsMap] = useState<Record<string, KitUnit[]>>({});
  const [loadingUnitsId, setLoadingUnitsId] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState<BatchForm>(EMPTY_BATCH_FORM);
  const [savingBatch, setSavingBatch] = useState(false);
  const [printState, setPrintState] = useState<{ name: string; units: KitUnit[] } | null>(null);

  // ---------- templates ----------
  const [templates, setTemplates] = useState<KitTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [tplOpen, setTplOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<KitTemplate | null>(null);
  const [tplForm, setTplForm] = useState<TemplateForm>(EMPTY_TPL_FORM);
  const [savingTpl, setSavingTpl] = useState(false);
  const [tplDeleteTarget, setTplDeleteTarget] = useState<KitTemplate | null>(null);

  // ---------- unit explorer ----------
  const [units, setUnits] = useState<KitUnit[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [unitStatus, setUnitStatus] = useState("all");
  const [stats, setStats] = useState<KitStats>({});

  const unitOptions = useMasters("UNIT");

  // ---------- loaders ----------
  const loadBatches = useCallback(async () => {
    try {
      const data = await get<KitBatch[]>("/api/kit-batches");
      setBatches(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load batches");
    } finally {
      setLoadingBatches(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await get<KitTemplate[]>("/api/kit-templates");
      setTemplates(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const loadUnitsForBatch = useCallback(async (batchId: string) => {
    setLoadingUnitsId(batchId);
    try {
      const data = await get<KitUnit[]>(`/api/kit-units?batchId=${encodeURIComponent(batchId)}`);
      setUnitsMap((m) => ({ ...m, [batchId]: Array.isArray(data) ? data : [] }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load kit units");
    } finally {
      setLoadingUnitsId(null);
    }
  }, []);

  const loadExplorer = useCallback(async () => {
    setLoadingUnits(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (appliedQ.trim()) params.set("q", appliedQ.trim());
      if (unitStatus !== "all") params.set("status", unitStatus);
      const data = await get<KitUnit[]>(`/api/kit-units?${params.toString()}`);
      setUnits(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load kit units");
    } finally {
      setLoadingUnits(false);
    }
  }, [appliedQ, unitStatus]);

  const loadStats = useCallback(async () => {
    try {
      const s = await get<KitStats>("/api/kit-stats");
      setStats(s ?? {});
    } catch {
      setStats({});
    }
  }, []);

  useEffect(() => {
    loadBatches();
    loadTemplates();
    loadStats();
  }, [loadBatches, loadTemplates, loadStats]);

  useEffect(() => {
    loadExplorer();
  }, [loadExplorer]);

  // print handling — render labels, then trigger the browser print dialog
  useEffect(() => {
    if (!printState) return;
    const t = setTimeout(() => {
      window.print();
      setPrintState(null);
    }, 120);
    return () => clearTimeout(t);
  }, [printState]);

  // ---------- batch actions ----------
  const toggleExpand = (batch: KitBatch) => {
    if (expandedId === batch.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(batch.id);
    if (!unitsMap[batch.id]) loadUnitsForBatch(batch.id);
  };

  const createBatch = async () => {
    if (!batchForm.templateId || !batchForm.name.trim()) {
      toast.error("Select a template and name the batch");
      return;
    }
    setSavingBatch(true);
    try {
      const res = await post<{ count?: number; units?: unknown[] }>("/api/kit-batches", {
        templateId: batchForm.templateId,
        name: batchForm.name.trim(),
        totalUnits: Number(batchForm.totalUnits) || 1,
        instructions: batchForm.instructions.trim(),
      });
      const n = res?.count ?? res?.units?.length ?? (Number(batchForm.totalUnits) || 1);
      toast.success(`${n} QR labels generated`);
      setBatchOpen(false);
      setBatchForm(EMPTY_BATCH_FORM);
      loadBatches();
      loadStats();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create batch");
    } finally {
      setSavingBatch(false);
    }
  };

  const printLabels = async (batch: KitBatch) => {
    let batchUnits = unitsMap[batch.id];
    if (!batchUnits) {
      try {
        const data = await get<KitUnit[]>(`/api/kit-units?batchId=${encodeURIComponent(batch.id)}`);
        batchUnits = Array.isArray(data) ? data : [];
        setUnitsMap((m) => ({ ...m, [batch.id]: batchUnits ?? [] }));
      } catch {
        batchUnits = [];
      }
    }
    if (!batchUnits || batchUnits.length === 0) {
      toast.error("No kit units to print for this batch");
      return;
    }
    setPrintState({ name: batch.name, units: batchUnits.slice(0, 120) });
  };

  // ---------- template actions ----------
  const openCreateTpl = () => {
    setEditingTpl(null);
    setTplForm(EMPTY_TPL_FORM);
    setTplOpen(true);
  };

  const openEditTpl = (t: KitTemplate) => {
    setEditingTpl(t);
    setTplForm({
      name: t.name ?? "",
      description: t.description ?? "",
      costPerUnit: t.costPerUnit != null ? String(t.costPerUnit) : "",
      items: parseItems(t.items).map((i) => ({ name: i.name, qty: i.qty, unit: i.unit })),
    });
    setTplOpen(true);
  };

  const saveTemplate = async () => {
    if (!tplForm.name.trim()) {
      toast.error("Template name is required");
      return;
    }
    const items = tplForm.items
      .filter((i) => i.name.trim())
      .map((i) => ({ name: i.name.trim(), qty: Number(i.qty) || 0, unit: i.unit }));
    if (items.length === 0) {
      toast.error("Add at least one item with a name");
      return;
    }
    setSavingTpl(true);
    try {
      const body = {
        name: tplForm.name.trim(),
        description: tplForm.description.trim(),
        costPerUnit: Number(tplForm.costPerUnit) || 0,
        items: JSON.stringify(items),
      };
      if (editingTpl) {
        await patch(`/api/kit-templates/${editingTpl.id}`, body);
        toast.success(`Template ${body.name} updated`);
      } else {
        await post("/api/kit-templates", body);
        toast.success(`Template ${body.name} created`);
      }
      setTplOpen(false);
      loadTemplates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingTpl(false);
    }
  };

  const removeTemplate = async () => {
    if (!tplDeleteTarget) return;
    try {
      await del(`/api/kit-templates/${tplDeleteTarget.id}`);
      toast.success(`Template ${tplDeleteTarget.name} deleted`);
      setTplDeleteTarget(null);
      loadTemplates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Template has batches");
    }
  };

  // ---------- derived ----------
  const statsChips = useMemo(
    () => ({
      total: stats.totalUnits ?? stats.total ?? 0,
      ready: stats.ready ?? stats.readyUnits ?? 0,
      scanned: stats.scanned ?? stats.scannedUnits ?? 0,
      expired: stats.expired ?? 0,
    }),
    [stats]
  );

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="batches">Batches</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="explorer">Unit Explorer</TabsTrigger>
          </TabsList>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
            {formatNumber(statsChips.ready)} ready
          </Badge>
          <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-800">
            {formatNumber(statsChips.scanned)} scanned
          </Badge>
        </div>

        {/* ================= BATCHES ================= */}
        <TabsContent value="batches" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{formatNumber(batches.length)} batch{batches.length === 1 ? "" : "es"}</Badge>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="icon" onClick={loadBatches} aria-label="Refresh batches">
                <RefreshCw className="size-4" />
              </Button>
              <Button
                onClick={() => {
                  setBatchForm(EMPTY_BATCH_FORM);
                  setBatchOpen(true);
                }}
              >
                <Plus className="size-4" /> Create batch
              </Button>
            </div>
          </div>

          {loadingBatches ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-52 rounded-xl" />
              ))}
            </div>
          ) : batches.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
              <ClipboardList className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No batches yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Create a batch from a template — QR labels are generated per ration kit unit.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {batches.map((b) => {
                const pct =
                  b.totalUnits > 0 ? Math.min(100, Math.round(((b.scannedUnits || 0) / b.totalUnits) * 100)) : 0;
                const expanded = expandedId === b.id;
                const batchUnits = unitsMap[b.id];
                return (
                  <Card key={b.id} className="flex flex-col">
                    <CardContent className="flex flex-1 flex-col gap-3 p-4">
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 text-left"
                        onClick={() => toggleExpand(b)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} batch ${b.name}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold leading-tight">{b.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {b.template?.name ?? "—"}
                          </p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", BATCH_STATUS[b.status] ?? "")}>
                          {titleCase(b.status)}
                        </Badge>
                        <ChevronDown
                          className={cn(
                            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                            expanded && "rotate-180"
                          )}
                        />
                      </button>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>
                            {formatNumber(b.scannedUnits)} / {formatNumber(b.totalUnits)} scanned
                          </span>
                          <span>{pct}%</span>
                        </div>
                        <Progress
                          value={pct}
                          className="h-2"
                          aria-label={`${b.name} scan progress ${pct}%`}
                        />
                      </div>

                      {b.instructions ? (
                        <blockquote className="border-l-4 border-emerald-300 pl-3 text-xs italic text-muted-foreground">
                          {b.instructions}
                        </blockquote>
                      ) : null}

                      {expanded ? (
                        <div className="border-t pt-2">
                          {loadingUnitsId === b.id ? (
                            <Skeleton className="h-40 rounded-lg" />
                          ) : !batchUnits || batchUnits.length === 0 ? (
                            <p className="py-4 text-center text-xs text-muted-foreground">
                              No kit units found for this batch.
                            </p>
                          ) : (
                            <div className="max-h-96 overflow-y-auto scrollbar-thin">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Code</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Scanned by</TableHead>
                                    <TableHead>Location</TableHead>
                                    <TableHead>Scanned at</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {batchUnits.map((u) => (
                                    <TableRow key={u.id}>
                                      <TableCell className="font-mono text-xs">{u.code}</TableCell>
                                      <TableCell>
                                        <Badge
                                          variant="outline"
                                          className={cn("whitespace-nowrap", UNIT_STATUS[u.status] ?? "")}
                                        >
                                          {titleCase(u.status)}
                                        </Badge>
                                      </TableCell>
                                      <TableCell>{u.scannedByName ?? "—"}</TableCell>
                                      <TableCell className="max-w-32 truncate">{u.location ?? "—"}</TableCell>
                                      <TableCell className="whitespace-nowrap text-xs">
                                        {formatDateTime(u.scannedAt)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </div>
                      ) : null}

                      <div className="mt-auto flex gap-1.5 border-t pt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => printLabels(b)}
                          aria-label={`Print QR labels for ${b.name}`}
                        >
                          <Printer className="size-3.5" /> Print labels
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto"
                          onClick={() => toggleExpand(b)}
                          aria-label={`View units of ${b.name}`}
                        >
                          {batchUnits ? `${batchUnits.length} units` : "View units"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ================= TEMPLATES ================= */}
        <TabsContent value="templates" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{formatNumber(templates.length)} template{templates.length === 1 ? "" : "s"}</Badge>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="icon" onClick={loadTemplates} aria-label="Refresh templates">
                <RefreshCw className="size-4" />
              </Button>
              <Button onClick={openCreateTpl}>
                <Plus className="size-4" /> New template
              </Button>
            </div>
          </div>

          {loadingTemplates ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-52 rounded-xl" />
              ))}
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
              <PackageOpen className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No templates yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Define what goes inside a ration kit — items, quantities and cost per unit.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {templates.map((t) => (
                <Card key={t.id} className="flex flex-col">
                  <CardContent className="flex flex-1 flex-col gap-3 p-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold leading-tight">{t.name}</p>
                        <p className="text-xs font-medium text-emerald-700">
                          {formatINR(t.costPerUnit)} / kit
                        </p>
                      </div>
                    </div>
                    {t.description ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                    ) : null}
                    <div className="rounded-lg border bg-muted/40 p-2.5">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Contents
                      </p>
                      <ul className="space-y-0.5 text-xs">
                        {parseItems(t.items).map((i, idx) => (
                          <li key={`${i.name}-${idx}`} className="flex justify-between gap-2">
                            <span className="truncate">{i.name}</span>
                            <span className="shrink-0 text-muted-foreground">
                              {i.qty} {i.unit}
                            </span>
                          </li>
                        ))}
                        {parseItems(t.items).length === 0 ? (
                          <li className="text-muted-foreground">No items defined</li>
                        ) : null}
                      </ul>
                    </div>
                    <div className="mt-auto flex gap-1.5 border-t pt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditTpl(t)}
                        aria-label={`Edit template ${t.name}`}
                      >
                        <Pencil className="size-3.5" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setTplDeleteTarget(t)}
                        aria-label={`Delete template ${t.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ================= UNIT EXPLORER ================= */}
        <TabsContent value="explorer" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Total {formatNumber(statsChips.total)}</Badge>
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
              Ready {formatNumber(statsChips.ready)}
            </Badge>
            <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-800">
              Scanned {formatNumber(statsChips.scanned)}
            </Badge>
            {statsChips.expired ? (
              <Badge variant="outline" className="border-zinc-200 bg-zinc-100 text-zinc-600">
                Expired {formatNumber(statsChips.expired)}
              </Badge>
            ) : null}
            <Button variant="outline" size="icon" className="ml-auto" onClick={loadExplorer} aria-label="Refresh kit units">
              <RefreshCw className="size-4" />
            </Button>
          </div>

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
                placeholder="Search by kit code…"
                className="pl-8 font-mono"
                aria-label="Search kit units by code"
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
          </form>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by unit status">
            {["all", "READY", "SCANNED", "EXPIRED"].map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={unitStatus === s ? "default" : "outline"}
                className="h-8 rounded-full"
                onClick={() => setUnitStatus(s)}
              >
                {s === "all" ? "All" : titleCase(s)}
              </Button>
            ))}
          </div>

          {loadingUnits ? (
            <Skeleton className="h-72 rounded-lg" />
          ) : units.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
              <QrCode className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No kit units found</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {appliedQ || unitStatus !== "all"
                  ? "Try a different code or status filter."
                  : "Create a batch to generate QR-coded kit units."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kit code</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scanned by</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Scanned at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {units.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-mono text-xs font-semibold">{u.code}</TableCell>
                      <TableCell>{u.batch?.name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("whitespace-nowrap", UNIT_STATUS[u.status] ?? "")}
                        >
                          {titleCase(u.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{u.scannedByName ?? "—"}</TableCell>
                      <TableCell className="max-w-36 truncate">{u.location ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDateTime(u.scannedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ============ CREATE BATCH DIALOG ============ */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create kit batch</DialogTitle>
            <DialogDescription>
              Generates a QR-coded unit for every kit in the batch.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Template *</Label>
              <Select
                value={batchForm.templateId || undefined}
                onValueChange={(v) => setBatchForm({ ...batchForm, templateId: v })}
              >
                <SelectTrigger aria-label="Kit template">
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {formatINR(t.costPerUnit)}/kit
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kb-name">Batch name *</Label>
              <Input
                id="kb-name"
                value={batchForm.name}
                onChange={(e) => setBatchForm({ ...batchForm, name: e.target.value })}
                placeholder="Diwali drive — Nov 2026"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kb-units">Total units</Label>
              <Input
                id="kb-units"
                type="number"
                min={1}
                value={batchForm.totalUnits}
                onChange={(e) => setBatchForm({ ...batchForm, totalUnits: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kb-instructions">Instructions</Label>
              <Textarea
                id="kb-instructions"
                rows={2}
                value={batchForm.instructions}
                onChange={(e) => setBatchForm({ ...batchForm, instructions: e.target.value })}
                placeholder="Distribute at Jayanagar drive, scan QR at handover…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createBatch} disabled={savingBatch}>
              {savingBatch ? "Generating…" : "Create batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ TEMPLATE CREATE / EDIT DIALOG ============ */}
      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTpl ? `Edit ${editingTpl.name}` : "New kit template"}</DialogTitle>
            <DialogDescription>Standard contents and cost for one ration kit.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="kt-name">Template name *</Label>
                <Input
                  id="kt-name"
                  value={tplForm.name}
                  onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })}
                  placeholder="Family ration kit — 1 week"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="kt-cost">Cost per unit (₹)</Label>
                <Input
                  id="kt-cost"
                  type="number"
                  min={0}
                  value={tplForm.costPerUnit}
                  onChange={(e) => setTplForm({ ...tplForm, costPerUnit: e.target.value })}
                  placeholder="850"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kt-desc">Description</Label>
              <Input
                id="kt-desc"
                value={tplForm.description}
                onChange={(e) => setTplForm({ ...tplForm, description: e.target.value })}
                placeholder="Feeds a family of four for a week"
              />
            </div>
            <div className="space-y-2">
              <Label>Items</Label>
              {tplForm.items.map((item, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input
                    value={item.name}
                    onChange={(e) =>
                      setTplForm({
                        ...tplForm,
                        items: tplForm.items.map((it, i) =>
                          i === idx ? { ...it, name: e.target.value } : it
                        ),
                      })
                    }
                    placeholder="Item name (rice, dal…)"
                    aria-label={`Item ${idx + 1} name`}
                  />
                  <Input
                    type="number"
                    min={0}
                    className="w-20 shrink-0"
                    value={item.qty}
                    onChange={(e) =>
                      setTplForm({
                        ...tplForm,
                        items: tplForm.items.map((it, i) =>
                          i === idx ? { ...it, qty: e.target.value } : it
                        ),
                      })
                    }
                    aria-label={`Item ${idx + 1} quantity`}
                  />
                  <Select
                    value={item.unit}
                    onValueChange={(v) =>
                      setTplForm({
                        ...tplForm,
                        items: tplForm.items.map((it, i) => (i === idx ? { ...it, unit: v } : it)),
                      })
                    }
                  >
                    <SelectTrigger className="w-24 shrink-0" aria-label={`Item ${idx + 1} unit`}>
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
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    disabled={tplForm.items.length === 1}
                    onClick={() =>
                      setTplForm({ ...tplForm, items: tplForm.items.filter((_, i) => i !== idx) })
                    }
                    aria-label={`Remove item ${idx + 1}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setTplForm({ ...tplForm, items: [...tplForm.items, { name: "", qty: "1", unit: "kg" }] })
                }
                aria-label="Add item row"
              >
                <Plus className="size-3.5" /> Add item
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTplOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveTemplate} disabled={savingTpl}>
              {savingTpl ? "Saving…" : editingTpl ? "Save changes" : "Create template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ TEMPLATE DELETE CONFIRM ============ */}
      <Dialog open={!!tplDeleteTarget} onOpenChange={(o) => !o && setTplDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete template {tplDeleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              Templates used by existing batches cannot be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTplDeleteTarget(null)}>
              Keep
            </Button>
            <Button variant="destructive" onClick={removeTemplate}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ PRINT-ONLY LABEL SHEET ============ */}
      {printState ? (
        <div id="uar-print-labels" className="hidden print:block">
          <style>
            {`@media print {
              body * { visibility: hidden; }
              #uar-print-labels, #uar-print-labels * { visibility: visible; }
              #uar-print-labels { position: absolute; left: 0; top: 0; width: 100%; background: #ffffff; padding: 12px; }
            }`}
          </style>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {printState.units.map((u) => (
              <div
                key={u.id}
                className="rounded-lg border-2 border-dashed border-zinc-800 p-3 text-center"
              >
                <p className="text-[10px] font-bold tracking-[0.2em]">UNITED ANGEL REACH</p>
                <p className="mt-1 font-mono text-sm font-bold">{u.code}</p>
                <p className="text-[10px] text-zinc-700">{printState.name}</p>
                <p className="mt-1 text-[9px] text-zinc-500">
                  UAR Ration Kit · scan QR at handover to mark issued
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
