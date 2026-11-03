"use client";

/**
 * Aid & Distribution Kits — admin module.
 * Kind-tagged kit templates (RATION / FOOD / EDUCATION / …) → QR-coded
 * batches → per-unit scan tracking with printable label sheets.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  BookOpen,
  ClipboardList,
  Copy,
  Droplets,
  Package,
  PackagePlus,
  Pencil,
  Pill,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Shirt,
  Siren,
  Trash2,
  UtensilsCrossed,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { useMasters } from "@/hooks/use-masters";
import { formatDateTime, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  Field,
  FieldGrid,
  FormSection,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { CsvColumn, ExportMenu } from "@/components/shared/csv";
import {
  DataViewMode,
  useViewPref,
  ViewSwitcher,
} from "@/components/shared/view-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  kind?: string | null;
  codePrefix?: string | null;
  image?: string | null;
  status?: string | null;
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

type KitKind =
  | "RATION"
  | "FOOD"
  | "EDUCATION"
  | "MEDICAL"
  | "HYGIENE"
  | "CLOTHING"
  | "EMERGENCY"
  | "CUSTOM";

interface TemplateForm {
  name: string;
  kind: KitKind;
  description: string;
  codePrefix: string;
  image: string;
  status: "ACTIVE" | "RETIRED";
  costPerUnit: string;
  items: TplItem[];
}

/* ------------------------------ kind metadata ------------------------------ */

const KINDS: KitKind[] = [
  "RATION",
  "FOOD",
  "EDUCATION",
  "MEDICAL",
  "HYGIENE",
  "CLOTHING",
  "EMERGENCY",
  "CUSTOM",
];

const KIND_META: Record<
  KitKind,
  { label: string; icon: LucideIcon; chip: string; iconCls: string; prefix: string }
> = {
  RATION: {
    label: "Ration",
    icon: Wheat,
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    iconCls: "text-emerald-600 dark:text-emerald-400",
    prefix: "UAR-RK",
  },
  FOOD: {
    label: "Food",
    icon: UtensilsCrossed,
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    iconCls: "text-amber-600 dark:text-amber-400",
    prefix: "UAR-FD",
  },
  EDUCATION: {
    label: "Education",
    icon: BookOpen,
    chip: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
    iconCls: "text-orange-600 dark:text-orange-400",
    prefix: "UAR-ED",
  },
  MEDICAL: {
    label: "Medical",
    icon: Pill,
    chip: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
    iconCls: "text-teal-600 dark:text-teal-400",
    prefix: "UAR-MD",
  },
  HYGIENE: {
    label: "Hygiene",
    icon: Droplets,
    chip: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
    iconCls: "text-cyan-600 dark:text-cyan-400",
    prefix: "UAR-HY",
  },
  CLOTHING: {
    label: "Clothing",
    icon: Shirt,
    chip: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
    iconCls: "text-fuchsia-600 dark:text-fuchsia-400",
    prefix: "UAR-CL",
  },
  EMERGENCY: {
    label: "Emergency",
    icon: Siren,
    chip: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
    iconCls: "text-red-600 dark:text-red-400",
    prefix: "UAR-EM",
  },
  CUSTOM: {
    label: "Custom",
    icon: Package,
    chip: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
    iconCls: "text-zinc-600 dark:text-zinc-400",
    prefix: "UAR-CT",
  },
};

function kindMeta(kind?: string | null) {
  const k = (kind ?? "").toUpperCase() as KitKind;
  return KIND_META[k] ?? KIND_META.CUSTOM;
}

function prefixFor(t: { kind?: string | null; codePrefix?: string | null }): string {
  const p = (t.codePrefix ?? "").trim();
  if (p) return p;
  const k = (t.kind ?? "").toUpperCase() as KitKind;
  return KIND_META[k]?.prefix ?? "UAR-RK";
}

/* --------------------------------- helpers --------------------------------- */

const EMPTY_TPL_FORM: TemplateForm = {
  name: "",
  kind: "RATION",
  description: "",
  codePrefix: "",
  image: "",
  status: "ACTIVE",
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

  /* template form sheet */
  const [tplSheetOpen, setTplSheetOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<KitTemplate | null>(null);
  const [tplForm, setTplForm] = useState<TemplateForm>(EMPTY_TPL_FORM);
  const [tplTouched, setTplTouched] = useState(false);
  const [savingTpl, setSavingTpl] = useState(false);
  const [deleteTpl, setDeleteTpl] = useState<KitTemplate | null>(null);

  /* batch wizard (FormSheet, 2 steps) */
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
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

  /* templates view preference */
  const [view, setView] = useViewPref("kit-templates");

  const unitOptions = useMasters("UNIT");

  const load = useCallback(async () => {
    try {
      const [tpl, bat] = await Promise.all([
        get<KitTemplate[]>("/api/kit-templates"),
        get<KitBatch[]>("/api/kit-batches"),
      ]);
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

  const tplMap = useMemo(() => {
    const m = new Map<string, KitTemplate>();
    templates.forEach((t) => m.set(t.id, t));
    return m;
  }, [templates]);

  const totals = useMemo(() => {
    const totalUnits = batches.reduce((s, b) => s + (b.totalUnits ?? 0), 0);
    const scanned = batches.reduce((s, b) => s + (b.scannedUnits ?? 0), 0);
    return { totalUnits, scanned, batches: batches.length, templates: templates.length };
  }, [batches, templates]);

  /* ---------------------------- template actions ---------------------------- */

  const setTpl = (p: Partial<TemplateForm>) => {
    setTplForm((f) => ({ ...f, ...p }));
    setTplTouched(true);
  };

  const openTplCreate = () => {
    setEditingTpl(null);
    setTplForm(EMPTY_TPL_FORM);
    setTplTouched(false);
    setTplSheetOpen(true);
  };

  const openTplEdit = (t: KitTemplate) => {
    setEditingTpl(t);
    const items = parseItems(t.items);
    setTplForm({
      name: t.name ?? "",
      kind: ((t.kind ?? "").toUpperCase() as KitKind) in KIND_META
        ? ((t.kind ?? "").toUpperCase() as KitKind)
        : "CUSTOM",
      description: t.description ?? "",
      codePrefix: t.codePrefix ?? "",
      image: t.image ?? "",
      status: t.status === "RETIRED" ? "RETIRED" : "ACTIVE",
      costPerUnit: String(t.costPerUnit ?? ""),
      items: items.length ? items : [{ name: "", qty: "1", unit: "kg" }],
    });
    setTplTouched(false);
    setTplSheetOpen(true);
  };

  const effPrefix = prefixFor(tplForm);
  const prefixPreview = `${effPrefix}-${new Date().getFullYear()}-000001`;

  const saveTpl = async () => {
    if (!tplForm.name.trim()) {
      toast.error("Template name is required");
      return;
    }
    const items = tplForm.items.filter((i) => i.name.trim());
    if (items.length === 0) {
      toast.error("Add at least one item with a name");
      return;
    }
    setSavingTpl(true);
    try {
      const body = {
        name: tplForm.name.trim(),
        kind: tplForm.kind,
        codePrefix: tplForm.codePrefix.trim() || undefined,
        image: tplForm.image.trim() || undefined,
        status: tplForm.status,
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
      setTplSheetOpen(false);
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

  const openWizardFromTpl = (t: KitTemplate) => {
    if (t.status === "RETIRED") {
      toast.error("Retired templates can't start batches — set the template back to Active first.");
      return;
    }
    setWizardStep(2);
    setWizardTemplateId(t.id);
    setWizardName("");
    setWizardUnits("25");
    setWizardInstructions("");
    setWizardOpen(true);
  };

  const wizardTouched =
    wizardStep === 2 &&
    (wizardName.trim() !== "" ||
      wizardInstructions.trim() !== "" ||
      wizardUnits !== "25");

  const wizardSubmit = async () => {
    if (wizardStep === 1) {
      if (!wizardTemplateId) {
        toast.error("Pick a template to continue");
        return;
      }
      setWizardStep(2);
      return;
    }
    await createBatch();
  };

  const createBatch = async () => {
    if (!wizardTemplateId) {
      toast.error("Pick a template first");
      return;
    }
    if (!wizardName.trim()) {
      toast.error("Give the batch a name");
      return;
    }
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

  const sheetKind = kindMeta(tplMap.get(sheet?.templateId ?? "")?.kind);

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

  /* ------------------------------ CSV (templates) --------------------------- */

  const tplCsv: CsvColumn<KitTemplate>[] = useMemo(
    () => [
      { header: "Name", value: (t) => t.name },
      { header: "Kind", value: (t) => kindMeta(t.kind).label },
      { header: "Status", value: (t) => t.status ?? "ACTIVE" },
      { header: "Items", value: (t) => parseItems(t.items).length },
      { header: "Cost per unit (INR)", value: (t) => t.costPerUnit },
      { header: "Batches", value: (t) => t._count?.batches ?? 0 },
      { header: "Code prefix", value: (t) => prefixFor(t) },
      { header: "Description", value: (t) => t.description ?? "" },
    ],
    []
  );

  /* ------------------------------ templates views --------------------------- */

  const tplActions = (t: KitTemplate) => (
    <div className="flex shrink-0 gap-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          openWizardFromTpl(t);
        }}
        disabled={t.status === "RETIRED"}
        title={t.status === "RETIRED" ? "Retired — templates must be Active to start batches" : undefined}
        aria-label={`Start batch from ${t.name}`}
      >
        <PackagePlus className="size-3.5" aria-hidden="true" /> Use
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={(e) => {
          e.stopPropagation();
          openTplEdit(t);
        }}
        aria-label={`Edit ${t.name}`}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8 text-red-600 hover:bg-red-500/10 dark:text-red-400"
        onClick={(e) => {
          e.stopPropagation();
          setDeleteTpl(t);
        }}
        aria-label={`Delete ${t.name}`}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aid & Distribution Kits"
        description="Kind-tagged kit templates, QR-coded batches and distribution tracking."
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
              hint="Run the wizard to assemble a batch of QR-coded aid kits from a template."
            >
              <Button onClick={openWizard}>
                <Plus className="size-4" aria-hidden="true" /> New batch
              </Button>
            </EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {batches.map((b) => {
                const tpl = tplMap.get(b.templateId);
                const km = kindMeta(tpl?.kind);
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
                      <StatusBadge status={b.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={cn(km.chip)}>
                        <km.icon className="size-3" aria-hidden="true" />
                        {km.label} kit
                      </Badge>
                      <Badge variant="outline">
                        {b.scannedUnits ?? 0}/{b.totalUnits} scanned
                      </Badge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Scan progress</span>
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
        <TabsContent value="templates" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm text-muted-foreground">
              {templates.length} template{templates.length === 1 ? "" : "s"}
            </p>
            <ExportMenu columns={tplCsv} rows={templates} filename="uar-kit-templates" disabled={templates.length === 0} />
            <ViewSwitcher value={view} onChange={setView} />
            <Button size="sm" onClick={openTplCreate}>
              <Plus className="size-4" aria-hidden="true" /> New template
            </Button>
          </div>

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
              hint="Define what goes into a standard kit — items, quantities, kind and cost."
            >
              <Button onClick={openTplCreate}>
                <Plus className="size-4" aria-hidden="true" /> New template
              </Button>
            </EmptyState>
          ) : view === "table" ? (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Cost / unit</TableHead>
                    <TableHead className="text-right">Batches</TableHead>
                    <TableHead>Codes</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t) => {
                    const km = kindMeta(t.kind);
                    return (
                      <TableRow key={t.id}>
                        <TableCell>
                          <p className="font-medium">{t.name}</p>
                          {t.description ? (
                            <p className="max-w-56 truncate text-xs text-muted-foreground">{t.description}</p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(km.chip)}>
                            <km.icon className="size-3" aria-hidden="true" />
                            {km.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{parseItems(t.items).length}</TableCell>
                        <TableCell className="text-right">{formatINR(t.costPerUnit)}</TableCell>
                        <TableCell className="text-right">{t._count?.batches ?? 0}</TableCell>
                        <TableCell className="font-mono text-xs">{prefixFor(t)}</TableCell>
                        <TableCell>
                          <StatusBadge status={t.status ?? "ACTIVE"} />
                        </TableCell>
                        <TableCell className="text-right">{tplActions(t)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : view === "list" ? (
            <div className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin" role="list" aria-label="Kit templates">
              {templates.map((t) => {
                const km = kindMeta(t.kind);
                const items = parseItems(t.items);
                return (
                  <div key={t.id} className="flex items-center gap-3 rounded-lg border p-3" role="listitem">
                    <span
                      aria-hidden="true"
                      className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted", km.iconCls)}
                    >
                      <km.icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {items.length} item{items.length === 1 ? "" : "s"} · {formatINR(t.costPerUnit)} per kit ·{" "}
                        {t._count?.batches ?? 0} batch{(t._count?.batches ?? 0) === 1 ? "" : "es"}
                      </p>
                    </div>
                    <StatusBadge status={t.status ?? "ACTIVE"} className="hidden sm:inline-flex" />
                    {tplActions(t)}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {templates.map((t) => {
                const km = kindMeta(t.kind);
                const items = parseItems(t.items);
                const retired = t.status === "RETIRED";
                return (
                  <div key={t.id} className={cn("flex flex-col rounded-xl border bg-card p-4 shadow-sm", retired && "opacity-80")}>
                    {t.image ? (
                      <img
                        src={t.image}
                        alt={`${t.name} cover`}
                        loading="lazy"
                        className="mb-3 h-24 w-full rounded-lg border object-cover"
                      />
                    ) : null}
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
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={cn(km.chip)}>
                        <km.icon className="size-3" aria-hidden="true" />
                        {km.label}
                      </Badge>
                      <StatusBadge status={t.status ?? "ACTIVE"} />
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {prefixFor(t)}-YYYY-NNNNNN
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
                    {retired ? (
                      <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                        Retired — restore to Active before starting batches.
                      </p>
                    ) : null}
                    <div className="mt-auto flex gap-1.5 border-t pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openWizardFromTpl(t)}
                        disabled={retired}
                        title={retired ? "Retired — templates must be Active to start batches" : undefined}
                        aria-label={`Start batch from ${t.name}`}
                      >
                        <PackagePlus className="size-3.5" aria-hidden="true" /> Use
                      </Button>
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
                  <StatusBadge status={sheet.status} className="ml-auto" />
                </SheetTitle>
                <SheetDescription>
                  {sheet.template?.name ?? "Template"} · {sheetKind.label} kit ·{" "}
                  {formatINR(sheet.template?.costPerUnit ?? 0)} per unit
                </SheetDescription>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <DataField label="Total units" value={String(sheet.totalUnits)} />
                <DataField label="Scanned" value={String(sheet.scannedUnits ?? 0)} />
                <DataField label="Remaining" value={String(Math.max(0, sheet.totalUnits - (sheet.scannedUnits ?? 0)))} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn(sheetKind.chip)}>
                  <sheetKind.icon className="size-3" aria-hidden="true" />
                  {sheetKind.label} kit
                </Badge>
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={() => setQrOpen(true)}
                  disabled={readyUnits.length === 0}
                >
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
                            <StatusBadge status={u.status} />
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
                  onClick={() => setDeleteBatch(sheet)}
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
              {sheet
                ? `Scan unit — ${sheetKind.label.toUpperCase()} kit batch #${sheet.name}. `
                : ""}
              Print-ready labels for READY units; scanning at hand-off marks the unit distributed.
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
              <div className="flex flex-wrap items-center gap-2">
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
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                      UAR {sheetKind.label} Kit
                    </span>
                    <span className="w-full truncate text-[9px] text-muted-foreground">{sheet?.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* =========================== BATCH WIZARD (FormSheet) =========================== */}
      <FormSheet
        open={wizardOpen}
        onOpenChange={(o) => {
          setWizardOpen(o);
          if (!o) setWizardStep(1);
        }}
        title="New batch"
        description="Pick a template, then name the batch and set how many QR-coded units to produce."
        onSubmit={wizardSubmit}
        submitLabel={wizardStep === 1 ? "Next" : "Create batch"}
        cancelLabel="Cancel"
        loading={savingBatch}
        dirty={wizardTouched}
        size="md"
        footerExtra={
          <span>
            Step {wizardStep} of 2 — {wizardStep === 1 ? "pick a template" : "batch details"}
          </span>
        }
      >
        {wizardStep === 1 ? (
          <FormSection
            title="Kit template"
            description="Retired templates can't start batches — restore them to Active first."
          >
            {templates.length === 0 ? (
              <EmptyState
                icon={<ClipboardList className="size-6" aria-hidden="true" />}
                title="No templates yet"
                hint="Create a kit template first."
              />
            ) : (
              <div className="grid gap-2">
                {templates.map((t) => {
                  const km = kindMeta(t.kind);
                  const retired = t.status === "RETIRED";
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={retired}
                      onClick={() => {
                        setWizardTemplateId(t.id);
                        setWizardStep(2);
                      }}
                      aria-label={`Use template ${t.name}`}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 text-left transition hover:border-emerald-500/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-border disabled:hover:bg-transparent",
                        wizardTemplateId === t.id && "border-emerald-500/50 bg-emerald-500/10"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted", km.iconCls)}
                      >
                        <km.icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {km.label} · {formatINR(t.costPerUnit)} per kit · {parseItems(t.items).length} items
                        </span>
                      </span>
                      {retired ? (
                        <Badge variant="outline" className="shrink-0 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                          Retired
                        </Badge>
                      ) : (
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{prefixFor(t)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </FormSection>
        ) : (
          <>
            <FormSection title="Batch details" description="Each unit gets a unique QR code generated by the server.">
              <TextField
                label="Batch name"
                required
                value={wizardName}
                onChange={setWizardName}
                placeholder="Diwali drive — Nov 2026"
              />
              <TextField
                label="Total units (1–500)"
                required
                type="number"
                min="1"
                max="500"
                value={wizardUnits}
                onChange={setWizardUnits}
                hint={`Unit codes become ${prefixFor(tplMap.get(wizardTemplateId) ?? {})}-YYYY-NNNNNN`}
              />
              <TextareaField
                label="Instructions (optional)"
                value={wizardInstructions}
                onChange={setWizardInstructions}
                placeholder="Pack 5 kg rice first, then dal; label facing outward…"
                rows={3}
              />
            </FormSection>
            <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Summary</p>
              <p className="mt-1">
                Template: {tplMap.get(wizardTemplateId)?.name ?? "—"} ·{" "}
                Kind: {kindMeta(tplMap.get(wizardTemplateId)?.kind).label} · Units: {wizardUnits || "0"} · Est. value:{" "}
                {formatINR(
                  (tplMap.get(wizardTemplateId)?.costPerUnit ?? 0) * (Number(wizardUnits) || 0)
                )}
              </p>
            </div>
          </>
        )}
      </FormSheet>

      {/* ========================== TEMPLATE FORM SHEET ========================== */}
      <FormSheet
        open={tplSheetOpen}
        onOpenChange={setTplSheetOpen}
        title={editingTpl ? `Edit ${editingTpl.name}` : "New kit template"}
        description="Standard contents of one aid kit. Batches assemble QR-coded units from a template."
        onSubmit={saveTpl}
        submitLabel={editingTpl ? "Save changes" : "Create template"}
        loading={savingTpl}
        dirty={tplTouched}
        size="md"
      >
        <FormSection title="Identity" description="What this kit is and how it appears across the app.">
          <FieldGrid>
            <TextField
              label="Template name"
              required
              value={tplForm.name}
              onChange={(v) => setTpl({ name: v })}
              placeholder="Standard family kit"
            />
            <Field label="Kind" required>
              <Select
                value={tplForm.kind}
                onValueChange={(v) => setTpl({ kind: v as KitKind })}
              >
                <SelectTrigger aria-label="Kit kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => {
                    const km = KIND_META[k];
                    return (
                      <SelectItem key={k} value={k}>
                        <span className="flex items-center gap-2">
                          <km.icon className={cn("size-3.5", km.iconCls)} aria-hidden="true" />
                          {km.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
          <TextField
            label="Description"
            value={tplForm.description}
            onChange={(v) => setTpl({ description: v })}
            placeholder="Feeds a family of four for two weeks"
          />
          <FieldGrid>
            <Field label="Status" hint="Retired templates can't start new batches.">
              <Select
                value={tplForm.status}
                onValueChange={(v) => setTpl({ status: v as TemplateForm["status"] })}
              >
                <SelectTrigger aria-label="Template status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="RETIRED">Retired</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <TextField
              label="Image URL"
              value={tplForm.image}
              onChange={(v) => setTpl({ image: v })}
              placeholder="https://cdn.unitedangelreach.org/kits/family.jpg"
              hint="Shown on template cards (optional)."
            />
          </FieldGrid>
        </FormSection>

        <FormSection title="Contents & cost" description="Items that go into one kit, and its unit cost.">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Items</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setTpl({ items: [...tplForm.items, { name: "", qty: "1", unit: "kg" }] })
                }
                aria-label="Add item row"
              >
                <Plus className="size-3.5" aria-hidden="true" /> Add item
              </Button>
            </div>
            {tplForm.items.map((item, i) => (
              <div key={i} className="grid grid-cols-[1fr_64px_92px_36px] items-center gap-2">
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
                  onClick={() => setTpl({ items: tplForm.items.filter((_, j) => j !== i) })}
                  aria-label={`Remove item ${i + 1}`}
                  disabled={tplForm.items.length <= 1}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              {tplForm.items.reduce((s, i) => s + (Number(i.qty) || 0), 0)} total units across items · cost per kit
              entered below.
            </p>
          </div>
          <TextField
            label="Cost per unit (₹)"
            required
            prefix="₹"
            type="number"
            min="0"
            value={tplForm.costPerUnit}
            onChange={(v) => setTpl({ costPerUnit: v })}
            placeholder="950"
          />
        </FormSection>

        <FormSection
          title="Unit codes"
          description="QR codes stamped on every unit inside batches of this template."
        >
          <TextField
            label="Code prefix (optional)"
            value={tplForm.codePrefix}
            onChange={(v) => setTpl({ codePrefix: v })}
            placeholder={KIND_META[tplForm.kind].prefix}
            hint={`Unit codes become ${effPrefix}-YYYY-NNNNNN · first code ≈ ${prefixPreview}`}
          />
        </FormSection>
      </FormSheet>

      {/* ============================ DELETE CONFIRMS =========================== */}
      <ConfirmDialog
        open={!!deleteTpl}
        onOpenChange={(o) => !o && setDeleteTpl(null)}
        title="Delete template?"
        recordName={deleteTpl?.name ?? null}
        description="Templates with existing batches cannot be deleted — the server will block it."
        confirmLabel="Delete template"
        loading={false}
        onConfirm={removeTpl}
      />

      <ConfirmDialog
        open={!!deleteBatch}
        onOpenChange={(o) => !o && setDeleteBatch(null)}
        title="Delete batch?"
        recordName={deleteBatch ? `${deleteBatch.name} · ${deleteBatch.totalUnits} units` : null}
        description="All QR-coded units are removed with the batch. Volunteers will no longer be able to scan its codes."
        confirmLabel="Delete batch"
        loading={false}
        onConfirm={removeBatch}
      />
    </div>
  );
}
