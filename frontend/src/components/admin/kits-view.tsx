"use client";

/**
 * Aid & Distribution Kits — round-5: DataTable for the templates tab (fill
 * height, skeleton rows, built-in pagination), 75%-width DetailSheets for
 * templates (items table + per-batch scan progress) and batches (units
 * drill-in with scanned-by/when, instructions, QR label sheets), `xl`
 * FormSheets for the template composer and batch creation, grid/list views
 * for both tabs.
 *
 * The live scanning flow (scan input + recent scans + stock decrement) lives
 * in the volunteer portal (`/volunteer/scan`) and is intentionally untouched.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  BookOpen,
  ClipboardList,
  Copy,
  Droplets,
  Image as ImageIcon,
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
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
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
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import {
  Field,
  FieldGrid,
  FormSection,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { FilePickButton, fileUrl } from "@/components/shared/file-picker";
import { CsvColumn, ExportMenu } from "@/components/shared/csv";
import {
  DataViewMode,
  PaginationBar,
  useViewPref,
  ViewSwitcher,
} from "@/components/shared/view-switcher";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/* ---------------------------------- types ---------------------------------- */

interface TplItem {
  itemId: string;
  name: string;
  qty: string;
  unit: string;
}

interface InventoryLite {
  id: string;
  name: string;
  unit: string;
  quantity: number;
}

interface KitTemplate {
  id: string;
  code: string;
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
  items: [{ itemId: "", name: "", qty: "1", unit: "kg" }],
};

function parseItems(json: string | null | undefined): TplItem[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { itemId?: string; name?: string; qty?: number | string; unit?: string }[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((i) => ({
      itemId: String(i?.itemId ?? ""),
      name: String(i?.name ?? ""),
      qty: String(i?.qty ?? ""),
      unit: String(i?.unit ?? "pcs"),
    }));
  } catch {
    return [];
  }
}

function scanPct(b: Pick<KitBatch, "totalUnits" | "scannedUnits">): number {
  return b.totalUnits > 0
    ? Math.min(100, Math.round(((b.scannedUnits ?? 0) / b.totalUnits) * 100))
    : 0;
}

/* ---------------------------------- view ----------------------------------- */

export default function KitsView() {
  const [templates, setTemplates] = useState<KitTemplate[]>([]);
  const [batches, setBatches] = useState<KitBatch[]>([]);
  const [invItems, setInvItems] = useState<InventoryLite[]>([]);
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

  /* template detail sheet */
  const [tplDetail, setTplDetail] = useState<KitTemplate | null>(null);

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

  /* view preferences */
  const [view, setView] = useViewPref("kit-templates");
  const [batchView, setBatchView] = useViewPref("kit-batches", "grid");

  /* template table pagination */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const load = useCallback(async () => {
    try {
      const [tpl, bat, inv] = await Promise.all([
        get<KitTemplate[]>("/api/kit-templates"),
        get<KitBatch[]>("/api/kit-batches"),
        get<InventoryLite[]>("/api/inventory"),
      ]);
      setTemplates(Array.isArray(tpl) ? tpl : []);
      setBatches(Array.isArray(bat) ? bat : []);
      setInvItems(Array.isArray(inv) ? inv : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load kits data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  const tplMap = useMemo(() => {
    const m = new Map<string, KitTemplate>();
    templates.forEach((t) => m.set(t.id, t));
    return m;
  }, [templates]);

  const invById = useMemo(
    () => new Map(invItems.map((i) => [i.id, i])),
    [invItems]
  );

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

  /** Backfills itemId on legacy free-text item rows by matching their name against the master list — purely a display convenience, doesn't persist until saved. */
  const linkToMaster = useCallback(
    (item: TplItem): TplItem => {
      if (item.itemId) return item;
      const q = item.name.trim().toLowerCase();
      if (!q) return item;
      const match =
        invItems.find((i) => i.name.toLowerCase() === q) ??
        invItems.find((i) => i.name.toLowerCase().includes(q));
      return match ? { ...item, itemId: match.id, unit: match.unit } : item;
    },
    [invItems]
  );

  const openTplEdit = (t: KitTemplate) => {
    setEditingTpl(t);
    const items = parseItems(t.items).map(linkToMaster);
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
      items: items.length ? items : [{ itemId: "", name: "", qty: "1", unit: "kg" }],
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
    const items = tplForm.items.filter((i) => i.itemId);
    if (items.length === 0) {
      toast.error("Add at least one item picked from the inventory master");
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
        items: items.map((i) => ({
          itemId: i.itemId,
          name: i.name.trim(),
          qty: Number(i.qty) || 1,
          unit: i.unit,
        })),
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
      setTplDetail((d) => (d && d.id === deleteTpl.id ? null : d));
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
      // Generate EVERY ready unit — the print sheet paginates via CSS so the
      // browser's print dialog receives the complete set of labels.
      const out: { code: string; dataUrl: string }[] = [];
      for (const u of readyUnits) {
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

  /* ------------------------- templates table columns ------------------------ */

  const columns: DataTableColumn<KitTemplate>[] = [
    { key: "name", header: "Template" },
    { key: "kind", header: "Kind", hideBelow: "sm" },
    { key: "items", header: "Items", align: "right", hideBelow: "md" },
    { key: "cost", header: "Cost / unit", align: "right", mono: true, hideBelow: "sm" },
    { key: "batches", header: "Batches", align: "right", hideBelow: "lg" },
    { key: "prefix", header: "Codes", mono: true, hideBelow: "lg" },
    { key: "status", header: "Status" },
    { key: "actions", header: "", align: "right", className: "w-40" },
  ];

  const tplPages = Math.max(1, Math.ceil(templates.length / pageSize));
  const tplPageSafe = Math.min(page, tplPages);
  const tplPaged = useMemo(
    () => templates.slice((tplPageSafe - 1) * pageSize, tplPageSafe * pageSize),
    [templates, tplPageSafe, pageSize]
  );

  const tplActions = (t: KitTemplate) => (
    <div className="flex shrink-0 justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Button
        variant="outline"
        size="sm"
        className="min-h-9"
        onClick={() => openWizardFromTpl(t)}
        disabled={t.status === "RETIRED"}
        title={t.status === "RETIRED" ? "Retired — templates must be Active to start batches" : undefined}
        aria-label={`Start batch from ${t.name}`}
      >
        <PackagePlus className="size-3.5" aria-hidden="true" />
        <span className="hidden md:inline">Use</span>
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-11 md:size-8"
        onClick={() => openTplEdit(t)}
        aria-label={`Edit ${t.name}`}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-11 text-red-600 hover:bg-red-500/10 hover:text-red-700 md:size-8 dark:text-red-400"
        onClick={() => setDeleteTpl(t)}
        aria-label={`Delete ${t.name}`}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );

  const templateBatches = useMemo(
    () => (tplDetail ? batches.filter((b) => b.templateId === tplDetail.id) : []),
    [batches, tplDetail]
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
        <TabsContent value="batches" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm text-muted-foreground">
              {batches.length} batch{batches.length === 1 ? "" : "es"} ·{" "}
              {totals.scanned.toLocaleString("en-IN")}/{totals.totalUnits.toLocaleString("en-IN")} units scanned
            </p>
            <ViewSwitcher value={batchView} onChange={setBatchView} options={["grid", "list"]} />
          </div>

          {loading ? (
            batchView === "grid" ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-56 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            )
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
          ) : batchView === "grid" ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {batches.map((b) => {
                const tpl = tplMap.get(b.templateId);
                const km = kindMeta(tpl?.kind);
                const pct = scanPct(b);
                const scanned = b.scannedUnits ?? 0;
                const remaining = Math.max(0, b.totalUnits - scanned);
                const done = pct === 100;
                const kitValue = (b.template?.costPerUnit ?? 0) * b.totalUnits;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => openSheet(b)}
                    aria-label={`Open batch ${b.name} — ${pct}% scanned`}
                    className={cn(
                      "card-hover relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 text-left shadow-sm transition focus-visible:outline-2 focus-visible:outline-primary",
                      done
                        ? "border-emerald-500/40"
                        : "hover:border-emerald-500/40"
                    )}
                  >
                    {/* status glow ribbon */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-x-0 top-0 h-1",
                        done ? "bg-emerald-500" : pct > 0 ? "bg-amber-500/70" : "bg-muted-foreground/25"
                      )}
                    />

                    <div className="flex items-start gap-2.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-lg border",
                          km.chip
                        )}
                      >
                        <km.icon className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold leading-tight">{b.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {b.template?.name ?? "Template"} · {km.label} kit
                        </p>
                      </div>
                      <StatusBadge status={b.status} />
                    </div>

                    {/* scan progress — big number + segmented bar */}
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-end justify-between gap-2">
                        <div>
                          <p className="text-2xl font-bold leading-none tabular-nums">
                            {pct}
                            <span className="text-sm font-semibold text-muted-foreground">%</span>
                          </p>
                          <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {done ? "Batch fully handed out" : "Scan progress"}
                          </p>
                        </div>
                        <div className="text-right text-xs tabular-nums text-muted-foreground">
                          <p>
                            <strong className="font-semibold text-foreground">{scanned}</strong> scanned
                          </p>
                          <p>
                            <strong className="font-semibold text-foreground">{remaining}</strong> remaining
                          </p>
                        </div>
                      </div>
                      <Progress
                        value={pct}
                        className={cn(
                          "mt-2.5 h-2",
                          done ? "[&>div]:bg-emerald-600" : "[&>div]:bg-amber-500"
                        )}
                        aria-label={`${pct}% scanned`}
                      />
                    </div>

                    {/* informative footer stats */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border px-2.5 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Units</p>
                        <p className="font-semibold tabular-nums">{b.totalUnits}</p>
                      </div>
                      <div className="rounded-md border px-2.5 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Kit value</p>
                        <p className="font-semibold tabular-nums">{formatINR(kitValue)}</p>
                      </div>
                    </div>

                    {b.instructions ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{b.instructions}</p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <ul className="max-h-[32rem] space-y-2 overflow-y-auto scrollbar-thin" aria-label="Kit batches list">
              {batches.map((b) => {
                const tpl = tplMap.get(b.templateId);
                const km = kindMeta(tpl?.kind);
                const pct = scanPct(b);
                const remaining = Math.max(0, b.totalUnits - (b.scannedUnits ?? 0));
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => openSheet(b)}
                      aria-label={`Open batch ${b.name}`}
                      className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span
                        aria-hidden="true"
                        className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted", km.iconCls)}
                      >
                        <km.icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{b.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {b.template?.name ?? "Template"} · {km.label} kit ·{" "}
                          {remaining} of {b.totalUnits} units remaining
                        </span>
                      </span>
                      <span className="hidden w-32 shrink-0 sm:block">
                        <Progress value={pct} className="h-2 [&>div]:bg-emerald-600" aria-label={`${pct}% scanned`} />
                      </span>
                      <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground md:block">
                        {b.scannedUnits ?? 0}/{b.totalUnits}
                      </span>
                      <StatusBadge status={b.status} className="shrink-0" />
                    </button>
                  </li>
                );
              })}
            </ul>
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

          {view === "table" ? (
            <DataTable
              columns={columns}
              rows={tplPaged}
              rowKey={(t) => t.id}
              loading={loading}
              skeletonRows={6}
              height="fill"
              fillOffset={330}
              onRowClick={(t) => setTplDetail(t)}
              page={tplPageSafe}
              pages={tplPages}
              total={templates.length}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={setPageSize}
              itemLabel="templates"
              empty={
                <EmptyState
                  icon={<ClipboardList className="size-8" aria-hidden="true" />}
                  title="No kit templates yet"
                  hint="Define what goes into a standard kit — items, quantities, kind and cost."
                >
                  <Button onClick={openTplCreate}>
                    <Plus className="size-4" aria-hidden="true" /> New template
                  </Button>
                </EmptyState>
              }
            >
              {(t, col) => {
                const km = kindMeta(t.kind);
                switch (col.key) {
                  case "name":
                    return (
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate font-medium">
                          <span className="truncate">{t.name}</span>
                          <span className="shrink-0 font-mono text-[10px] font-normal text-muted-foreground/70">{t.code}</span>
                        </p>
                        {t.description ? (
                          <p className="max-w-56 truncate text-xs text-muted-foreground">{t.description}</p>
                        ) : null}
                      </div>
                    );
                  case "kind":
                    return (
                      <Badge variant="outline" className={cn(km.chip)}>
                        <km.icon className="size-3" aria-hidden="true" />
                        {km.label}
                      </Badge>
                    );
                  case "items":
                    return <span className="tabular-nums">{parseItems(t.items).length}</span>;
                  case "cost":
                    return <span>{formatINR(t.costPerUnit)}</span>;
                  case "batches":
                    return <span className="tabular-nums">{t._count?.batches ?? 0}</span>;
                  case "prefix":
                    return <span className="font-mono text-xs">{prefixFor(t)}</span>;
                  case "status":
                    return <StatusBadge status={t.status ?? "ACTIVE"} />;
                  case "actions":
                    return tplActions(t);
                  default:
                    return null;
                }
              }}
            </DataTable>
          ) : loading ? (
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
          ) : view === "list" ? (
            <ul className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin" role="list" aria-label="Kit templates">
              {templates.map((t) => {
                const km = kindMeta(t.kind);
                const items = parseItems(t.items);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTplDetail(t)}
                      aria-label={`Open template ${t.name}`}
                      className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span
                        aria-hidden="true"
                        className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted", km.iconCls)}
                      >
                        <km.icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          <span className="font-mono">{t.code}</span> · {items.length} item{items.length === 1 ? "" : "s"} · {formatINR(t.costPerUnit)} per kit ·{" "}
                          {t._count?.batches ?? 0} batch{(t._count?.batches ?? 0) === 1 ? "" : "es"}
                        </span>
                      </span>
                      <StatusBadge status={t.status ?? "ACTIVE"} className="hidden shrink-0 sm:inline-flex" />
                      <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        {tplActions(t)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
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
                    <button
                      type="button"
                      className="flex items-start gap-2 text-left"
                      onClick={() => setTplDetail(t)}
                      aria-label={`Open template ${t.name}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold leading-tight">{t.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          <span className="font-mono">{t.code}</span> · {items.length} item{items.length === 1 ? "" : "s"} · {formatINR(t.costPerUnit)} per kit
                        </span>
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        {t._count?.batches ?? 0} batch{(t._count?.batches ?? 0) === 1 ? "" : "es"}
                      </Badge>
                    </button>
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
                        className="min-h-9"
                        onClick={() => openWizardFromTpl(t)}
                        disabled={retired}
                        title={retired ? "Retired — templates must be Active to start batches" : undefined}
                        aria-label={`Start batch from ${t.name}`}
                      >
                        <PackagePlus className="size-3.5" aria-hidden="true" /> Use
                      </Button>
                      <Button variant="outline" size="sm" className="min-h-9" onClick={() => openTplEdit(t)} aria-label={`Edit ${t.name}`}>
                        <Pencil className="size-3.5" aria-hidden="true" /> Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto min-h-9 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
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

      {/* pagination for non-table template views */}
      {view !== "table" && !loading && templates.length > 0 ? (
        <PaginationBar
          page={tplPageSafe}
          pages={tplPages}
          total={templates.length}
          onPage={setPage}
          itemLabel="templates"
        />
      ) : null}

      {/* ============================ TEMPLATE SHEET ============================= */}
      <DetailSheet
        open={!!tplDetail}
        onOpenChange={(o) => !o && setTplDetail(null)}
        eyebrow={tplDetail ? `Kit template · ${tplDetail.code}` : "Kit template"}
        title={tplDetail?.name ?? "Template"}
        description={
          tplDetail
            ? `${kindMeta(tplDetail.kind).label} kit · ${formatINR(tplDetail.costPerUnit)} per unit · ${prefixFor(tplDetail)}-YYYY-NNNNNN`
            : ""
        }
        status={tplDetail ? <StatusBadge status={tplDetail.status ?? "ACTIVE"} /> : undefined}
        actions={
          tplDetail ? (
            <>
              <Button
                size="sm"
                onClick={() => openWizardFromTpl(tplDetail)}
                disabled={tplDetail.status === "RETIRED"}
              >
                <PackagePlus className="size-3.5" aria-hidden="true" /> Start batch
              </Button>
              <Button size="sm" variant="outline" onClick={() => openTplEdit(tplDetail)}>
                <Pencil className="size-3.5" aria-hidden="true" /> Edit
              </Button>
            </>
          ) : undefined
        }
      >
        {tplDetail ? (
          <>
            <DetailSection title="Overview" description="Identity, cost and unit-code settings.">
              <DetailGrid cols={2}>
                <DataField label="Name" value={tplDetail.name} />
                <DataField
                  label="Kind"
                  value={
                    <Badge variant="outline" className={cn(kindMeta(tplDetail.kind).chip)}>
                      {kindMeta(tplDetail.kind).label} kit
                    </Badge>
                  }
                />
                <DataField label="Cost per unit" value={formatINR(tplDetail.costPerUnit)} mono />
                <DataField label="Code prefix" value={prefixFor(tplDetail)} mono copy />
                <DataField label="Status" value={<StatusBadge status={tplDetail.status ?? "ACTIVE"} />} />
                <DataField label="Batches" value={String(tplDetail._count?.batches ?? 0)} />
                <DataField label="Description" value={tplDetail.description} className="sm:col-span-2" />
                {tplDetail.image ? (
                  <div className="sm:col-span-2">
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Cover image
                    </p>
                    <img
                      src={tplDetail.image}
                      alt={`${tplDetail.name} cover`}
                      className="h-28 w-full max-w-sm rounded-lg border object-cover"
                    />
                  </div>
                ) : null}
              </DetailGrid>
            </DetailSection>

            <DetailSection
              title="Template items"
              description="Everything packed into one kit — the checklist volunteers follow."
            >
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="px-3 py-2 font-semibold">#</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Item</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Qty</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseItems(tplDetail.items).map((i, idx) => (
                      <tr key={idx} className="border-b last:border-b-0">
                        <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{idx + 1}</td>
                        <td className="px-3 py-2 font-medium">{i.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{i.qty}</td>
                        <td className="px-3 py-2 text-muted-foreground">{i.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DetailSection>

            <DetailSection
              title="Batches from this template"
              description="Scan progress per batch — open a batch to drill into units."
            >
              {templateBatches.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No batches assembled from this template yet.
                </p>
              ) : (
                <ul className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin" aria-label="Batches from this template">
                  {templateBatches.map((b) => {
                    const pct = scanPct(b);
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => openSheet(b)}
                          className="w-full rounded-lg border p-3 text-left transition hover:bg-accent"
                          aria-label={`Open batch ${b.name}`}
                        >
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">{b.name}</span>
                            <span className="flex items-center gap-1.5">
                              <Badge variant="outline" className="tabular-nums">
                                {b.scannedUnits ?? 0}/{b.totalUnits} scanned
                              </Badge>
                              <StatusBadge status={b.status} />
                            </span>
                          </span>
                          <span className="mt-2 block">
                            <Progress value={pct} className="h-2 [&>div]:bg-emerald-600" aria-label={`${pct}% scanned`} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </DetailSection>
          </>
        ) : null}
      </DetailSheet>

      {/* ============================== BATCH SHEET ============================== */}
      <DetailSheet
        open={!!sheet}
        onOpenChange={(o) => !o && setSheet(null)}
        eyebrow="Kit batch"
        title={sheet?.name ?? "Batch"}
        description={
          sheet
            ? `${sheet.template?.name ?? "Template"} · ${sheetKind.label} kit · ${formatINR(sheet.template?.costPerUnit ?? 0)} per unit`
            : ""
        }
        status={sheet ? <StatusBadge status={sheet.status} /> : undefined}
        actions={
          sheet ? (
            <Button
              size="sm"
              onClick={() => setQrOpen(true)}
              disabled={readyUnits.length === 0}
              aria-label="Print QR labels for ready units"
            >
              <Printer className="size-3.5" aria-hidden="true" /> QR labels
            </Button>
          ) : undefined
        }
        footer={
          sheet ? (
            <>
              <p className="text-xs text-muted-foreground">
                {readyUnits.length} READY unit{readyUnits.length === 1 ? "" : "s"} awaiting hand-off ·{" "}
                {Math.max(0, sheet.totalUnits - (sheet.scannedUnits ?? 0))} unscanned in total
              </p>
              <Button
                variant="outline"
                className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                onClick={() => setDeleteBatch(sheet)}
                aria-label={`Delete batch ${sheet.name}`}
              >
                <Trash2 className="size-4" aria-hidden="true" /> Delete batch
              </Button>
            </>
          ) : undefined
        }
      >
        {sheet ? (
          <>
            <DetailSection title="Scan progress" description="Units marked distributed at beneficiary hand-off.">
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {sheet.scannedUnits ?? 0} of {sheet.totalUnits} scanned
                  </span>
                  <span className="tabular-nums">{scanPct(sheet)}%</span>
                </div>
                <Progress
                  value={scanPct(sheet)}
                  className="h-2.5 [&>div]:bg-emerald-600"
                  aria-label={`${scanPct(sheet)}% scanned`}
                />
                <p className="text-xs text-muted-foreground">
                  {Math.max(0, sheet.totalUnits - (sheet.scannedUnits ?? 0))} unit
                  {Math.max(0, sheet.totalUnits - (sheet.scannedUnits ?? 0)) === 1 ? "" : "s"} remaining —
                  scanning happens in the volunteer portal via QR codes.
                </p>
              </div>
              <DetailGrid cols={3} className="mt-4">
                <DataField label="Total units" value={String(sheet.totalUnits)} />
                <DataField label="Scanned" value={String(sheet.scannedUnits ?? 0)} />
                <DataField label="Remaining" value={String(Math.max(0, sheet.totalUnits - (sheet.scannedUnits ?? 0)))} />
              </DetailGrid>
            </DetailSection>

            {sheet.instructions ? (
              <DetailSection title="Instructions" description="Packing notes attached to this batch.">
                <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
                  {sheet.instructions}
                </div>
              </DetailSection>
            ) : null}

            <DetailSection
              title="Kit contents"
              description="What goes into every unit of this batch."
            >
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="px-3 py-2 font-semibold">#</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Item</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Qty</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseItems(tplMap.get(sheet.templateId)?.items).map((i, idx) => (
                      <tr key={idx} className="border-b last:border-b-0">
                        <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{idx + 1}</td>
                        <td className="px-3 py-2 font-medium">{i.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{i.qty}</td>
                        <td className="px-3 py-2 text-muted-foreground">{i.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DetailSection>

            <DetailSection
              title="Units"
              description="Every QR-coded unit in this batch — click a code to copy it."
              actions={
                <Badge variant="outline" className="tabular-nums">
                  {readyUnits.length} ready
                </Badge>
              }
            >
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
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-semibold">Code</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                        <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">Scanned</th>
                        <th scope="col" className="hidden px-3 py-2 font-semibold lg:table-cell">Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUnits.map((u) => (
                        <tr key={u.id} className="border-b last:border-b-0">
                          <td className="px-3 py-2">
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
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge status={u.status} />
                          </td>
                          <td className="hidden px-3 py-2 text-xs sm:table-cell">
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
                          </td>
                          <td className="hidden px-3 py-2 text-xs lg:table-cell">{u.location || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DetailSection>
          </>
        ) : null}
      </DetailSheet>

      {/* ============================ QR LABEL DIALOG ============================ */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent
          className="no-print flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl print-area"
          showCloseButton={false}
        >
          {/* fixed header */}
          <DialogHeader className="shrink-0 space-y-1.5 border-b bg-background/95 px-6 py-4 backdrop-blur">
            <div className="flex items-center justify-between gap-3 pr-10">
              <DialogTitle className="flex items-center gap-2">
                <QrCode className="size-4 text-primary" aria-hidden="true" />
                QR labels — {sheet?.name}
              </DialogTitle>
              <button
                type="button"
                aria-label="Close label sheet"
                onClick={() => setQrOpen(false)}
                className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <DialogDescription>
              {sheet
                ? `${sheetKind.label.toUpperCase()} kit batch · `
                : ""}
              One label per READY unit — scanning at hand-off marks it distributed.
            </DialogDescription>
            {qrLabels.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge variant="outline" className="tabular-nums">
                  {qrLabels.length} label{qrLabels.length === 1 ? "" : "s"}
                </Badge>
                <Badge variant="outline" className="tabular-nums">
                  ≈ {Math.ceil(qrLabels.length / 24)} page{Math.ceil(qrLabels.length / 24) === 1 ? "" : "s"} at 24/sheet
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {prefixFor(tplMap.get(sheet?.templateId ?? "") ?? { kind: undefined, codePrefix: undefined })}-…
                </Badge>
              </div>
            ) : null}
          </DialogHeader>

          {/* scrollable label preview — every label, paginated by CSS on print */}
          <div className="print-scroll min-h-0 flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
            {qrLoading ? (
              <div className="grid place-items-center gap-3 py-10" aria-busy="true">
                <Skeleton className="size-16 rounded-xl" />
                <p className="text-sm text-muted-foreground">
                  Generating {readyUnits.length} QR codes…
                </p>
              </div>
            ) : qrLabels.length === 0 ? (
              <EmptyState
                icon={<QrCode className="size-6" aria-hidden="true" />}
                title="No READY units to print"
                hint="Labels are generated for units that have not been scanned yet."
              />
            ) : (
              <div className="print-labels grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                {qrLabels.map((l) => (
                  <div
                    key={l.code}
                    className="flex flex-col items-center gap-1 rounded-lg border border-dashed bg-card p-2 text-center"
                  >
                    <img
                      src={l.dataUrl}
                      alt={`QR code for kit unit ${l.code}`}
                      className="size-[88px]"
                      loading="lazy"
                    />
                    <span className="w-full truncate font-mono text-[10px] font-semibold leading-tight">
                      {l.code}
                    </span>
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                      UAR {sheetKind.label} Kit
                    </span>
                    <span className="w-full truncate text-[9px] text-muted-foreground">
                      {sheet?.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* fixed footer — print shell lives in globals.css @media print */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-6 py-4 backdrop-blur">
            <p className="text-xs text-muted-foreground">
              Tip: use plain white sticker paper · label size ≈ 50 × 50 mm
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setQrOpen(false)}>
                Close
              </Button>
              <Button
                size="sm"
                onClick={() => window.print()}
                disabled={qrLoading || qrLabels.length === 0}
                aria-label="Print all labels"
              >
                <Printer className="size-3.5" aria-hidden="true" /> Print all {qrLabels.length || ""}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* =========================== BATCH WIZARD (FormSheet) =========================== */}
      <FormSheet
        open={wizardOpen}
        onOpenChange={(o) => {
          if (!o && !savingBatch) {
            setWizardOpen(false);
            setWizardStep(1);
          }
        }}
        title="New batch"
        description="Pick a template, then name the batch and set how many QR-coded units to produce."
        onSubmit={wizardSubmit}
        submitLabel={wizardStep === 1 ? "Next" : "Create batch"}
        cancelLabel="Cancel"
        loading={savingBatch}
        dirty={wizardTouched}
        size="xl"
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
              <div className="grid gap-2 sm:grid-cols-2">
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
                        "flex min-h-11 items-center gap-3 rounded-lg border p-3 text-left transition hover:border-emerald-500/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-border disabled:hover:bg-transparent",
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
              <FieldGrid>
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
              </FieldGrid>
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
        onOpenChange={(o) => {
          if (!o && !savingTpl) setTplSheetOpen(false);
        }}
        title={editingTpl ? `Edit ${editingTpl.name}` : "New kit template"}
        description="Standard contents of one aid kit. Batches assemble QR-coded units from a template."
        onSubmit={saveTpl}
        submitLabel={editingTpl ? "Save changes" : "Create template"}
        loading={savingTpl}
        dirty={tplTouched}
        size="xl"
        badge={editingTpl ? <StatusBadge status={editingTpl.status ?? "ACTIVE"} /> : undefined}
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
            <Field
              label="Image URL"
              hint="Shown on template cards (optional) — paste a URL or choose from the file library."
            >
              <div className="flex gap-2">
                <div className="group relative size-14 shrink-0 overflow-hidden rounded-lg border bg-muted/30">
                  {tplForm.image ? (
                    <img
                      src={tplForm.image}
                      alt="Template image preview"
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="size-5" aria-hidden="true" />
                    </span>
                  )}
                  {tplForm.image && (
                    <button
                      type="button"
                      aria-label="Clear template image"
                      title="Clear"
                      onClick={() => setTpl({ image: "" })}
                      className="absolute right-0 top-0 rounded-full bg-background/80 p-0.5 text-foreground opacity-100 transition hover:bg-background focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <Input
                  value={tplForm.image}
                  onChange={(e) => setTpl({ image: e.target.value })}
                  placeholder="https://cdn.unitedangelreach.org/kits/family.jpg"
                  aria-label="Template image URL"
                  className="flex-1"
                />
                <FilePickButton
                  size="sm"
                  variant="outline"
                  label="Choose from library"
                  accept="image/*"
                  folder="kits"
                  className="shrink-0"
                  onPicked={(files) => {
                    const f = files[0];
                    if (f) setTpl({ image: fileUrl(f.id) });
                  }}
                />
              </div>
            </Field>
          </FieldGrid>
          <TextField
            label="Description"
            value={tplForm.description}
            onChange={(v) => setTpl({ description: v })}
            placeholder="Feeds a family of four for two weeks"
          />
        </FormSection>

        <FormSection title="Contents & cost" description="Items that go into one kit, and its unit cost.">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Items</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-9"
                onClick={() =>
                  setTpl({ items: [...tplForm.items, { itemId: "", name: "", qty: "1", unit: "" }] })
                }
                aria-label="Add item row"
              >
                <Plus className="size-3.5" aria-hidden="true" /> Add item
              </Button>
            </div>
            <p className="flex items-start gap-1.5 rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              <ClipboardList className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              Items are picked from the inventory master so stock stays in sync — free-text
              component names aren't allowed.
            </p>
            {tplForm.items.map((item, i) => {
              const inv = item.itemId ? invById.get(item.itemId) : undefined;
              return (
                <div key={i} className="grid grid-cols-[1fr_72px_90px_44px] items-center gap-2">
                  <select
                    aria-label={`Item ${i + 1} — master item`}
                    value={item.itemId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const picked = invItems.find((x) => x.id === id);
                      setTplForm((f) => ({
                        ...f,
                        items: f.items.map((it, j) =>
                          j === i
                            ? { ...it, itemId: id, name: picked?.name ?? "", unit: picked?.unit ?? "" }
                            : it
                        ),
                      }));
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <option value="">Select from inventory…</option>
                    {invItems.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name} ({opt.quantity} {opt.unit} in stock)
                      </option>
                    ))}
                  </select>
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
                    aria-label={`Item ${i + 1} quantity per kit`}
                    className="min-h-9"
                  />
                  <span className="truncate text-center text-xs text-muted-foreground" title={inv?.unit}>
                    {inv?.unit ?? item.unit ?? "—"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 md:size-9"
                    onClick={() => setTpl({ items: tplForm.items.filter((_, j) => j !== i) })}
                    aria-label={`Remove item ${i + 1}`}
                    disabled={tplForm.items.length <= 1}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
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
        onConfirm={removeTpl}
      />

      <ConfirmDialog
        open={!!deleteBatch}
        onOpenChange={(o) => !o && setDeleteBatch(null)}
        title="Delete batch?"
        recordName={deleteBatch ? `${deleteBatch.name} · ${deleteBatch.totalUnits} units` : null}
        description="All QR-coded units are removed with the batch. Volunteers will no longer be able to scan its codes."
        confirmLabel="Delete batch"
        onConfirm={removeBatch}
      />
    </div>
  );
}
