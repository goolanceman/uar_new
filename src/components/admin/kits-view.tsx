"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  Copy,
  Package,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { useMasters } from "@/hooks/use-masters";
import { formatDateTime, formatINR, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ---------------------------------- types ---------------------------------- */

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
  _count?: { batches: number };
}

interface KitBatch {
  id: string;
  templateId: string;
  name: string;
  totalUnits: number;
  scannedUnits: number;
  instructions?: string | null;
  status: string;
  template?: { name: string; costPerUnit: number } | null;
}

interface KitUnit {
  id: string;
  batchId: string;
  code: string;
  status: string;
  scannedAt?: string | null;
  scannedByName?: string | null;
  location?: string | null;
}

interface TemplateForm {
  name: string;
  description: string;
  costPerUnit: string;
  items: TplItem[];
}

/* ------------------------------- chip styles ------------------------------- */

const BATCH_STATUS: Record<string, string> = {
  READY: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  IN_PROGRESS: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  DEPLETED: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

const UNIT_STATUS: Record<string, string> = {
  READY: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  SCANNED: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  EXPIRED: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const EMPTY_TPL_FORM: TemplateForm = {
  name: "",
  description: "",
  costPerUnit: "",
  items: [{ name: "", qty: "1", unit: "kg" }],
};

const QR_SHEET_LIMIT = 200;

function parseItems(json: string | null | undefined): TplItem[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { name?: string; qty?: number | string; unit?: string }[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((i) => ({
      name: String(i?.name ?? ""),
      qty: String(i?.qty ?? ""),
      unit: String(i?.unit ?? "pcs"),
    }));
  } catch {
    return [];
  }
}

/* ---------------------------------- view ----------------------------------- */

export default function KitsView() {
  const [templates, setTemplates] = useState<KitTemplate[]>([]);
  const [batches, setBatches] = useState<KitBatch[]>([]);
  const [loading, setLoading] = useState(true);

  /* template dialog */
  const [tplDialog, setTplDialog] = useState(false);
  const [editingTpl, setEditingTpl] = useState<KitTemplate | null>(null);
  const [tplForm, setTplForm] = useState<TemplateForm>(EMPTY_TPL_FORM);
  const [savingTpl, setSavingTpl] = useState(false);
  const [deleteTpl, setDeleteTpl] = useState<KitTemplate | null>(null);

  /* batch wizard */
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardTemplateId, setWizardTemplateId] = useState("");
  const [wizardName, setWizardName] = useState("");
  const [wizardUnits, setWizardUnits] = useState("25");
  const [wizardInstructions, setWizardInstructions] = useState("");
  const [savingBatch, setSavingBatch] = useState(false);
  const [deleteBatch, setDeleteBatch] = useState<KitBatch | null>(null);

  /* batch detail sheet */
  const [sheet, setSheet] = useState<KitBatch | null>(null);
  const [units, setUnits] = useState<KitUnit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitStatus, setUnitStatus] = useState("ALL");
  const [unitSearch, setUnitSearch] = useState("");

  /* QR label dialog */
  const [qrOpen, setQrOpen] = useState(false);
  const [qrLabels, setQrLabels] = useState<{ code: string; dataUrl: string }[]>([]);
  const [qrLoading, setQrLoading] = useState(false);

  const unitOptions = useMasters("UNIT");

  const load = useCallback(async () => {
    try {
      const [tpl, bat] = await Promise.all([get<KitTemplate[]>("/api/kit-templates"), get<KitBatch[]>("/api/kit-batches")]);
      setTemplates(Array.isArray(tpl) ? tpl : []);
      setBatches(Array.isArray(bat) ? bat : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load kits data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    const totalUnits = batches.reduce((s, b) => s + (b.totalUnits ?? 0), 0);
    const scanned = batches.reduce((s, b) => s + (b.scannedUnits ?? 0), 0);
    return { totalUnits, scanned, batches: batches.length, templates: templates.length };
  }, [batches, templates]);

  /* ---------------------------- template actions ---------------------------- */

  const openTplCreate = () => {
    setEditingTpl(null);
    setTplForm(EMPTY_TPL_FORM);
    setTplDialog(true);
  };

  const openTplEdit = (t: KitTemplate) => {
    setEditingTpl(t);
    setTplForm({
      name: t.name ?? "",
      description: t.description ?? "",
      costPerUnit: String(t.costPerUnit ?? ""),
      items: parseItems(t.items).length ? parseItems(t.items) : [{ name: "", qty: "1", unit: "kg" }],
    });
    setTplDialog(true);
  };

  const computedCost = useMemo(() => {
    const qty = tplForm.items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
    return { qty, perUnit: Number(tplForm.costPerUnit) || 0 };
  }, [tplForm]);

  const saveTpl = async () => {
    if (!tplForm.name.trim()) return toast.error("Template name is required");
    const items = tplForm.items.filter((i) => i.name.trim());
    if (items.length === 0) return toast.error("Add at least one item with a name");
    setSavingTpl(true);
    try {
      const body = {
        name: tplForm.name.trim(),
        description: tplForm.description.trim() || undefined,
        items: items.map((i) => ({ name: i.name.trim(), qty: Number(i.qty) || 1, unit: i.unit })),
        costPerUnit: Number(tplForm.costPerUnit) || 0,
      };
      if (editingTpl) {
        await patch(`/api/kit-templates/${editingTpl.id}`, body);
        toast.success(`Template "${body.name}" updated`);
      } else {
        await post("/api/kit-templates", body);
        toast.success(`Template "${body.name}" created`);
      }
      setTplDialog(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingTpl(false);
    }
  };

  const removeTpl = async () => {
    if (!deleteTpl) return;
    try {
      await del(`/api/kit-templates/${deleteTpl.id}`);
      toast.success(`Template "${deleteTpl.name}" deleted`);
      setDeleteTpl(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  /* ------------------------------ batch wizard ------------------------------ */

  const openWizard = () => {
    setWizardStep(1);
    setWizardTemplateId("");
    setWizardName("");
    setWizardUnits("25");
    setWizardInstructions("");
    setWizardOpen(true);
  };

  const createBatch = async () => {
    if (!wizardTemplateId) return toast.error("Pick a template first");
    if (!wizardName.trim()) return toast.error("Give the batch a name");
    const units = Math.trunc(Number(wizardUnits));
    if (!Number.isFinite(units) || units < 1 || units > 500) {
      toast.error("Total units must be between 1 and 500");
      return;
    }
    setSavingBatch(true);
    try {
      await post("/api/kit-batches", {
        templateId: wizardTemplateId,
        name: wizardName.trim(),
        totalUnits: units,
        instructions: wizardInstructions.trim() || undefined,
      });
      toast.success(`Batch "${wizardName.trim()}" created with ${units} QR-coded units`);
      setWizardOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Batch creation failed");
    } finally {
      setSavingBatch(false);
    }
  };

  const removeBatch = async () => {
    if (!deleteBatch) return;
    try {
      await del(`/api/kit-batches/${deleteBatch.id}`);
      toast.success(`Batch "${deleteBatch.name}" deleted`);
      setDeleteBatch(null);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  /* ------------------------------ unit sheet -------------------------------- */

  const openSheet = (b: KitBatch) => {
    setSheet(b);
    setUnitStatus("ALL");
    setUnitSearch("");
    setUnitsLoading(true);
    get<KitUnit[]>(`/api/kit-units?batchId=${b.id}&limit=500`)
      .then((rows) => setUnits(Array.isArray(rows) ? rows : []))
      .catch((e) => {
        setUnits([]);
        toast.error(e instanceof Error ? e.message : "Failed to load units");
      })
      .finally(() => setUnitsLoading(false));
  };

  const filteredUnits = useMemo(() => {
    const q = unitSearch.trim().toUpperCase();
    return units.filter((u) => {
      if (unitStatus !== "ALL" && u.status !== unitStatus) return false;
      if (q && !u.code.includes(q)) return false;
      return true;
    });
  }, [units, unitStatus, unitSearch]);

  const readyUnits = useMemo(() => units.filter((u) => u.status === "READY"), [units]);

  /* ------------------------------ QR printing ------------------------------- */

  useEffect(() => {
    if (!qrOpen) return;
    let alive = true;
    const run = async () => {
      setQrLoading(true);
      const picked = readyUnits.slice(0, QR_SHEET_LIMIT);
      const out: { code: string; dataUrl: string }[] = [];
      for (const u of picked) {
        try {
          const dataUrl = await QRCode.toDataURL(u.code, { margin: 1, width: 140 });
          out.push({ code: u.code, dataUrl });
        } catch {
          // skip a unit whose QR fails to render
        }
      }
      if (alive) {
        setQrLabels(out);
        setQrLoading(false);
      }
    };
    run();
    return () => {
      alive = false;
    };
  }, [qrOpen, readyUnits]);

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ration Kits"
        description="Kit templates, QR-coded batches and distribution tracking."
        icon={<ClipboardList className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={load} aria-label="Refresh kits">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
            <Button onClick={openWizard}>
              <Plus className="size-4" aria-hidden="true" /> New batch
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Templates" value={totals.templates} accent="emerald" icon={<ClipboardList className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Batches" value={totals.batches} accent="teal" icon={<Package className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Units assembled" value={totals.totalUnits.toLocaleString("en-IN")} accent="amber" icon={<Package className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Units scanned" value={totals.scanned.toLocaleString("en-IN")} accent="lime" icon={<QrCode className="size-5" aria-hidden="true" />} loading={loading} hint="At beneficiary hand-off" />
      </div>

      <Tabs defaultValue="batches">
        <TabsList>
          <TabsTrigger value="batches">Batches ({batches.length})</TabsTrigger>
          <TabsTrigger value="templates">Templates ({templates.length})</TabsTrigger>
        </TabsList>

        {/* ============================== BATCHES ============================== */}
        <TabsContent value="batches" className="mt-4">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-56 rounded-xl" />
              ))}
            </div>
          ) : batches.length === 0 ? (
            <EmptyState
              icon={<Package className="size-8" aria-hidden="true" />}
              title="No batches yet"
              hint="Run the wizard to assemble a batch of QR-coded ration kits from a template."
            >
              <Button onClick={openWizard}>
                <Plus className="size-4" aria-hidden="true" /> New batch
              </Button>
            </EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {batches.map((b) => {
                const pct =
                  b.totalUnits > 0 ? Math.min(100, Math.round(((b.scannedUnits ?? 0) / b.totalUnits) * 100)) : 0;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => openSheet(b)}
                    aria-label={`Open batch ${b.name}`}
                    className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-emerald-500/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold leading-tight">{b.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{b.template?.name ?? "Template"}</p>
                      </div>
                      <Badge variant="outline" className={cn("shrink-0", BATCH_STATUS[b.status] ?? "")}>
                        {titleCase(b.status)}
                      </Badge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          {b.scannedUnits ?? 0} / {b.totalUnits} scanned
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-2 [&>div]:bg-emerald-600" aria-label={`${pct}% scanned`} />
                    </div>
                    {b.instructions ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{b.instructions}</p>
                    ) : null}
                    <p className="mt-auto text-xs text-muted-foreground">
                      ~{formatINR((b.template?.costPerUnit ?? 0) * b.totalUnits)} of kit value
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ============================= TEMPLATES ============================= */}
        <TabsContent value="templates" className="mt-4">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-56 rounded-xl" />
              ))}
            </div>
          ) : templates.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="size-8" aria-hidden="true" />}
              title="No kit templates yet"
              hint="Define what goes into a standard ration kit — items, quantities and cost."
            >
              <Button onClick={openTplCreate}>
                <Plus className="size-4" aria-hidden="true" /> New template
              </Button>
            </EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {templates.map((t) => {
                const items = parseItems(t.items);
                return (
                  <div key={t.id} className="flex flex-col rounded-xl border bg-card p-4 shadow-sm">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold leading-tight">{t.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {items.length} item{items.length === 1 ? "" : "s"} · {formatINR(t.costPerUnit)} per kit
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {t._count?.batches ?? 0} batch{(t._count?.batches ?? 0) === 1 ? "" : "es"}
                      </Badge>
                    </div>
                    {t.description ? (
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                    ) : null}
                    <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto pr-1 text-xs scrollbar-thin">
                      {items.map((i, idx) => (
                        <li key={idx} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                          <span className="min-w-0 truncate">{i.name}</span>
                          <span className="shrink-0 font-medium text-muted-foreground">
                            {i.qty} {i.unit}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto flex gap-1.5 border-t pt-3">
                      <Button variant="outline" size="sm" onClick={() => openTplEdit(t)} aria-label={`Edit ${t.name}`}>
                        <Pencil className="size-3.5" aria-hidden="true" /> Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto text-red-600 hover:bg-red-500/10 dark:text-red-400"
                        onClick={() => setDeleteTpl(t)}
                        aria-label={`Delete ${t.name}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ============================== BATCH SHEET ============================== */}
      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg">
          {sheet && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle className="flex items-center gap-2">
                  {sheet.name}
                  <Badge variant="outline" className={cn("ml-auto", BATCH_STATUS[sheet.status] ?? "")}>
                    {titleCase(sheet.status)}
                  </Badge>
                </SheetTitle>
                <SheetDescription>
                  {sheet.template?.name ?? "Template"} · {formatINR(sheet.template?.costPerUnit ?? 0)} per kit
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  Remaining: {Math.max(0, sheet.totalUnits - (sheet.scannedUnits ?? 0))} units
                </Badge>
                <Badge variant="outline">{sheet.totalUnits} total</Badge>
                <Badge variant="outline">{sheet.scannedUnits ?? 0} scanned</Badge>
                <Button size="sm" className="ml-auto" onClick={() => setQrOpen(true)} disabled={readyUnits.length === 0}>
                  <Printer className="size-3.5" aria-hidden="true" /> Print QR labels
                </Button>
              </div>

              {sheet.instructions ? (
                <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                  <strong className="text-foreground">Instructions:</strong> {sheet.instructions}
                </div>
              ) : null}

              {/* unit filters */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={unitStatus} onValueChange={setUnitStatus}>
                  <SelectTrigger className="w-full sm:w-36" aria-label="Filter units by status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All statuses</SelectItem>
                    <SelectItem value="READY">Ready</SelectItem>
                    <SelectItem value="SCANNED">Scanned</SelectItem>
                    <SelectItem value="EXPIRED">Expired</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={unitSearch}
                  onChange={(e) => setUnitSearch(e.target.value)}
                  placeholder="Search code…"
                  aria-label="Search unit code"
                />
              </div>

              {unitsLoading ? (
                <div className="space-y-2" aria-busy="true">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 rounded-lg" />
                  ))}
                </div>
              ) : filteredUnits.length === 0 ? (
                <EmptyState
                  icon={<QrCode className="size-6" aria-hidden="true" />}
                  title="No units match"
                  hint="Adjust the status filter or search term."
                />
              ) : (
                <div className="max-h-[420px] overflow-y-auto rounded-lg border scrollbar-thin">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Scanned</TableHead>
                        <TableHead>Location</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUnits.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell>
                            <button
                              type="button"
                              className="flex items-center gap-1 font-mono text-xs hover:text-primary"
                              onClick={() => {
                                navigator.clipboard?.writeText(u.code).then(
                                  () => toast.success(`${u.code} copied`),
                                  () => toast.error("Copy failed")
                                );
                              }}
                              aria-label={`Copy ${u.code}`}
                            >
                              {u.code}
                              <Copy className="size-3 opacity-60" aria-hidden="true" />
                            </button>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn(UNIT_STATUS[u.status] ?? "")}>
                              {titleCase(u.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {u.scannedAt ? (
                              <>
                                {formatDateTime(u.scannedAt)}
                                {u.scannedByName ? (
                                  <span className="block text-muted-foreground">by {u.scannedByName}</span>
                                ) : null}
                              </>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{u.location || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="flex gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDeleteBatch(sheet);
                  }}
                  className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  aria-label={`Delete batch ${sheet.name}`}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> Delete batch
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============================ QR LABEL DIALOG ============================ */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>QR labels — {sheet?.name}</DialogTitle>
            <DialogDescription>
              Print-ready label sheet for READY units. Scan a code at hand-off to mark the kit distributed.
            </DialogDescription>
          </DialogHeader>

          {qrLoading ? (
            <div className="grid place-items-center gap-3 py-10" aria-busy="true">
              <Skeleton className="size-16 rounded-xl" />
              <p className="text-sm text-muted-foreground">Generating QR codes…</p>
            </div>
          ) : qrLabels.length === 0 ? (
            <EmptyState
              icon={<QrCode className="size-6" aria-hidden="true" />}
              title="No READY units to print"
              hint="Labels are generated for units that have not been scanned yet."
            />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{qrLabels.length} labels</Badge>
                {readyUnits.length > QR_SHEET_LIMIT && (
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                    Limited to {QR_SHEET_LIMIT} per sheet — print again for the rest
                  </Badge>
                )}
                <Button size="sm" className="ml-auto" onClick={() => window.print()} aria-label="Print labels">
                  <Printer className="size-3.5" aria-hidden="true" /> Print
                </Button>
              </div>
              <div className="print-sheet grid grid-cols-3 gap-3 sm:grid-cols-4">
                {qrLabels.map((l) => (
                  <div
                    key={l.code}
                    className="flex flex-col items-center gap-1 rounded-lg border border-dashed p-2 text-center"
                  >
                    <img src={l.dataUrl} alt={`QR code for kit unit ${l.code}`} className="size-[100px]" />
                    <span className="font-mono text-[10px] font-semibold leading-tight">{l.code}</span>
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground">UAR Ration Kit</span>
                    <span className="w-full truncate text-[9px] text-muted-foreground">{sheet?.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* =========================== BATCH WIZARD =========================== */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New batch — step {wizardStep} of 3</DialogTitle>
            <DialogDescription>
              {wizardStep === 1 && "Pick the kit template to assemble."}
              {wizardStep === 2 && "Name the batch and set how many units to produce."}
              {wizardStep === 3 && "Optional handling instructions, then create the batch."}
            </DialogDescription>
          </DialogHeader>

          {wizardStep === 1 && (
            <div className="grid gap-2">
              {templates.length === 0 ? (
                <EmptyState
                  icon={<ClipboardList className="size-6" aria-hidden="true" />}
                  title="No templates yet"
                  hint="Create a kit template first."
                />
              ) : (
                templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setWizardTemplateId(t.id);
                      setWizardStep(2);
                    }}
                    aria-label={`Use template ${t.name}`}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-3 text-left transition hover:border-emerald-500/40 hover:bg-accent",
                      wizardTemplateId === t.id && "border-emerald-500/50 bg-emerald-500/10"
                    )}
                  >
                    <Package className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatINR(t.costPerUnit)} per kit · {parseItems(t.items).length} items
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                ))
              )}
            </div>
          )}

          {wizardStep === 2 && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="wz-name">Batch name *</Label>
                <Input
                  id="wz-name"
                  value={wizardName}
                  onChange={(e) => setWizardName(e.target.value)}
                  placeholder="Diwali drive — Nov 2026"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="wz-units">Total units (1–500) *</Label>
                <Input
                  id="wz-units"
                  type="number"
                  min={1}
                  max={500}
                  value={wizardUnits}
                  onChange={(e) => setWizardUnits(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Each unit gets a unique QR code (UAR-RK-YYYY-NNNNNN) generated by the server.
                </p>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="wz-instructions">Instructions (optional)</Label>
                <Textarea
                  id="wz-instructions"
                  rows={3}
                  value={wizardInstructions}
                  onChange={(e) => setWizardInstructions(e.target.value)}
                  placeholder="Pack 5 kg rice first, then dal; label facing outward…"
                />
              </div>
              <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Summary</p>
                <p className="mt-1">
                  Template: {templates.find((t) => t.id === wizardTemplateId)?.name ?? "—"} · Units:{" "}
                  {wizardUnits} · Est. value:{" "}
                  {formatINR(
                    (templates.find((t) => t.id === wizardTemplateId)?.costPerUnit ?? 0) *
                      (Number(wizardUnits) || 0)
                  )}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            {wizardStep > 1 && (
              <Button variant="outline" onClick={() => setWizardStep((s) => s - 1)}>
                <ArrowLeft className="size-4" aria-hidden="true" /> Back
              </Button>
            )}
            <Button variant="outline" onClick={() => setWizardOpen(false)}>
              Cancel
            </Button>
            {wizardStep < 3 ? (
              <Button
                onClick={() => setWizardStep((s) => s + 1)}
                disabled={wizardStep === 2 && !wizardName.trim()}
              >
                Next
              </Button>
            ) : (
              <Button onClick={createBatch} disabled={savingBatch}>
                {savingBatch ? "Creating…" : "Create batch"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================ TEMPLATE DIALOG ============================ */}
      <Dialog open={tplDialog} onOpenChange={setTplDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTpl ? `Edit ${editingTpl.name}` : "New kit template"}</DialogTitle>
            <DialogDescription>
              Standard contents of one ration kit. Batches assemble units from a template.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="tpl-name">Template name *</Label>
              <Input
                id="tpl-name"
                value={tplForm.name}
                onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })}
                placeholder="Standard family kit"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tpl-desc">Description</Label>
              <Input
                id="tpl-desc"
                value={tplForm.description}
                onChange={(e) => setTplForm({ ...tplForm, description: e.target.value })}
                placeholder="Feeds a family of four for two weeks"
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Items</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setTplForm((f) => ({ ...f, items: [...f.items, { name: "", qty: "1", unit: "kg" }] }))
                  }
                  aria-label="Add item row"
                >
                  <Plus className="size-3.5" aria-hidden="true" /> Add item
                </Button>
              </div>
              <div className="space-y-2">
                {tplForm.items.map((item, i) => (
                  <div key={i} className="grid grid-cols-[1fr_64px_88px_36px] items-center gap-2">
                    <Input
                      value={item.name}
                      onChange={(e) =>
                        setTplForm((f) => ({
                          ...f,
                          items: f.items.map((it, j) => (j === i ? { ...it, name: e.target.value } : it)),
                        }))
                      }
                      placeholder="Rice"
                      aria-label={`Item ${i + 1} name`}
                    />
                    <Input
                      type="number"
                      min={0}
                      value={item.qty}
                      onChange={(e) =>
                        setTplForm((f) => ({
                          ...f,
                          items: f.items.map((it, j) => (j === i ? { ...it, qty: e.target.value } : it)),
                        }))
                      }
                      aria-label={`Item ${i + 1} quantity`}
                    />
                    <Select
                      value={item.unit}
                      onValueChange={(v) =>
                        setTplForm((f) => ({
                          ...f,
                          items: f.items.map((it, j) => (j === i ? { ...it, unit: v } : it)),
                        }))
                      }
                    >
                      <SelectTrigger aria-label={`Item ${i + 1} unit`}>
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
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setTplForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))
                      }
                      aria-label={`Remove item ${i + 1}`}
                      disabled={tplForm.items.length <= 1}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {computedCost.qty} total units across items · cost per kit entered below.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tpl-cost">Cost per unit (₹) *</Label>
              <Input
                id="tpl-cost"
                type="number"
                min={0}
                value={tplForm.costPerUnit}
                onChange={(e) => setTplForm({ ...tplForm, costPerUnit: e.target.value })}
                placeholder="950"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTplDialog(false)}>
              Cancel
            </Button>
            <Button onClick={saveTpl} disabled={savingTpl}>
              {savingTpl ? "Saving…" : editingTpl ? "Save changes" : "Create template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =========================== DELETE CONFIRMS =========================== */}
      <AlertDialog open={!!deleteTpl} onOpenChange={(o) => !o && setDeleteTpl(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template “{deleteTpl?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Templates with existing batches cannot be deleted — the server will block it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep template</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                removeTpl();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteBatch} onOpenChange={(o) => !o && setDeleteBatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete batch “{deleteBatch?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              All {deleteBatch?.totalUnits} QR-coded units are removed with the batch. Volunteers
              will no longer be able to scan its codes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep batch</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                removeBatch();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
