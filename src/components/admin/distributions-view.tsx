"use client";

/**
 * Distributions — admin module.
 * Tab 1: general field distributions (type filter, search, CSV, record drawer).
 * Tab 2: sanitary-pad drives with a school-coverage registry mini-panel.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Package, Plus, RefreshCw, School, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { del, get, post } from "@/lib/api-client";
import { formatDate, formatDateTime, formatINR, titleCase } from "@/lib/format";
import { amountRule, dateRule } from "@/lib/validators";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  Field,
  FieldGrid,
  FormSection,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { CsvColumn, ExportMenu } from "@/components/shared/csv";
import {
  DataViewMode,
  PaginationBar,
  PageSizeSelect,
  useViewPref,
  ViewSwitcher,
} from "@/components/shared/view-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ---------------------------------- types ---------------------------------- */

interface DistributionRow {
  id: string;
  type: string;
  beneficiaryId?: string | null;
  campaignId?: string | null;
  items?: string | null;
  quantity: number;
  value?: number | null;
  location?: string | null;
  notes?: string | null;
  distributedAt: string;
  beneficiary?: { name: string } | null;
  volunteer?: { user?: { name: string } | null } | null;
  campaign?: { title: string } | null;
}

interface BeneficiaryLite {
  id: string;
  name: string;
  city?: string | null;
}

interface CampaignLite {
  id: string;
  title: string;
}

interface InventoryLite {
  id: string;
  name: string;
  unit: string;
  pricePerUnit?: number | null;
}

interface ItemRow {
  name: string;
  qty: string;
}

interface PadDrive {
  id: string;
  schoolName?: string | null;
  area: string;
  girlsCount: number;
  padsDistributed: number;
  awarenessSession: boolean;
  sessionAttendees?: number | null;
  notes?: string | null;
  distributionDate: string;
  volunteer?: { name: string } | null;
}

interface SchoolRow {
  id: string;
  schoolName: string;
  city?: string | null;
  totalGirls: number;
  visitsCount: number;
  isActive: boolean;
  lastVisited?: string | null;
}

interface DistForm {
  type: string;
  beneficiaryId: string;
  campaignId: string;
  quantity: string;
  value: string;
  location: string;
  distributedAt: string;
  items: ItemRow[];
  notes: string;
}

interface PadForm {
  area: string;
  schoolName: string;
  girlsCount: string;
  padsDistributed: string;
  awarenessSession: boolean;
  sessionAttendees: string;
  volunteerName: string;
  distributionDate: string;
  notes: string;
}

interface SchoolForm {
  schoolName: string;
  city: string;
  contactPerson: string;
  contactPhone: string;
  totalGirls: string;
}

/* ------------------------------- chip styles ------------------------------- */

const TYPE_CLS: Record<string, string> = {
  FOOD: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  SANITARY_PADS: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-400",
  MEDICAL: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  ANIMAL_FEED: "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-400",
  CLOTHING: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
  EDUCATION_MATERIAL: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  CASH: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  OTHER: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const DISTRIBUTION_TYPES = [
  "FOOD",
  "SANITARY_PADS",
  "MEDICAL",
  "ANIMAL_FEED",
  "CLOTHING",
  "EDUCATION_MATERIAL",
  "CASH",
  "OTHER",
];

const EMPTY_DIST_FORM: DistForm = {
  type: "FOOD",
  beneficiaryId: "",
  campaignId: "",
  quantity: "1",
  value: "",
  location: "",
  distributedAt: "",
  items: [{ name: "", qty: "1" }],
  notes: "",
};

const EMPTY_PAD_FORM: PadForm = {
  area: "",
  schoolName: "",
  girlsCount: "",
  padsDistributed: "",
  awarenessSession: false,
  sessionAttendees: "",
  volunteerName: "",
  distributionDate: "",
  notes: "",
};

const EMPTY_SCHOOL_FORM: SchoolForm = {
  schoolName: "",
  city: "",
  contactPerson: "",
  contactPhone: "",
  totalGirls: "",
};

const NATIVE_SELECT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseItems(json: string | null | undefined): { name: string; qty: number | string }[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ---------------------------------- view ----------------------------------- */

export default function DistributionsView() {
  const [distributions, setDistributions] = useState<DistributionRow[]>([]);
  const [padDrives, setPadDrives] = useState<PadDrive[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryLite[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [invItems, setInvItems] = useState<InventoryLite[]>([]);
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [loading, setLoading] = useState(true);

  /* general tab toolbar */
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [distQuery, setDistQuery] = useState("");
  const [appliedDistQuery, setAppliedDistQuery] = useState("");
  const [viewDist, setViewDist] = useViewPref("distributions");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /* pads tab */
  const [viewPad, setViewPad] = useViewPref("pad-drives");

  /* general forms / sheets */
  const [distOpen, setDistOpen] = useState(false);
  const [distForm, setDistForm] = useState<DistForm>(EMPTY_DIST_FORM);
  const [distTouched, setDistTouched] = useState(false);
  const [benQuery, setBenQuery] = useState("");
  const [savingDist, setSavingDist] = useState(false);
  const [sheet, setSheet] = useState<DistributionRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DistributionRow | null>(null);

  /* pad forms / sheets */
  const [padOpen, setPadOpen] = useState(false);
  const [padForm, setPadForm] = useState<PadForm>(EMPTY_PAD_FORM);
  const [padTouched, setPadTouched] = useState(false);
  const [schoolDdOpen, setSchoolDdOpen] = useState(false);
  const [savingPad, setSavingPad] = useState(false);
  const [padSheet, setPadSheet] = useState<PadDrive | null>(null);
  const [deletePad, setDeletePad] = useState<PadDrive | null>(null);

  /* school registry */
  const [schoolFormOpen, setSchoolFormOpen] = useState(false);
  const [schoolForm, setSchoolForm] = useState<SchoolForm>(EMPTY_SCHOOL_FORM);
  const [savingSchool, setSavingSchool] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dist, pads] = await Promise.all([
        get<DistributionRow[]>("/api/distributions?limit=200"),
        get<PadDrive[]>("/api/pad-distributions"),
      ]);
      setDistributions(Array.isArray(dist) ? dist : []);
      setPadDrives(Array.isArray(pads) ? pads : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load distributions");
    } finally {
      setLoading(false);
    }
    // best-effort supporting data — each failure degrades gracefully
    get<BeneficiaryLite[]>("/api/beneficiaries")
      .then((rows) => setBeneficiaries(Array.isArray(rows) ? rows : []))
      .catch(() => setBeneficiaries([]));
    get<CampaignLite[]>("/api/campaigns?all=1")
      .then((rows) => setCampaigns(Array.isArray(rows) ? rows : []))
      .catch(() => setCampaigns([]));
    get<InventoryLite[]>("/api/inventory")
      .then((rows) => setInvItems(Array.isArray(rows) ? rows : []))
      .catch(() => setInvItems([]));
    get<SchoolRow[]>("/api/school-coverages")
      .then((rows) => setSchools(Array.isArray(rows) ? rows : []))
      .catch(() => setSchools([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* debounce search */
  useEffect(() => {
    const t = window.setTimeout(() => {
      setAppliedDistQuery(distQuery);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [distQuery]);

  const filteredDist = useMemo(() => {
    const q = appliedDistQuery.trim().toLowerCase();
    return distributions.filter((d) => {
      if (typeFilter !== "ALL" && d.type !== typeFilter) return false;
      if (!q) return true;
      return (
        (d.beneficiary?.name ?? "").toLowerCase().includes(q) ||
        (d.location ?? "").toLowerCase().includes(q) ||
        (d.notes ?? "").toLowerCase().includes(q) ||
        (d.campaign?.title ?? "").toLowerCase().includes(q) ||
        titleCase(d.type).toLowerCase().includes(q)
      );
    });
  }, [distributions, typeFilter, appliedDistQuery]);

  const pages = Math.max(1, Math.ceil(filteredDist.length / pageSize));
  const pageSafe = Math.min(page, pages);
  const pagedDist = filteredDist.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  const padStats = useMemo(() => {
    const pads = padDrives.reduce((s, p) => s + (p.padsDistributed ?? 0), 0);
    const girls = padDrives.reduce((s, p) => s + (p.girlsCount ?? 0), 0);
    const sessions = padDrives.filter((p) => p.awarenessSession).length;
    const driveSchools = new Set(padDrives.map((p) => p.schoolName).filter(Boolean)).size;
    return { pads, girls, sessions, driveSchools };
  }, [padDrives]);

  /* ------------------------------ helper lookups ---------------------------- */

  const benFiltered = useMemo(() => {
    const q = benQuery.trim().toLowerCase();
    if (!q) return beneficiaries.slice(0, 300);
    return beneficiaries
      .filter(
        (b) => b.name.toLowerCase().includes(q) || (b.city ?? "").toLowerCase().includes(q)
      )
      .slice(0, 300);
  }, [beneficiaries, benQuery]);

  const matchInventory = useCallback(
    (name: string): InventoryLite | null => {
      const q = name.trim().toLowerCase();
      if (q.length < 2) return null;
      return (
        invItems.find((i) => i.name.toLowerCase() === q) ??
        invItems.find((i) => i.name.toLowerCase().includes(q)) ??
        null
      );
    },
    [invItems]
  );

  const schoolMatches = useMemo(() => {
    const active = schools.filter((s) => s.isActive);
    const q = padForm.schoolName.trim().toLowerCase();
    if (!q) return active.slice(0, 50);
    const starts = active.filter((s) => s.schoolName.toLowerCase().startsWith(q));
    const rest = active.filter(
      (s) => !s.schoolName.toLowerCase().startsWith(q) && s.schoolName.toLowerCase().includes(q)
    );
    return [...starts, ...rest].slice(0, 50);
  }, [schools, padForm.schoolName]);

  const schoolKnown = useMemo(
    () =>
      schools.some(
        (s) => s.schoolName.toLowerCase() === padForm.schoolName.trim().toLowerCase()
      ),
    [schools, padForm.schoolName]
  );

  const distValNum = Number(distForm.value);
  const distQtyNum = Math.trunc(Number(distForm.quantity)) || 0;
  const perUnitHint =
    distForm.value.trim() !== "" && Number.isFinite(distValNum) && distQtyNum > 0
      ? `≈ ${formatINR(distValNum / distQtyNum)} per unit`
      : "Estimated value in ₹ — persists now and shows in exports & impact stats.";

  /* --------------------------- general distributions ------------------------ */

  const openDistDialog = () => {
    setDistForm({ ...EMPTY_DIST_FORM, distributedAt: todayIso() });
    setBenQuery("");
    setDistTouched(false);
    setDistOpen(true);
  };

  const saveDist = async () => {
    if (!DISTRIBUTION_TYPES.includes(distForm.type)) {
      toast.error("Pick a distribution type");
      return;
    }
    if (!distForm.location.trim()) {
      toast.error("Location is required");
      return;
    }
    const qty = Math.trunc(Number(distForm.quantity));
    if (!Number.isFinite(qty) || qty < 1) {
      toast.error("Quantity must be at least 1");
      return;
    }
    const valErr = amountRule({ optional: true, label: "Value" })(distForm.value);
    if (valErr) {
      toast.error(valErr);
      return;
    }
    const dateErr = dateRule(true)(distForm.distributedAt);
    if (dateErr) {
      toast.error(dateErr);
      return;
    }
    setSavingDist(true);
    try {
      const items = distForm.items.filter((i) => i.name.trim());
      await post("/api/distributions", {
        type: distForm.type,
        beneficiaryId: distForm.beneficiaryId || undefined,
        campaignId: distForm.campaignId || undefined,
        quantity: qty,
        items: items.length
          ? items.map((i) => ({ name: i.name.trim(), qty: Number(i.qty) || 1 }))
          : undefined,
        value: distForm.value === "" ? undefined : Number(distForm.value),
        location: distForm.location.trim(),
        distributedAt: distForm.distributedAt || undefined,
        notes: distForm.notes.trim() || undefined,
      });
      toast.success("Distribution recorded");
      setDistOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Record failed");
    } finally {
      setSavingDist(false);
    }
  };

  const removeDist = async () => {
    if (!deleteTarget) return;
    try {
      await del(`/api/distributions/${deleteTarget.id}`);
      toast.success("Distribution deleted");
      setDeleteTarget(null);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  /* ------------------------------ pad drives -------------------------------- */

  const openPadDialog = () => {
    setPadForm({ ...EMPTY_PAD_FORM, distributionDate: todayIso() });
    setPadTouched(false);
    setSchoolDdOpen(false);
    setPadOpen(true);
  };

  const savePad = async () => {
    if (!padForm.area.trim()) {
      toast.error("Area is required");
      return;
    }
    const girls = Math.trunc(Number(padForm.girlsCount));
    if (!Number.isFinite(girls) || girls < 0) {
      toast.error("Girls count must be 0 or more");
      return;
    }
    const pads = Math.trunc(Number(padForm.padsDistributed));
    if (!Number.isFinite(pads) || pads < 0) {
      toast.error("Pads distributed must be 0 or more");
      return;
    }
    if (padForm.sessionAttendees !== "") {
      const att = Math.trunc(Number(padForm.sessionAttendees));
      if (!Number.isFinite(att) || att < 0) {
        toast.error("Session attendees must be 0 or more");
        return;
      }
    }
    const dateErr = dateRule(true)(padForm.distributionDate);
    if (dateErr) {
      toast.error(dateErr);
      return;
    }
    setSavingPad(true);
    try {
      await post("/api/pad-distributions", {
        area: padForm.area.trim(),
        schoolName: padForm.schoolName.trim() || undefined,
        girlsCount: girls,
        padsDistributed: pads,
        awarenessSession: padForm.awarenessSession,
        sessionAttendees:
          padForm.sessionAttendees === ""
            ? undefined
            : Math.trunc(Number(padForm.sessionAttendees)),
        volunteerName: padForm.volunteerName.trim() || undefined,
        distributionDate: padForm.distributionDate || undefined,
        notes: padForm.notes.trim() || undefined,
      });

      // register brand-new schools in the coverage registry (best-effort)
      const school = padForm.schoolName.trim();
      if (school && !schoolKnown) {
        try {
          await post("/api/school-coverages", {
            schoolName: school,
            lastVisited: padForm.distributionDate || todayIso(),
          });
          toast.success(`School "${school}" added to the coverage registry`);
        } catch {
          toast.error(`Pad drive saved, but registering school "${school}" failed`);
        }
      }

      toast.success("Pad drive recorded");
      setPadOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Record failed");
    } finally {
      setSavingPad(false);
    }
  };

  const removePad = async () => {
    if (!deletePad) return;
    try {
      await del(`/api/pad-distributions/${deletePad.id}`);
      toast.success("Pad drive deleted");
      setDeletePad(null);
      setPadSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  /* ---------------------------- school registry ----------------------------- */

  const openSchoolCreate = () => {
    setSchoolForm(EMPTY_SCHOOL_FORM);
    setSchoolFormOpen(true);
  };

  const saveSchool = async () => {
    if (!schoolForm.schoolName.trim()) {
      toast.error("School name is required");
      return;
    }
    if (schoolForm.totalGirls !== "") {
      const g = Math.trunc(Number(schoolForm.totalGirls));
      if (!Number.isFinite(g) || g < 0) {
        toast.error("Total girls must be 0 or more");
        return;
      }
    }
    setSavingSchool(true);
    try {
      await post("/api/school-coverages", {
        schoolName: schoolForm.schoolName.trim(),
        city: schoolForm.city.trim() || undefined,
        contactPerson: schoolForm.contactPerson.trim() || undefined,
        contactPhone: schoolForm.contactPhone.trim() || undefined,
        totalGirls: schoolForm.totalGirls === "" ? 0 : Math.trunc(Number(schoolForm.totalGirls)),
        lastVisited: todayIso(),
      });
      toast.success(`School "${schoolForm.schoolName.trim()}" registered`);
      setSchoolFormOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Register failed");
    } finally {
      setSavingSchool(false);
    }
  };

  /* --------------------------------- CSV ----------------------------------- */

  const distCsv: CsvColumn<DistributionRow>[] = useMemo(
    () => [
      { header: "Date", value: (d) => formatDate(d.distributedAt) },
      { header: "Type", value: (d) => titleCase(d.type) },
      { header: "Beneficiary", value: (d) => d.beneficiary?.name ?? "Community" },
      { header: "Quantity", value: (d) => d.quantity },
      { header: "Value (INR)", value: (d) => d.value ?? "" },
      { header: "Location", value: (d) => d.location ?? "" },
      { header: "Volunteer", value: (d) => d.volunteer?.user?.name ?? "" },
      { header: "Campaign", value: (d) => d.campaign?.title ?? "" },
      { header: "Notes", value: (d) => d.notes ?? "" },
    ],
    []
  );

  /* ------------------------------ small pieces ----------------------------- */

  const distActions = (d: DistributionRow) => (
    <div className="flex justify-end gap-1.5">
      <Button variant="outline" size="sm" onClick={() => setSheet(d)} aria-label="View distribution">
        View
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
        onClick={() => setDeleteTarget(d)}
        aria-label="Delete distribution"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );

  const padActions = (p: PadDrive) => (
    <div className="flex justify-end gap-1.5">
      <Button variant="outline" size="sm" onClick={() => setPadSheet(p)} aria-label="View pad drive">
        View
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
        onClick={() => setDeletePad(p)}
        aria-label="Delete pad drive"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );

  const typeChip = (t: string, className?: string) => (
    <Badge variant="outline" className={cn(TYPE_CLS[t] ?? TYPE_CLS.OTHER, className)}>
      {titleCase(t)}
    </Badge>
  );

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Distributions"
        description="Field distributions to beneficiaries and sanitary pad awareness drives."
        icon={<Package className="size-5" aria-hidden="true" />}
        actions={
          <Button variant="outline" onClick={load} aria-label="Refresh distributions">
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />

      {/* muted banner — pads live here */}
      <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
        <Sparkles className="size-4 shrink-0 text-pink-600 dark:text-pink-400" aria-hidden="true" />
        Sanitary pads initiative lives here — use the <strong>Pad drives</strong> tab below.
      </div>

      <Tabs defaultValue="general">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="general">General distributions ({distributions.length})</TabsTrigger>
          <TabsTrigger value="pads">Pad drives ({padDrives.length})</TabsTrigger>
        </TabsList>

        {/* =========================== GENERAL TAB =========================== */}
        <TabsContent value="general" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={distQuery}
              onChange={(e) => setDistQuery(e.target.value)}
              placeholder="Search beneficiary, location, notes…"
              aria-label="Search distributions"
              className="w-full sm:w-64"
            />
            <select
              aria-label="Filter by type"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              className={cn(NATIVE_SELECT_CLS, "w-full sm:w-44")}
            >
              <option value="ALL">All types</option>
              {DISTRIBUTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <ExportMenu
                columns={distCsv}
                rows={filteredDist}
                filename="uar-distributions"
                disabled={filteredDist.length === 0}
              />
              <ViewSwitcher value={viewDist} onChange={setViewDist} />
              <Button size="sm" onClick={openDistDialog}>
                <Plus className="size-4" aria-hidden="true" /> Record distribution
              </Button>
            </div>
          </div>

          {loading ? (
            viewDist === "grid" ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-40 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-12 rounded-lg" />
                ))}
              </div>
            )
          ) : filteredDist.length === 0 ? (
            <EmptyState
              icon={<Package className="size-8" aria-hidden="true" />}
              title={
                distributions.length === 0
                  ? "No distributions recorded"
                  : "No distributions match this filter"
              }
              hint="Record a field distribution so stock levels and impact stats stay accurate."
            >
              <Button variant="outline" onClick={openDistDialog}>
                <Plus className="size-4" aria-hidden="true" /> Record distribution
              </Button>
            </EmptyState>
          ) : viewDist === "grid" ? (
            <div className="grid max-h-[36rem] gap-4 overflow-y-auto scrollbar-thin sm:grid-cols-2 xl:grid-cols-3">
              {filteredDist.map((d) => (
                <div key={d.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    {typeChip(d.type)}
                    <span className="ml-auto text-xs text-muted-foreground">{formatDate(d.distributedAt)}</span>
                  </div>
                  <button
                    type="button"
                    className="text-left"
                    onClick={() => setSheet(d)}
                    aria-label="Open distribution"
                  >
                    <p className="truncate font-semibold">
                      {d.beneficiary?.name ?? "Community"} × {d.quantity}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {d.location || "—"}
                      {d.volunteer?.user?.name ? ` · ${d.volunteer.user.name}` : ""}
                    </p>
                  </button>
                  <div className="mt-auto flex items-center gap-2 border-t pt-3">
                    <Badge variant="outline">{d.value != null ? formatINR(d.value) : "No value"}</Badge>
                    <div className="ml-auto">{distActions(d)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : viewDist === "list" ? (
            <div className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin" role="list" aria-label="Distributions">
              {filteredDist.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border p-3" role="listitem">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                  >
                    <Package className="size-4" />
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setSheet(d)}
                    aria-label="Open distribution"
                  >
                    <p className="truncate text-sm font-medium">
                      {d.beneficiary?.name ?? "Community"} × {d.quantity}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {titleCase(d.type)} · {d.location || "—"} · {formatDate(d.distributedAt)}
                    </p>
                  </button>
                  <span className="hidden text-sm font-medium sm:block">
                    {d.value != null ? formatINR(d.value) : "—"}
                  </span>
                  {distActions(d)}
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Beneficiary</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Volunteer</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedDist.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="whitespace-nowrap">{formatDate(d.distributedAt)}</TableCell>
                        <TableCell>{typeChip(d.type)}</TableCell>
                        <TableCell>
                          <button
                            type="button"
                            className="font-medium hover:text-primary"
                            onClick={() => setSheet(d)}
                            aria-label="Open distribution"
                          >
                            {d.beneficiary?.name ?? "Community"}
                          </button>
                        </TableCell>
                        <TableCell className="text-right">{d.quantity}</TableCell>
                        <TableCell className="text-right">{d.value != null ? formatINR(d.value) : "—"}</TableCell>
                        <TableCell className="max-w-40 truncate">{d.location || "—"}</TableCell>
                        <TableCell>{d.volunteer?.user?.name ?? "—"}</TableCell>
                        <TableCell className="text-right">{distActions(d)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <PaginationBar
                  page={pageSafe}
                  pages={pages}
                  total={filteredDist.length}
                  onPage={setPage}
                  itemLabel="distributions"
                />
                <PageSizeSelect
                  value={pageSize}
                  onChange={(n) => {
                    setPageSize(n);
                    setPage(1);
                  }}
                />
              </div>
            </>
          )}
        </TabsContent>

        {/* ============================ PAD DRIVES ============================ */}
        <TabsContent value="pads" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Pads distributed" value={padStats.pads.toLocaleString("en-IN")} accent="pink" icon={<Sparkles className="size-5" aria-hidden="true" />} loading={loading} />
            <StatCard label="Girls reached" value={padStats.girls.toLocaleString("en-IN")} accent="fuchsia" icon={<Sparkles className="size-5" aria-hidden="true" />} loading={loading} />
            <StatCard label="Awareness sessions" value={padStats.sessions} accent="teal" icon={<Sparkles className="size-5" aria-hidden="true" />} loading={loading} />
            <StatCard label="Schools covered" value={padStats.driveSchools} accent="amber" icon={<School className="size-5" aria-hidden="true" />} loading={loading} />
          </div>

          {/* school registry mini-panel */}
          <SectionCard
            title="School registry"
            description={`${schools.length} school${schools.length === 1 ? "" : "s"} on file — powers the school picker in the drive form.`}
            icon={<School className="size-5" aria-hidden="true" />}
            actions={
              <Button size="sm" variant="outline" onClick={openSchoolCreate}>
                <Plus className="size-4" aria-hidden="true" /> Register school
              </Button>
            }
          >
            {loading ? (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 rounded-lg" />
                ))}
              </div>
            ) : schools.length === 0 ? (
              <EmptyState
                icon={<School className="size-6" aria-hidden="true" />}
                title="No schools registered yet"
                hint="Register schools here or just type a new school name in the drive form — it registers automatically."
              >
                <Button variant="outline" size="sm" onClick={openSchoolCreate}>
                  <Plus className="size-4" aria-hidden="true" /> Register school
                </Button>
              </EmptyState>
            ) : (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm scrollbar-thin">
                {schools.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {s.schoolName}
                      {s.city ? <span className="font-normal text-muted-foreground"> — {s.city}</span> : null}
                    </span>
                    <Badge variant="outline">{s.visitsCount} visits</Badge>
                    <Badge variant="outline">{s.totalGirls} girls</Badge>
                    {!s.isActive ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Inactive
                      </Badge>
                    ) : null}
                    {s.lastVisited ? (
                      <span className="text-xs text-muted-foreground">last {formatDate(s.lastVisited)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm text-muted-foreground">
              {padDrives.length} drive{padDrives.length === 1 ? "" : "s"} recorded
            </p>
            <ViewSwitcher value={viewPad} onChange={setViewPad} />
            <Button size="sm" onClick={openPadDialog}>
              <Plus className="size-4" aria-hidden="true" /> Record pad drive
            </Button>
          </div>

          {loading ? (
            viewPad === "grid" ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-40 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 rounded-lg" />
                ))}
              </div>
            )
          ) : padDrives.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-8" aria-hidden="true" />}
              title="No pad drives yet"
              hint="Record school visits with pads distributed and awareness session counts."
            >
              <Button variant="outline" onClick={openPadDialog}>
                <Plus className="size-4" aria-hidden="true" /> Record pad drive
              </Button>
            </EmptyState>
          ) : viewPad === "grid" ? (
            <div className="grid max-h-[36rem] gap-4 overflow-y-auto scrollbar-thin sm:grid-cols-2 xl:grid-cols-3">
              {padDrives.map((p) => (
                <div key={p.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate font-semibold">{p.area}</p>
                    {p.awarenessSession ? (
                      <Badge variant="outline" className="shrink-0 border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400">
                        Session
                      </Badge>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="text-left"
                    onClick={() => setPadSheet(p)}
                    aria-label="Open pad drive"
                  >
                    <p className="text-xs text-muted-foreground">
                      {formatDate(p.distributionDate)} · {p.schoolName || "Community visit"}
                    </p>
                    <p className="mt-1 text-sm">
                      {p.padsDistributed} pads · {p.girlsCount} girls
                    </p>
                  </button>
                  <div className="mt-auto flex items-center border-t pt-3">{padActions(p)}</div>
                </div>
              ))}
            </div>
          ) : viewPad === "list" ? (
            <div className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin" role="list" aria-label="Pad drives">
              {padDrives.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-lg border p-3" role="listitem">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-pink-600 dark:text-pink-400"
                  >
                    <Sparkles className="size-4" />
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setPadSheet(p)}
                    aria-label="Open pad drive"
                  >
                    <p className="truncate text-sm font-medium">{p.area}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.schoolName || "Community visit"} · {formatDate(p.distributionDate)}
                    </p>
                  </button>
                  <span className="hidden text-sm sm:block">
                    {p.padsDistributed} pads · {p.girlsCount} girls
                  </span>
                  {padActions(p)}
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>School</TableHead>
                    <TableHead className="text-right">Girls</TableHead>
                    <TableHead className="text-right">Pads</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead className="text-right">Attendees</TableHead>
                    <TableHead>Volunteer</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {padDrives.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(p.distributionDate)}</TableCell>
                      <TableCell className="font-medium">{p.area}</TableCell>
                      <TableCell className="max-w-44 truncate">{p.schoolName || "—"}</TableCell>
                      <TableCell className="text-right">{p.girlsCount}</TableCell>
                      <TableCell className="text-right">{p.padsDistributed}</TableCell>
                      <TableCell>
                        {p.awarenessSession ? (
                          <Badge variant="outline" className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400">
                            Yes
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">No</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{p.sessionAttendees ?? "—"}</TableCell>
                      <TableCell>{p.volunteer?.name ?? "—"}</TableCell>
                      <TableCell className="text-right">{padActions(p)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ========================= DISTRIBUTION SHEET ========================= */}
      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
          {sheet && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle className="flex items-center gap-2">
                  Distribution
                  <span className="ml-auto">{typeChip(sheet.type)}</span>
                </SheetTitle>
                <SheetDescription>{formatDateTime(sheet.distributedAt)}</SheetDescription>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-3">
                <DataField label="Beneficiary" value={sheet.beneficiary?.name ?? "Community hand-out"} />
                <DataField label="Quantity" value={String(sheet.quantity)} />
                <DataField label="Value" value={sheet.value != null ? formatINR(sheet.value) : "—"} />
                <DataField label="Volunteer" value={sheet.volunteer?.user?.name ?? "—"} />
                <DataField label="Location" value={sheet.location || "—"} />
                <DataField label="Campaign" value={sheet.campaign?.title ?? "—"} />
              </div>

              <SectionCard title="Items">
                {parseItems(sheet.items).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No item breakdown recorded.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {parseItems(sheet.items).map((i, idx) => (
                      <li
                        key={idx}
                        className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5"
                      >
                        <span className="min-w-0 truncate">{String(i?.name ?? i)}</span>
                        <span className="shrink-0 font-medium text-muted-foreground">
                          {String(i?.qty ?? "×1")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              {sheet.notes ? (
                <SectionCard title="Notes">
                  <p className="text-sm leading-relaxed text-muted-foreground">{sheet.notes}</p>
                </SectionCard>
              ) : null}

              <div className="flex gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  onClick={() => setDeleteTarget(sheet)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============================ PAD DRIVE SHEET =========================== */}
      <Sheet open={!!padSheet} onOpenChange={(o) => !o && setPadSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
          {padSheet && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle className="flex items-center gap-2">
                  Pad drive
                  {padSheet.awarenessSession ? (
                    <Badge
                      variant="outline"
                      className="ml-auto border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400"
                    >
                      Awareness session
                    </Badge>
                  ) : null}
                </SheetTitle>
                <SheetDescription>{formatDateTime(padSheet.distributionDate)}</SheetDescription>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-3">
                <DataField label="Area" value={padSheet.area} />
                <DataField label="School" value={padSheet.schoolName || "Community visit"} />
                <DataField label="Girls reached" value={String(padSheet.girlsCount)} />
                <DataField label="Pads distributed" value={String(padSheet.padsDistributed)} />
                <DataField
                  label="Session attendees"
                  value={padSheet.sessionAttendees != null ? String(padSheet.sessionAttendees) : "—"}
                />
                <DataField label="Volunteer" value={padSheet.volunteer?.name ?? "—"} />
              </div>

              {padSheet.notes ? (
                <SectionCard title="Notes">
                  <p className="text-sm leading-relaxed text-muted-foreground">{padSheet.notes}</p>
                </SectionCard>
              ) : null}

              <div className="flex gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  onClick={() => setDeletePad(padSheet)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ======================= RECORD DISTRIBUTION (FormSheet) ====================== */}
      <FormSheet
        open={distOpen}
        onOpenChange={setDistOpen}
        title="Record distribution"
        description="Logged against your volunteer profile — attribution is automatic."
        onSubmit={saveDist}
        submitLabel="Record"
        loading={savingDist}
        dirty={distTouched}
        size="lg"
      >
        <FormSection title="What & for whom" description="Type, beneficiary and campaign attribution.">
          <FieldGrid>
            <SelectField
              label="Type"
              required
              value={distForm.type}
              onChange={(v) => {
                setDistForm({ ...distForm, type: v });
                setDistTouched(true);
              }}
              options={DISTRIBUTION_TYPES.map((t) => ({ value: t, label: titleCase(t) }))}
            />
            <SelectField
              label="Campaign (optional)"
              value={distForm.campaignId || "NONE"}
              onChange={(v) => {
                setDistForm({ ...distForm, campaignId: v === "NONE" ? "" : v });
                setDistTouched(true);
              }}
              options={[
                { value: "NONE", label: "— No campaign —" },
                ...campaigns.map((c) => ({ value: c.id, label: c.title })),
              ]}
            />
          </FieldGrid>
          <Field
            label="Beneficiary"
            hint={
              beneficiaries.length > 0
                ? `${beneficiaries.length} on file — type in the filter box to narrow the list.`
                : "Directory unavailable — the record will be saved as a community hand-out."
            }
          >
            <div className="space-y-2">
              <Input
                value={benQuery}
                onChange={(e) => setBenQuery(e.target.value)}
                placeholder="Filter beneficiaries by name or city…"
                aria-label="Filter beneficiary list"
              />
              <select
                aria-label="Select beneficiary"
                value={distForm.beneficiaryId}
                onChange={(e) => {
                  setDistForm({ ...distForm, beneficiaryId: e.target.value });
                  setDistTouched(true);
                }}
                className={NATIVE_SELECT_CLS}
              >
                <option value="">Community hand-out (none)</option>
                {benFiltered.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.city ? ` — ${b.city}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </Field>
        </FormSection>

        <FormSection title="Quantity & value" description="Value persists now — it feeds exports and impact stats.">
          <FieldGrid>
            <TextField
              label="Quantity"
              required
              type="number"
              min="1"
              value={distForm.quantity}
              onChange={(v) => {
                setDistForm({ ...distForm, quantity: v });
                setDistTouched(true);
              }}
            />
            <TextField
              label="Value (₹)"
              prefix="₹"
              type="number"
              min="0"
              value={distForm.value}
              onChange={(v) => {
                setDistForm({ ...distForm, value: v });
                setDistTouched(true);
              }}
              hint={perUnitHint}
            />
          </FieldGrid>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Item breakdown (optional)</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDistForm((f) => ({ ...f, items: [...f.items, { name: "", qty: "1" }] }));
                  setDistTouched(true);
                }}
                aria-label="Add item row"
              >
                <Plus className="size-3.5" aria-hidden="true" /> Add item
              </Button>
            </div>
            {distForm.items.map((item, i) => {
              const inv = matchInventory(item.name);
              const q = Number(item.qty);
              const priceKnown = inv?.pricePerUnit != null && Number.isFinite(q) && q > 0;
              return (
                <div key={i} className="space-y-1">
                  <div className="grid grid-cols-[1fr_76px_36px] items-center gap-2">
                    <Input
                      value={item.name}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDistForm((f) => ({
                          ...f,
                          items: f.items.map((it, j) => (j === i ? { ...it, name: v } : it)),
                        }));
                        setDistTouched(true);
                      }}
                      placeholder="Rice (5kg bags)"
                      aria-label={`Item ${i + 1} name`}
                    />
                    <Input
                      type="number"
                      min={0}
                      value={item.qty}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDistForm((f) => ({
                          ...f,
                          items: f.items.map((it, j) => (j === i ? { ...it, qty: v } : it)),
                        }));
                        setDistTouched(true);
                      }}
                      aria-label={`Item ${i + 1} quantity`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setDistForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }));
                        setDistTouched(true);
                      }}
                      aria-label={`Remove item ${i + 1}`}
                      disabled={distForm.items.length <= 1}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                  {priceKnown ? (
                    <p className="text-[11px] text-muted-foreground">
                      Inventory match: {inv?.name} @ {formatINR(inv?.pricePerUnit ?? 0)}/{inv?.unit} · est{" "}
                      {formatINR((inv?.pricePerUnit ?? 0) * q)} for {q}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </FormSection>

        <FormSection title="Where & when" description="Location is required; the date defaults to today.">
          <TextField
            label="Location"
            required
            value={distForm.location}
            onChange={(v) => {
              setDistForm({ ...distForm, location: v });
              setDistTouched(true);
            }}
            placeholder="Ambedkar Nagar community hall"
          />
          <TextField
            label="Distributed on"
            type="date"
            value={distForm.distributedAt}
            onChange={(v) => {
              setDistForm({ ...distForm, distributedAt: v });
              setDistTouched(true);
            }}
          />
          <TextareaField
            label="Notes"
            rows={2}
            value={distForm.notes}
            onChange={(v) => {
              setDistForm({ ...distForm, notes: v });
              setDistTouched(true);
            }}
          />
        </FormSection>
      </FormSheet>

      {/* ========================= RECORD PAD DRIVE (FormSheet) ======================== */}
      <FormSheet
        open={padOpen}
        onOpenChange={setPadOpen}
        title="Record pad drive"
        description="School or community visit with pads distributed and an optional awareness session."
        onSubmit={savePad}
        submitLabel="Record drive"
        loading={savingPad}
        dirty={padTouched}
        size="md"
      >
        <FormSection title="Drive details" description="Where the drive happened and who led it.">
          <FieldGrid>
            <TextField
              label="Area"
              required
              value={padForm.area}
              onChange={(v) => {
                setPadForm({ ...padForm, area: v });
                setPadTouched(true);
              }}
              placeholder="Yelahanka, Bengaluru"
            />
            <TextField
              label="Distributed on"
              type="date"
              value={padForm.distributionDate}
              onChange={(v) => {
                setPadForm({ ...padForm, distributionDate: v });
                setPadTouched(true);
              }}
            />
          </FieldGrid>
          <Field
            label="School"
            hint={
              padForm.schoolName.trim() && !schoolKnown
                ? `“${padForm.schoolName.trim()}” is new — it will be registered in the coverage registry on save.`
                : "Type to search registered schools, or enter a new school name."
            }
          >
            <div className="relative">
              <Input
                value={padForm.schoolName}
                onChange={(e) => {
                  setPadForm({ ...padForm, schoolName: e.target.value });
                  setPadTouched(true);
                  setSchoolDdOpen(true);
                }}
                onFocus={() => setSchoolDdOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setSchoolDdOpen(false), 120);
                }}
                placeholder="Type to search or add a new school"
                aria-label="School name"
                role="combobox"
                aria-expanded={schoolDdOpen && schoolMatches.length > 0}
                aria-controls="school-listbox"
                autoComplete="off"
              />
              {schoolDdOpen && schoolMatches.length > 0 ? (
                <ul
                  id="school-listbox"
                  role="listbox"
                  aria-label="School suggestions"
                  className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md scrollbar-thin"
                >
                  {schoolMatches.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={padForm.schoolName === s.schoolName}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setPadForm((f) => ({ ...f, schoolName: s.schoolName }));
                          setPadTouched(true);
                          setSchoolDdOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <span className="min-w-0 truncate">{s.schoolName}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {s.visitsCount} visit{s.visitsCount === 1 ? "" : "s"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Field>
          <TextField
            label="Volunteer name"
            value={padForm.volunteerName}
            onChange={(v) => {
              setPadForm({ ...padForm, volunteerName: v });
              setPadTouched(true);
            }}
            placeholder="Recorded in the activity log"
            hint="The drive is also attributed to your volunteer profile automatically."
          />
        </FormSection>

        <FormSection title="Reach" description="Girls reached, pads distributed and session details.">
          <FieldGrid>
            <TextField
              label="Girls reached"
              required
              type="number"
              min="0"
              value={padForm.girlsCount}
              onChange={(v) => {
                setPadForm({ ...padForm, girlsCount: v });
                setPadTouched(true);
              }}
            />
            <TextField
              label="Pads distributed"
              required
              type="number"
              min="0"
              value={padForm.padsDistributed}
              onChange={(v) => {
                setPadForm({ ...padForm, padsDistributed: v });
                setPadTouched(true);
              }}
            />
          </FieldGrid>
          <SwitchField
            label="Awareness session conducted"
            hint="Menstrual health & hygiene talk."
            checked={padForm.awarenessSession}
            onChange={(v) => {
              setPadForm({ ...padForm, awarenessSession: v });
              setPadTouched(true);
            }}
          />
          {padForm.awarenessSession ? (
            <TextField
              label="Session attendees"
              type="number"
              min="0"
              value={padForm.sessionAttendees}
              onChange={(v) => {
                setPadForm({ ...padForm, sessionAttendees: v });
                setPadTouched(true);
              }}
            />
          ) : null}
          <TextareaField
            label="Notes"
            rows={2}
            value={padForm.notes}
            onChange={(v) => {
              setPadForm({ ...padForm, notes: v });
              setPadTouched(true);
            }}
          />
        </FormSection>
      </FormSheet>

      {/* ======================= REGISTER SCHOOL (FormSheet) ====================== */}
      <FormSheet
        open={schoolFormOpen}
        onOpenChange={setSchoolFormOpen}
        title="Register school"
        description="Adds the school to the coverage registry so it appears in the drive form picker."
        onSubmit={saveSchool}
        submitLabel="Register"
        loading={savingSchool}
        dirty={schoolForm.schoolName.trim() !== "" || schoolForm.city.trim() !== ""}
        size="sm"
      >
        <FormSection title="School" description="Existing schools are updated with a bumped visit count.">
          <TextField
            label="School name"
            required
            value={schoolForm.schoolName}
            onChange={(v) => setSchoolForm({ ...schoolForm, schoolName: v })}
            placeholder="Govt. High School, Yelahanka"
          />
          <FieldGrid>
            <TextField
              label="City"
              value={schoolForm.city}
              onChange={(v) => setSchoolForm({ ...schoolForm, city: v })}
              placeholder="Bengaluru"
            />
            <TextField
              label="Total girls"
              type="number"
              min="0"
              value={schoolForm.totalGirls}
              onChange={(v) => setSchoolForm({ ...schoolForm, totalGirls: v })}
              placeholder="0"
            />
          </FieldGrid>
          <FieldGrid>
            <TextField
              label="Contact person"
              value={schoolForm.contactPerson}
              onChange={(v) => setSchoolForm({ ...schoolForm, contactPerson: v })}
              placeholder="Headmistress"
            />
            <TextField
              label="Contact phone"
              value={schoolForm.contactPhone}
              onChange={(v) => setSchoolForm({ ...schoolForm, contactPhone: v })}
              inputMode="tel"
              placeholder="10-digit mobile"
            />
          </FieldGrid>
        </FormSection>
      </FormSheet>

      {/* ============================ DELETE CONFIRMS =========================== */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete this distribution?"
        recordName={
          deleteTarget
            ? `${titleCase(deleteTarget.type)} × ${deleteTarget.quantity} · ${deleteTarget.location ?? "unknown location"}`
            : null
        }
        description="This cannot be undone."
        confirmLabel="Delete"
        loading={false}
        onConfirm={removeDist}
      />

      <ConfirmDialog
        open={!!deletePad}
        onOpenChange={(o) => !o && setDeletePad(null)}
        title="Delete this pad drive?"
        recordName={
          deletePad
            ? `${deletePad.area} — ${deletePad.padsDistributed} pads, ${deletePad.girlsCount} girls`
            : null
        }
        description="This cannot be undone."
        confirmLabel="Delete"
        loading={false}
        onConfirm={removePad}
      />
    </div>
  );
}
