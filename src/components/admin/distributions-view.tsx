"use client";

/**
 * Distributions — the trust's welfare-delivery module.
 *
 * Tab 1 "General distributions": every aid type (food kits, medical, cash…)
 *   with beneficiary urgency, item-level tracking, volunteer assignment,
 *   campaign linkage, value estimation and impact math.
 * Tab 2 "Sanitary pads drives": the pads programme (schools, girls count,
 *   pads per girl, awareness sessions) — always lives inside Distributions.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  BarChart3,
  Calculator,
  CalendarDays,
  GraduationCap,
  Info,
  MapPin,
  Megaphone,
  MoreHorizontal,
  Package,
  Pencil,
  PawPrint,
  Plus,
  RefreshCw,
  School,
  Search,
  Shirt,
  Sparkles,
  Stethoscope,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import {
  financialYear,
  formatDate,
  formatDateTime,
  formatINR,
  formatINRCompact,
  titleCase,
} from "@/lib/format";
import { dateRule } from "@/lib/validators";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
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
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { CsvColumn, ExportMenu } from "@/components/shared/csv";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { useViewPref, ViewSwitcher } from "@/components/shared/view-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ---------------------------------- types ---------------------------------- */

interface DistributionRow {
  id: string;
  type: string;
  beneficiaryId?: string | null;
  volunteerId?: string | null;
  campaignId?: string | null;
  items?: string | null;
  quantity: number;
  value?: number | null;
  location?: string | null;
  photos?: string | null;
  notes?: string | null;
  distributedAt: string;
  createdAt?: string;
  beneficiary?: {
    id: string;
    name: string;
    category: string;
    urgencyLevel: string;
    city?: string | null;
    familyMembers: number;
  } | null;
  volunteer?: { id: string; user?: { name: string } | null } | null;
  campaign?: {
    id: string;
    title: string;
    accent?: string;
    status?: string;
    targetAmount?: number;
    raisedAmount?: number;
  } | null;
}

interface DistEnvelope {
  items: DistributionRow[];
  total: number;
  count: number;
  sumValue: number;
  sumQuantity: number;
  beneficiariesServed: number;
  avgItemsPerDrive: number;
}

interface PadDrive {
  id: string;
  schoolName?: string | null;
  area: string;
  girlsCount: number;
  padsDistributed: number;
  awarenessSession: boolean;
  sessionAttendees?: number | null;
  volunteerId?: string | null;
  volunteerName?: string | null;
  notes?: string | null;
  distributionDate: string;
  volunteer?: { id: string; name: string } | null;
}

interface PadEnvelope {
  items: PadDrive[];
  total: number;
  count: number;
  sumPads: number;
  sumGirls: number;
  sumAttendees: number;
  sessions: number;
  schools: number;
}

interface BeneficiaryLite {
  id: string;
  name: string;
  city?: string | null;
  category: string;
  urgencyLevel: string;
  familyMembers: number;
}

interface CampaignLite {
  id: string;
  title: string;
  status: string;
  targetAmount: number;
  raisedAmount: number;
}

interface VolunteerLite {
  id: string;
  status: string;
  assignedArea?: string | null;
  user: { name: string };
}

interface InventoryLite {
  id: string;
  name: string;
  unit: string;
  pricePerUnit?: number | null;
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

interface ItemRow {
  name: string;
  qty: string;
  unit: string;
}

interface DistForm {
  type: string;
  beneficiaryId: string;
  volunteerId: string;
  campaignId: string;
  quantity: string;
  value: string;
  location: string;
  distributedAt: string;
  items: ItemRow[];
  notes: string;
}

interface PadForm {
  schoolName: string;
  area: string;
  girlsCount: string;
  padsDistributed: string;
  awarenessSession: boolean;
  sessionAttendees: string;
  volunteerId: string;
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

type Errors = Record<string, string | null>;
type DateRange = "30" | "90" | "fy" | "all";

/* ------------------------------ chip styles ------------------------------- */

const TYPE_META: Record<
  string,
  { label: string; cls: string; icon: React.ElementType }
> = {
  FOOD: {
    label: "Food",
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    icon: UtensilsCrossed,
  },
  SANITARY_PADS: {
    label: "Sanitary Pads",
    cls: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-400",
    icon: Sparkles,
  },
  MEDICAL: {
    label: "Medical",
    cls: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
    icon: Stethoscope,
  },
  ANIMAL_FEED: {
    label: "Animal Feed",
    cls: "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-400",
    icon: PawPrint,
  },
  CLOTHING: {
    label: "Clothing",
    cls: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
    icon: Shirt,
  },
  EDUCATION_MATERIAL: {
    label: "Education",
    cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    icon: GraduationCap,
  },
  CASH: {
    label: "Cash Support",
    cls: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
    icon: Banknote,
  },
  OTHER: {
    label: "Other",
    cls: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
    icon: Package,
  },
};

const DISTRIBUTION_TYPES = Object.keys(TYPE_META);

const URGENCY_TONE: Record<string, Tone> = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "progress",
  LOW: "success",
};

/** Rough field estimates so numbers feel human — clearly labelled as approximations. */
const IMPACT_PER_TYPE: Record<string, (qty: number) => string> = {
  FOOD: (q) =>
    `≈ ${q} ration kit${q === 1 ? "" : "s"} — a family of 4 eats for ~${q * 15} days on this`,
  SANITARY_PADS: (q) => {
    const months = Math.floor(q / 18);
    return `≈ ${q} pad${q === 1 ? "" : "s"} — ${months} girl-month${months === 1 ? "" : "s"} of protection (18 pads ≈ 1 month)`;
  },
  MEDICAL: (q) =>
    `≈ ${q} patient-month${q === 1 ? "" : "s"} of medicine support (₹1,000 covers a month of BP/diabetes meds)`,
  EDUCATION_MATERIAL: (q) =>
    `≈ ${q} student${q === 1 ? "" : "s"} equipped with supplies for a term`,
  CLOTHING: (q) => `≈ ${q} garment${q === 1 ? "" : "s"} to someone who needed them today`,
  ANIMAL_FEED: (q) =>
    `≈ ${q} street dog${q === 1 ? "" : "s"} fed for a month (₹600 ≈ 1 dog-month of feed)`,
  CASH: () => "Direct cash assistance handed to the family",
  OTHER: (q) => `${q} unit${q === 1 ? "" : "s"} delivered to the field`,
};

const RATION_KIT_COST = 650;
const PADS_PER_GIRL_MONTH = 18;

const NATIVE_SELECT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

const RANGE_OPTIONS: Array<{ value: DateRange; label: string }> = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "fy", label: "This financial year" },
  { value: "all", label: "All time" },
];

const EMPTY_ITEM: ItemRow = { name: "", qty: "1", unit: "" };

const EMPTY_DIST_FORM: DistForm = {
  type: "FOOD",
  beneficiaryId: "",
  volunteerId: "",
  campaignId: "",
  quantity: "1",
  value: "",
  location: "",
  distributedAt: "",
  items: [{ ...EMPTY_ITEM }],
  notes: "",
};

const EMPTY_PAD_FORM: PadForm = {
  schoolName: "",
  area: "",
  girlsCount: "",
  padsDistributed: "",
  awarenessSession: false,
  sessionAttendees: "",
  volunteerId: "",
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

/* -------------------------------- utilities -------------------------------- */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local-time value for <input type="datetime-local"> */
function nowLocalInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Financial-year window (Apr → Mar) as ISO strings for API filters. */
function fyRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${y}-04-01T00:00:00`, to: `${y + 1}-03-31T23:59:59.999` };
}

function rangeToParams(range: DateRange): { from?: string; to?: string } {
  if (range === "all") return {};
  if (range === "fy") return fyRange();
  const days = range === "30" ? 30 : 90;
  const from = new Date(Date.now() - days * 86_400_000);
  return {
    from: `${from.getFullYear()}-${pad2(from.getMonth() + 1)}-${pad2(from.getDate())}T00:00:00`,
  };
}

interface ParsedItem {
  name?: string;
  qty?: number | string;
  unit?: string;
}

function parseItems(json: string | null | undefined): ParsedItem[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ParsedItem[]) : [];
  } catch {
    return [];
  }
}

function itemsSummary(json: string | null | undefined): string {
  const items = parseItems(json);
  if (!items.length) return "—";
  return items
    .map((i) => {
      const name = String(i?.name ?? i ?? "").trim();
      const qty = i?.qty;
      const unit = i?.unit ? ` ${i.unit}` : "";
      return `${name} ×${qty ?? 1}${unit}`;
    })
    .join(", ");
}

/* ---------------------------------- view ----------------------------------- */

export default function DistributionsView() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  /* ------------------------------- list state ------------------------------ */
  const [loading, setLoading] = useState(true);
  const [distRows, setDistRows] = useState<DistributionRow[]>([]);
  const [distTotals, setDistTotals] = useState<DistEnvelope | null>(null);
  const [padRows, setPadRows] = useState<PadDrive[]>([]);
  const [padTotals, setPadTotals] = useState<PadEnvelope | null>(null);

  /* FY aggregates for the KPI strip */
  const [kpi, setKpi] = useState<{
    count: number;
    sumValue: number;
    beneficiaries: number;
    avgItems: number;
    pads: number;
    girls: number;
    sessions: number;
  } | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  /* supporting data for forms/detail */
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryLite[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [volunteers, setVolunteers] = useState<VolunteerLite[]>([]);
  const [invItems, setInvItems] = useState<InventoryLite[]>([]);
  const [schools, setSchools] = useState<SchoolRow[]>([]);

  /* --------------------------------- tab ---------------------------------- */
  const [tab, setTab] = useState<"general" | "pads">("general");

  /* --------------------------- general tab filters ------------------------- */
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>("all");
  const [volunteerFilter, setVolunteerFilter] = useState("");
  const [viewDist, setViewDist] = useViewPref("distributions");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /* ------------------------------ pads filters ----------------------------- */
  const [padQuery, setPadQuery] = useState("");
  const [appliedPadQuery, setAppliedPadQuery] = useState("");
  const [padSession, setPadSession] = useState<"all" | "yes" | "no">("all");
  const [padRange, setPadRange] = useState<DateRange>("all");
  const [padVolunteer, setPadVolunteer] = useState("");
  const [viewPad, setViewPad] = useViewPref("pad-drives");
  const [padPage, setPadPage] = useState(1);
  const [padPageSize, setPadPageSize] = useState(25);

  /* --------------------------- general forms/sheets ------------------------ */
  const [detail, setDetail] = useState<DistributionRow | null>(null);
  const [distOpen, setDistOpen] = useState(false);
  const [editingDist, setEditingDist] = useState<DistributionRow | null>(null);
  const [distForm, setDistForm] = useState<DistForm>(EMPTY_DIST_FORM);
  const [distSnapshot, setDistSnapshot] = useState<DistForm>(EMPTY_DIST_FORM);
  const [distErrors, setDistErrors] = useState<Errors>({});
  const [benQuery, setBenQuery] = useState("");
  const [savingDist, setSavingDist] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DistributionRow | null>(null);
  const [deletingDist, setDeletingDist] = useState(false);

  /* multi-step wizard (create only) — 1 details · 2 items · 3 people · 4 review */
  const [wizardStep, setWizardStep] = useState(1);
  const WIZARD_STEPS = ["Details", "Items", "People & place", "Review"] as const;

  /* full-screen analytics slider */
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  /* ----------------------------- pad forms/sheets -------------------------- */
  const [padDetail, setPadDetail] = useState<PadDrive | null>(null);
  const [padOpen, setPadOpen] = useState(false);
  const [editingPad, setEditingPad] = useState<PadDrive | null>(null);
  const [padForm, setPadForm] = useState<PadForm>(EMPTY_PAD_FORM);
  const [padSnapshot, setPadSnapshot] = useState<PadForm>(EMPTY_PAD_FORM);
  const [padErrors, setPadErrors] = useState<Errors>({});
  const [schoolDdOpen, setSchoolDdOpen] = useState(false);
  const [savingPad, setSavingPad] = useState(false);
  const [deletePad, setDeletePad] = useState<PadDrive | null>(null);
  const [deletingPad, setDeletingPad] = useState(false);

  /* ----------------------------- school registry --------------------------- */
  const [schoolFormOpen, setSchoolFormOpen] = useState(false);
  const [schoolForm, setSchoolForm] = useState<SchoolForm>(EMPTY_SCHOOL_FORM);
  const [savingSchool, setSavingSchool] = useState(false);

  /* ================================ loading ================================ */

  const loadDist = useCallback(async () => {
    const sp = new URLSearchParams();
    if (appliedQuery.trim()) sp.set("q", appliedQuery.trim());
    if (typeFilter.length) sp.set("type", typeFilter.join(","));
    const r = rangeToParams(range);
    if (r.from) sp.set("from", r.from);
    if (r.to) sp.set("to", r.to);
    if (volunteerFilter) sp.set("volunteerId", volunteerFilter);
    sp.set("limit", "500");
    sp.set("withTotals", "1");
    try {
      const data = await get<DistEnvelope>(`/api/distributions?${sp.toString()}`);
      setDistRows(Array.isArray(data?.items) ? data.items : []);
      setDistTotals(data ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load distributions");
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, typeFilter, range, volunteerFilter]);

  const loadPads = useCallback(async () => {
    const sp = new URLSearchParams();
    if (appliedPadQuery.trim()) sp.set("q", appliedPadQuery.trim());
    if (padSession !== "all") sp.set("session", padSession === "yes" ? "1" : "0");
    const r = rangeToParams(padRange);
    if (r.from) sp.set("from", r.from);
    if (r.to) sp.set("to", r.to);
    if (padVolunteer) sp.set("volunteerId", padVolunteer);
    sp.set("limit", "500");
    sp.set("withTotals", "1");
    try {
      const data = await get<PadEnvelope>(`/api/pad-distributions?${sp.toString()}`);
      setPadRows(Array.isArray(data?.items) ? data.items : []);
      setPadTotals(data ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load pad drives");
    } finally {
      setLoading(false);
    }
  }, [appliedPadQuery, padSession, padRange, padVolunteer]);

  const loadKpis = useCallback(async () => {
    const { from, to } = fyRange();
    const results = await Promise.allSettled([
      get<DistEnvelope>(
        `/api/distributions?withTotals=1&limit=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      ),
      get<PadEnvelope>(
        `/api/pad-distributions?withTotals=1&limit=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      ),
    ]);
    const d = results[0].status === "fulfilled" ? results[0].value : null;
    const p = results[1].status === "fulfilled" ? results[1].value : null;
    setKpi({
      count: d?.count ?? 0,
      sumValue: d?.sumValue ?? 0,
      beneficiaries: d?.beneficiariesServed ?? 0,
      avgItems: d?.avgItemsPerDrive ?? 0,
      pads: p?.sumPads ?? 0,
      girls: p?.sumGirls ?? 0,
      sessions: p?.sessions ?? 0,
    });
    setKpiLoading(false);
  }, []);

  const loadSupport = useCallback(async () => {
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
    if (isAdmin) {
      get<VolunteerLite[]>("/api/volunteers")
        .then((rows) => setVolunteers(Array.isArray(rows) ? rows : []))
        .catch(() => setVolunteers([]));
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadSupport();
  }, [loadSupport]);

  useEffect(() => {
    void loadDist();
    void loadKpis();
  }, [loadDist, loadKpis]);

  useEffect(() => {
    void loadPads();
  }, [loadPads]);

  /* debounce searches */
  useEffect(() => {
    const t = window.setTimeout(() => {
      setAppliedQuery(query);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setAppliedPadQuery(padQuery);
      setPadPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [padQuery]);

  const refreshAll = useCallback(() => {
    void loadDist();
    void loadPads();
    void loadKpis();
  }, [loadDist, loadPads, loadKpis]);

  /* ============================== derived data ============================= */

  const pages = Math.max(1, Math.ceil(distRows.length / pageSize));
  const pageSafe = Math.min(page, pages);
  const pagedDist = distRows.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  const padPages = Math.max(1, Math.ceil(padRows.length / padPageSize));
  const padPageSafe = Math.min(padPage, padPages);
  const pagedPads = padRows.slice(
    (padPageSafe - 1) * padPageSize,
    padPageSafe * padPageSize
  );

  const benFiltered = useMemo(() => {
    const q = benQuery.trim().toLowerCase();
    if (!q) return beneficiaries.slice(0, 300);
    return beneficiaries
      .filter(
        (b) =>
          b.name.toLowerCase().includes(q) || (b.city ?? "").toLowerCase().includes(q)
      )
      .slice(0, 300);
  }, [beneficiaries, benQuery]);

  const selectedBeneficiary = useMemo(
    () => beneficiaries.find((b) => b.id === distForm.beneficiaryId) ?? null,
    [beneficiaries, distForm.beneficiaryId]
  );

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

  const itemTotals = useMemo(() => {
    let lines = 0;
    let units = 0;
    let estValue = 0;
    let priced = true;
    for (const it of distForm.items) {
      if (!it.name.trim()) continue;
      lines += 1;
      const q = Number(it.qty);
      if (Number.isFinite(q) && q > 0) units += q;
      const inv = matchInventory(it.name);
      if (inv?.pricePerUnit != null && Number.isFinite(q) && q > 0) {
        estValue += inv.pricePerUnit * q;
      } else if (it.name.trim()) {
        priced = false;
      }
    }
    return { lines, units, estValue, priced };
  }, [distForm.items, matchInventory]);

  const distValNum = Number(distForm.value);
  const distQtyNum = Math.trunc(Number(distForm.quantity)) || 0;
  const perUnitHint =
    distForm.value.trim() !== "" && Number.isFinite(distValNum) && distQtyNum > 0
      ? `≈ ${formatINR(distValNum / distQtyNum)} per unit`
      : "Estimated market value — feeds exports, reports and impact stats.";

  const schoolMatches = useMemo(() => {
    const active = schools.filter((s) => s.isActive);
    const q = padForm.schoolName.trim().toLowerCase();
    if (!q) return active.slice(0, 50);
    const starts = active.filter((s) => s.schoolName.toLowerCase().startsWith(q));
    const rest = active.filter(
      (s) =>
        !s.schoolName.toLowerCase().startsWith(q) &&
        s.schoolName.toLowerCase().includes(q)
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

  const distDirty = useMemo(
    () => JSON.stringify(distForm) !== JSON.stringify(distSnapshot),
    [distForm, distSnapshot]
  );
  const padDirty = useMemo(
    () => JSON.stringify(padForm) !== JSON.stringify(padSnapshot),
    [padForm, padSnapshot]
  );

  const distFiltersActive =
    appliedQuery.trim() !== "" ||
    typeFilter.length > 0 ||
    range !== "all" ||
    volunteerFilter !== "";
  const padFiltersActive =
    appliedPadQuery.trim() !== "" || padSession !== "all" || padRange !== "all" || padVolunteer !== "";

  /* ============================== mutations ================================ */

  const openDistCreate = () => {
    const form = { ...EMPTY_DIST_FORM, distributedAt: nowLocalInput() };
    setDistForm(form);
    setDistSnapshot(form);
    setDistErrors({});
    setEditingDist(null);
    setBenQuery("");
    setWizardStep(1);
    setDistOpen(true);
  };

  /** Row-level "Record similar" — pre-seeds the wizard from an existing row. */
  const openDistCreateFrom = (row: DistributionRow) => {
    const items = parseItems(row.items);
    const form: DistForm = {
      ...EMPTY_DIST_FORM,
      type: DISTRIBUTION_TYPES.includes(row.type) ? row.type : "OTHER",
      beneficiaryId: row.beneficiaryId ?? "",
      volunteerId: row.volunteerId ?? "",
      campaignId: row.campaignId ?? "",
      location: row.location ?? "",
      distributedAt: nowLocalInput(),
      items: items.length
        ? items.map((i) => ({
            name: String(i?.name ?? ""),
            qty: String(i?.qty ?? 1),
            unit: String(i?.unit ?? ""),
          }))
        : [{ ...EMPTY_ITEM }],
    };
    setDistForm(form);
    setDistSnapshot({ ...EMPTY_DIST_FORM, distributedAt: nowLocalInput() });
    setDistErrors({});
    setEditingDist(null);
    setBenQuery("");
    setWizardStep(1);
    setDistOpen(true);
    toast.info("Pre-filled from the selected record — adjust and save");
  };

  const openDistEdit = (row: DistributionRow) => {
    const items = parseItems(row.items);
    const form: DistForm = {
      type: DISTRIBUTION_TYPES.includes(row.type) ? row.type : "OTHER",
      beneficiaryId: row.beneficiaryId ?? "",
      volunteerId: row.volunteerId ?? "",
      campaignId: row.campaignId ?? "",
      quantity: String(row.quantity ?? 1),
      value: row.value != null ? String(row.value) : "",
      location: row.location ?? "",
      distributedAt: toLocalInput(row.distributedAt) || nowLocalInput(),
      items: items.length
        ? items.map((i) => ({
            name: String(i?.name ?? ""),
            qty: String(i?.qty ?? 1),
            unit: String(i?.unit ?? ""),
          }))
        : [{ ...EMPTY_ITEM }],
      notes: row.notes ?? "",
    };
    setDistForm(form);
    setDistSnapshot(form);
    setDistErrors({});
    setEditingDist(row);
    setDetail(null);
    setBenQuery("");
    setWizardStep(1);
    setDistOpen(true);
  };

  /** Validate only the fields that belong to a given wizard step. */
  const validateDistStep = (step: number): boolean => {
    const errs: Errors = {};
    if (step === 1) {
      if (!distForm.location.trim()) errs.location = "Location is required";
      const qty = Math.trunc(Number(distForm.quantity));
      if (!Number.isFinite(qty) || qty < 1)
        errs.quantity = "Quantity must be a whole number of at least 1";
      if (distForm.value.trim() !== "") {
        const v = Number(distForm.value);
        if (!Number.isFinite(v) || v < 0) errs.value = "Enter a valid amount (≥ 0)";
      }
      const dateErr = dateRule(true)(distForm.distributedAt);
      if (dateErr) errs.distributedAt = dateErr;
    }
    if (step === 2) {
      distForm.items.forEach((it, i) => {
        if (!it.name.trim() && it.qty.trim() === "") return;
        if (!it.name.trim()) {
          errs[`item-${i}`] = "Item name is required";
          return;
        }
        const q = Number(it.qty);
        if (!Number.isFinite(q) || q <= 0)
          errs[`item-${i}`] = "Quantity must be a positive number";
      });
    }
    setDistErrors(errs);
    return Object.values(errs).every((v) => !v);
  };

  const wizardNext = () => {
    if (!validateDistStep(wizardStep)) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setWizardStep((s) => Math.min(4, s + 1));
  };

  const wizardBack = () => setWizardStep((s) => Math.max(1, s - 1));

  const validateDist = (): boolean => {
    const errs: Errors = {};
    if (!distForm.location.trim()) errs.location = "Location is required";
    const qty = Math.trunc(Number(distForm.quantity));
    if (!Number.isFinite(qty) || qty < 1)
      errs.quantity = "Quantity must be a whole number of at least 1";
    if (distForm.value.trim() !== "") {
      const v = Number(distForm.value);
      if (!Number.isFinite(v) || v < 0) errs.value = "Enter a valid amount (≥ 0)";
    }
    const dateErr = dateRule(true)(distForm.distributedAt);
    if (dateErr) errs.distributedAt = dateErr;
    distForm.items.forEach((it, i) => {
      if (!it.name.trim() && it.qty.trim() === "") return;
      if (!it.name.trim()) {
        errs[`item-${i}`] = "Item name is required";
        return;
      }
      const q = Number(it.qty);
      if (!Number.isFinite(q) || q <= 0)
        errs[`item-${i}`] = "Quantity must be a positive number";
    });
    setDistErrors(errs);
    return Object.values(errs).every((v) => !v);
  };

  const saveDist = async () => {
    // Full validation regardless of entry path (wizard jumps are step-checked).
    if (!validateDist()) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setSavingDist(true);
    try {
      const items = distForm.items
        .filter((i) => i.name.trim())
        .map((i) => ({
          name: i.name.trim(),
          qty: Number(i.qty) || 1,
          ...(i.unit.trim() ? { unit: i.unit.trim() } : {}),
        }));
      const payload = {
        type: distForm.type,
        beneficiaryId: distForm.beneficiaryId || undefined,
        volunteerId: distForm.volunteerId || undefined,
        campaignId: distForm.campaignId || undefined,
        quantity: Math.trunc(Number(distForm.quantity)),
        items,
        value: distForm.value === "" ? undefined : Number(distForm.value),
        location: distForm.location.trim(),
        distributedAt: distForm.distributedAt || undefined,
        notes: distForm.notes.trim() || undefined,
      };
      if (editingDist) {
        await patch(`/api/distributions/${editingDist.id}`, payload);
        toast.success("Distribution updated");
      } else {
        await post("/api/distributions", payload);
        toast.success("Distribution recorded");
      }
      setDistOpen(false);
      setWizardStep(1);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingDist(false);
    }
  };

  const removeDist = async () => {
    if (!deleteTarget) return;
    setDeletingDist(true);
    const id = deleteTarget.id;
    // optimistic removal
    setDistRows((rows) => rows.filter((r) => r.id !== id));
    setDetail(null);
    try {
      await del(`/api/distributions/${id}`);
      toast.success("Distribution deleted");
      setDeleteTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingDist(false);
      refreshAll();
    }
  };

  const openPadCreate = () => {
    const form = { ...EMPTY_PAD_FORM, distributionDate: todayIso() };
    setPadForm(form);
    setPadSnapshot(form);
    setPadErrors({});
    setEditingPad(null);
    setSchoolDdOpen(false);
    setPadOpen(true);
  };

  const openPadEdit = (row: PadDrive) => {
    const form: PadForm = {
      schoolName: row.schoolName ?? "",
      area: row.area ?? "",
      girlsCount: String(row.girlsCount ?? 0),
      padsDistributed: String(row.padsDistributed ?? 0),
      awarenessSession: Boolean(row.awarenessSession),
      sessionAttendees: row.sessionAttendees != null ? String(row.sessionAttendees) : "",
      volunteerId: row.volunteerId ?? "",
      volunteerName: row.volunteerName ?? "",
      distributionDate: toLocalInput(row.distributionDate).slice(0, 10) || todayIso(),
      notes: row.notes ?? "",
    };
    setPadForm(form);
    setPadSnapshot(form);
    setPadErrors({});
    setEditingPad(row);
    setPadDetail(null);
    setSchoolDdOpen(false);
    setPadOpen(true);
  };

  const padGirlsNum = Math.trunc(Number(padForm.girlsCount)) || 0;
  const padPadsNum = Math.trunc(Number(padForm.padsDistributed)) || 0;
  const padPerGirl =
    padGirlsNum > 0 && padPadsNum > 0
      ? Math.round((padPadsNum / padGirlsNum) * 10) / 10
      : null;

  const validatePad = (): boolean => {
    const padErrs: Errors = {};
    if (!padForm.area.trim()) padErrs.area = "Area is required";
    if (padForm.girlsCount.trim() === "")
      padErrs.girlsCount = "Girls reached is required (0 if none)";
    else if (!Number.isFinite(Number(padForm.girlsCount)) || padGirlsNum < 0)
      padErrs.girlsCount = "Girls count must be 0 or more";
    if (padForm.padsDistributed.trim() === "")
      padErrs.padsDistributed = "Pads distributed is required (0 if none)";
    else if (!Number.isFinite(Number(padForm.padsDistributed)) || padPadsNum < 0)
      padErrs.padsDistributed = "Pads distributed must be 0 or more";
    if (padForm.sessionAttendees !== "") {
      const att = Math.trunc(Number(padForm.sessionAttendees));
      if (!Number.isFinite(att) || att < 0)
        padErrs.sessionAttendees = "Attendees must be 0 or more";
    }
    const dateErr = dateRule(true)(padForm.distributionDate);
    if (dateErr) padErrs.distributionDate = dateErr;
    setPadErrors(padErrs);
    return Object.values(padErrs).every((v) => !v);
  };

  const savePad = async () => {
    if (!validatePad()) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setSavingPad(true);
    try {
      const payload = {
        area: padForm.area.trim(),
        schoolName: padForm.schoolName.trim() || undefined,
        girlsCount: padGirlsNum,
        padsDistributed: padPadsNum,
        awarenessSession: padForm.awarenessSession,
        sessionAttendees:
          padForm.sessionAttendees === ""
            ? undefined
            : Math.trunc(Number(padForm.sessionAttendees)),
        volunteerId: padForm.volunteerId || undefined,
        volunteerName: padForm.volunteerName.trim() || undefined,
        distributionDate: padForm.distributionDate || undefined,
        notes: padForm.notes.trim() || undefined,
      };
      if (editingPad) {
        await patch(`/api/pad-distributions/${editingPad.id}`, payload);
        toast.success("Pad drive updated");
      } else {
        await post("/api/pad-distributions", payload);
        toast.success("Pad drive recorded");
      }

      // register brand-new schools in the coverage registry (best-effort)
      const school = padForm.schoolName.trim();
      if (!editingPad && school && !schoolKnown) {
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

      setPadOpen(false);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingPad(false);
    }
  };

  const removePad = async () => {
    if (!deletePad) return;
    setDeletingPad(true);
    const id = deletePad.id;
    setPadRows((rows) => rows.filter((r) => r.id !== id));
    setPadDetail(null);
    try {
      await del(`/api/pad-distributions/${id}`);
      toast.success("Pad drive deleted");
      setDeletePad(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingPad(false);
      refreshAll();
    }
  };

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
        totalGirls:
          schoolForm.totalGirls === ""
            ? 0
            : Math.trunc(Number(schoolForm.totalGirls)),
        lastVisited: todayIso(),
      });
      toast.success(`School "${schoolForm.schoolName.trim()}" registered`);
      setSchoolFormOpen(false);
      loadSupport();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Register failed");
    } finally {
      setSavingSchool(false);
    }
  };

  /* ================================== CSV ================================== */

  const distCsv: CsvColumn<DistributionRow>[] = useMemo(
    () => [
      { header: "Date", value: (d) => formatDate(d.distributedAt) },
      { header: "Type", value: (d) => titleCase(d.type) },
      { header: "Beneficiary", value: (d) => d.beneficiary?.name ?? "Community" },
      { header: "Category", value: (d) => titleCase(d.beneficiary?.category ?? "") },
      { header: "Urgency", value: (d) => titleCase(d.beneficiary?.urgencyLevel ?? "") },
      { header: "Items", value: (d) => itemsSummary(d.items) },
      { header: "Quantity", value: (d) => d.quantity },
      { header: "Value (INR)", value: (d) => d.value ?? "" },
      { header: "Location", value: (d) => d.location ?? "" },
      { header: "Volunteer", value: (d) => d.volunteer?.user?.name ?? "" },
      { header: "Campaign", value: (d) => d.campaign?.title ?? "" },
      { header: "Notes", value: (d) => d.notes ?? "" },
    ],
    []
  );

  const padCsv: CsvColumn<PadDrive>[] = useMemo(
    () => [
      { header: "Date", value: (p) => formatDate(p.distributionDate) },
      { header: "Area", value: (p) => p.area },
      { header: "School", value: (p) => p.schoolName ?? "Community visit" },
      { header: "Girls Reached", value: (p) => p.girlsCount },
      { header: "Pads Distributed", value: (p) => p.padsDistributed },
      {
        header: "Pads per Girl",
        value: (p) =>
          p.girlsCount > 0
            ? Math.round((p.padsDistributed / p.girlsCount) * 10) / 10
            : "",
      },
      { header: "Awareness Session", value: (p) => (p.awarenessSession ? "Yes" : "No") },
      { header: "Attendees", value: (p) => p.sessionAttendees ?? "" },
      { header: "Volunteer", value: (p) => p.volunteer?.name ?? p.volunteerName ?? "" },
      { header: "Notes", value: (p) => p.notes ?? "" },
    ],
    []
  );

  /* ============================== small pieces ============================= */

  const typeChip = (t: string, className?: string) => {
    const meta = TYPE_META[t] ?? TYPE_META.OTHER;
    const Icon = meta.icon;
    return (
      <Badge
        variant="outline"
        className={cn("gap-1 font-medium whitespace-nowrap", meta.cls, className)}
      >
        <Icon className="size-3" aria-hidden="true" />
        {meta.label}
      </Badge>
    );
  };

  const urgencyBadge = (level?: string | null) =>
    level ? (
      <StatusBadge tone={URGENCY_TONE[level] ?? "neutral"}>{titleCase(level)}</StatusBadge>
    ) : null;

  const rowMenu = (row: DistributionRow) => (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Actions for ${titleCase(row.type)} distribution`}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setDetail(row)}>
            <Info className="size-4" aria-hidden="true" /> View details
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openDistCreateFrom(row)}>
            <Plus className="size-4" aria-hidden="true" /> Record distribution here
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openDistEdit(row)}>
            <Pencil className="size-4" aria-hidden="true" /> Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
            onClick={() => setDeleteTarget(row)}
          >
            <Trash2 className="size-4" aria-hidden="true" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const padRowMenu = (row: PadDrive) => (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Actions for pad drive in ${row.area}`}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => setPadDetail(row)}>
            <Info className="size-4" aria-hidden="true" /> View details
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openPadEdit(row)}>
            <Pencil className="size-4" aria-hidden="true" /> Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
            onClick={() => setDeletePad(row)}
          >
            <Trash2 className="size-4" aria-hidden="true" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const clearDistFilters = () => {
    setQuery("");
    setTypeFilter([]);
    setRange("all");
    setVolunteerFilter("");
    setPage(1);
  };

  const clearPadFilters = () => {
    setPadQuery("");
    setPadSession("all");
    setPadRange("all");
    setPadVolunteer("");
    setPadPage(1);
  };

  const distColumns: DataTableColumn<DistributionRow>[] = [
    {
      key: "date",
      header: "Date",
      className: "w-[6.5rem]",
      accessor: (r) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDate(r.distributedAt)}
        </span>
      ),
    },
    { key: "type", header: "Type", accessor: (r) => typeChip(r.type) },
    {
      key: "beneficiary",
      header: "Beneficiary",
      accessor: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {r.beneficiary?.name ?? "Community hand-out"}
          </p>
          {r.beneficiary ? (
            <p className="truncate text-xs text-muted-foreground">
              {titleCase(r.beneficiary.category)} · family of {r.beneficiary.familyMembers}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "urgency",
      header: "Urgency",
      hideBelow: "lg",
      accessor: (r) =>
        r.beneficiary ? (
          urgencyBadge(r.beneficiary.urgencyLevel)
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "volunteer",
      header: "Volunteer",
      hideBelow: "md",
      accessor: (r) => (
        <span className="text-muted-foreground">
          {r.volunteer?.user?.name ?? "—"}
        </span>
      ),
    },
    {
      key: "items",
      header: "Items",
      hideBelow: "lg",
      accessor: (r) => (
        <span className="block max-w-56 truncate text-muted-foreground" title={itemsSummary(r.items)}>
          {itemsSummary(r.items)}
        </span>
      ),
    },
    {
      key: "quantity",
      header: "Qty",
      align: "right",
      mono: true,
      accessor: (r) => r.quantity.toLocaleString("en-IN"),
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      mono: true,
      accessor: (r) =>
        r.value != null ? (
          <span className="font-medium">{formatINR(r.value)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "location",
      header: "Location",
      hideBelow: "sm",
      accessor: (r) => (
        <span className="block max-w-44 truncate text-muted-foreground" title={r.location ?? ""}>
          {r.location || "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12",
      accessor: (r) => rowMenu(r),
    },
  ];

  const padColumns: DataTableColumn<PadDrive>[] = [
    {
      key: "date",
      header: "Date",
      className: "w-[6.5rem]",
      accessor: (p) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDate(p.distributionDate)}
        </span>
      ),
    },
    {
      key: "area",
      header: "Area",
      accessor: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{p.area}</p>
          <p className="truncate text-xs text-muted-foreground">
            {p.schoolName || "Community visit"}
          </p>
        </div>
      ),
    },
    {
      key: "school",
      header: "School",
      hideBelow: "md",
      accessor: (p) => (
        <span className="block max-w-52 truncate text-muted-foreground" title={p.schoolName ?? ""}>
          {p.schoolName || "—"}
        </span>
      ),
    },
    {
      key: "girls",
      header: "Girls",
      align: "right",
      mono: true,
      accessor: (p) => p.girlsCount.toLocaleString("en-IN"),
    },
    {
      key: "pads",
      header: "Pads",
      align: "right",
      mono: true,
      accessor: (p) => (
        <span className="font-medium">{p.padsDistributed.toLocaleString("en-IN")}</span>
      ),
    },
    {
      key: "perGirl",
      header: "Per girl",
      align: "right",
      mono: true,
      hideBelow: "lg",
      accessor: (p) =>
        p.girlsCount > 0
          ? (Math.round((p.padsDistributed / p.girlsCount) * 10) / 10).toFixed(1)
          : "—",
    },
    {
      key: "session",
      header: "Session",
      hideBelow: "sm",
      accessor: (p) =>
        p.awarenessSession ? (
          <Badge
            variant="outline"
            className="border-teal-500/30 bg-teal-500/10 font-medium text-teal-700 dark:text-teal-400"
          >
            Session{p.sessionAttendees != null ? ` · ${p.sessionAttendees}` : ""}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "volunteer",
      header: "Volunteer",
      hideBelow: "md",
      accessor: (p) => (
        <span className="text-muted-foreground">
          {p.volunteer?.name ?? p.volunteerName ?? "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12",
      accessor: (p) => padRowMenu(p),
    },
  ];

  /* ================================= render ================================ */

  const fyLabel = financialYear(new Date());
  const girlMonths = Math.floor((kpi?.pads ?? 0) / PADS_PER_GIRL_MONTH);
  const familyKits = Math.floor((kpi?.sumValue ?? 0) / RATION_KIT_COST);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Distributions"
        description="Every kit, pad drive and hand-out the trust delivers — with beneficiaries, volunteers and impact math."
        icon={<Package className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={refreshAll} aria-label="Refresh distributions">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
            <Button variant="outline" onClick={() => setAnalyticsOpen(true)}>
              <BarChart3 className="size-4" aria-hidden="true" /> Analytics
            </Button>
          </>
        }
      />

      {/* ============================== KPI strip ============================= */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Distributions"
          value={(kpi?.count ?? 0).toLocaleString("en-IN")}
          hint={`recorded this FY (${fyLabel})`}
          icon={<Package className="size-5" aria-hidden="true" />}
          accent="emerald"
          loading={kpiLoading}
        />
        <StatCard
          label="Value disbursed"
          value={formatINRCompact(kpi?.sumValue ?? 0)}
          hint="estimated market value this FY"
          icon={<Wallet className="size-5" aria-hidden="true" />}
          accent="orange"
          loading={kpiLoading}
        />
        <StatCard
          label="Beneficiaries served"
          value={(kpi?.beneficiaries ?? 0).toLocaleString("en-IN")}
          hint="registered cases reached this FY"
          icon={<Users className="size-5" aria-hidden="true" />}
          accent="teal"
          loading={kpiLoading}
        />
        <StatCard
          label="Pads distributed"
          value={(kpi?.pads ?? 0).toLocaleString("en-IN")}
          hint={
            girlMonths > 0
              ? `≈ ${girlMonths.toLocaleString("en-IN")} girl-months of protection`
              : "via school & community drives"
          }
          icon={<Sparkles className="size-5" aria-hidden="true" />}
          accent="pink"
          loading={kpiLoading}
        />
        <StatCard
          label="Avg items / kit drive"
          value={kpi?.avgItems ? kpi.avgItems.toFixed(1) : "—"}
          hint="item lines per recorded drive"
          icon={<Calculator className="size-5" aria-hidden="true" />}
          accent="amber"
          loading={kpiLoading}
        />
      </div>

      {/* ============================ impact math ============================ */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground"
        aria-label="Impact math"
      >
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          <Calculator className="size-3.5 text-primary" aria-hidden="true" /> Impact math
        </span>
        <span>1 ration kit (₹{RATION_KIT_COST}) = a family of 4 fed for 15 days</span>
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <span>
          {formatINRCompact(kpi?.sumValue ?? 0)} disbursed ≈{" "}
          <strong className="font-semibold text-foreground">
            {familyKits.toLocaleString("en-IN")}
          </strong>{" "}
          family kits
        </span>
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <span>
          {PADS_PER_GIRL_MONTH} pads = 1 girl-month ·{" "}
          {(kpi?.pads ?? 0).toLocaleString("en-IN")} pads ≈{" "}
          <strong className="font-semibold text-foreground">
            {girlMonths.toLocaleString("en-IN")}
          </strong>{" "}
          girl-months
        </span>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "general" | "pads")}>
        <TabsList className="h-auto w-full flex-wrap sm:w-auto">
          <TabsTrigger value="general">
            General distributions
            <Badge variant="outline" className="ml-1.5 px-1.5 tabular-nums">
              {distRows.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="pads">
            Sanitary pads drives
            <Badge variant="outline" className="ml-1.5 px-1.5 tabular-nums">
              {padRows.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* =========================== GENERAL TAB =========================== */}
        <TabsContent value="general" className="mt-4 space-y-4">
          {/* filters bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search beneficiary, location, items…"
                aria-label="Search distributions"
                className="pl-8"
              />
            </div>

            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Filter by distribution type"
            >
              <button
                type="button"
                aria-pressed={typeFilter.length === 0}
                onClick={() => {
                  setTypeFilter([]);
                  setPage(1);
                }}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  typeFilter.length === 0
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-accent"
                )}
              >
                All
              </button>
              {DISTRIBUTION_TYPES.map((t) => {
                const active = typeFilter.includes(t);
                const meta = TYPE_META[t];
                const Icon = meta.icon;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setTypeFilter((prev) =>
                        prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                      );
                      setPage(1);
                    }}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? meta.cls
                        : "border-border bg-background text-muted-foreground hover:bg-accent"
                    )}
                  >
                    <Icon className="size-3" aria-hidden="true" />
                    {meta.label}
                  </button>
                );
              })}
            </div>

            <select
              aria-label="Filter by date range"
              value={range}
              onChange={(e) => {
                setRange(e.target.value as DateRange);
                setPage(1);
              }}
              className={cn(NATIVE_SELECT_CLS, "w-full sm:w-44")}
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {isAdmin ? (
              <select
                aria-label="Filter by volunteer"
                value={volunteerFilter}
                onChange={(e) => {
                  setVolunteerFilter(e.target.value);
                  setPage(1);
                }}
                className={cn(NATIVE_SELECT_CLS, "w-full sm:w-48")}
              >
                <option value="">All volunteers</option>
                {volunteers.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.user.name}
                    {v.assignedArea ? ` — ${v.assignedArea}` : ""}
                  </option>
                ))}
              </select>
            ) : null}

            {distFiltersActive ? (
              <Button variant="ghost" size="sm" onClick={clearDistFilters}>
                <X className="size-3.5" aria-hidden="true" /> Clear
              </Button>
            ) : null}

            <span className="text-xs tabular-nums text-muted-foreground">
              {distRows.length} result{distRows.length === 1 ? "" : "s"}
            </span>

            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <ExportMenu
                columns={distCsv}
                rows={distRows}
                filename="uar-distributions"
                disabled={distRows.length === 0}
              />
              <ViewSwitcher value={viewDist} onChange={setViewDist} />
              <Button size="sm" onClick={openDistCreate}>
                <Plus className="size-4" aria-hidden="true" /> Record distribution
              </Button>
            </div>
          </div>

          {viewDist === "table" ? (
            <DataTable
              columns={distColumns}
              rows={pagedDist}
              rowKey={(r) => r.id}
              loading={loading}
              skeletonRows={8}
              height="fill"
              fillOffset={470}
              onRowClick={(r) => setDetail(r)}
              page={pageSafe}
              pages={pages}
              total={distRows.length}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(n) => {
                setPageSize(n);
                setPage(1);
              }}
              itemLabel="distributions"
              empty={
                <EmptyState
                  icon={<Package className="size-8" aria-hidden="true" />}
                  title={
                    distFiltersActive
                      ? "No distributions match these filters"
                      : "No distributions recorded yet"
                  }
                  hint="Record a field distribution so stock levels, beneficiary history and impact stats stay accurate."
                >
                  <Button variant="outline" onClick={openDistCreate}>
                    <Plus className="size-4" aria-hidden="true" /> Record distribution
                  </Button>
                </EmptyState>
              }
            />
          ) : loading ? (
            viewDist === "grid" ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-44 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            )
          ) : distRows.length === 0 ? (
            <EmptyState
              icon={<Package className="size-8" aria-hidden="true" />}
              title={
                distFiltersActive
                  ? "No distributions match these filters"
                  : "No distributions recorded yet"
              }
              hint="Record a field distribution so stock levels, beneficiary history and impact stats stay accurate."
            >
              <Button variant="outline" onClick={openDistCreate}>
                <Plus className="size-4" aria-hidden="true" /> Record distribution
              </Button>
            </EmptyState>
          ) : viewDist === "grid" ? (
            <div
              className="grid max-h-[36rem] gap-4 overflow-y-auto scrollbar-thin sm:grid-cols-2 xl:grid-cols-3"
              role="list"
              aria-label="Distributions"
            >
              {pagedDist.map((d) => {
                const meta = TYPE_META[d.type] ?? TYPE_META.OTHER;
                const Icon = meta.icon;
                return (
                  <div
                    key={d.id}
                    role="listitem"
                    className="flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-accent/40"
                    onClick={() => setDetail(d)}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-9 items-center justify-center rounded-lg border",
                          meta.cls
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      {typeChip(d.type)}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {formatDate(d.distributedAt)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        {d.beneficiary?.name ?? "Community hand-out"} × {d.quantity}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.location || "—"}
                        {d.volunteer?.user?.name ? ` · ${d.volunteer.user.name}` : ""}
                      </p>
                    </div>
                    {d.beneficiary ? (
                      <div>{urgencyBadge(d.beneficiary.urgencyLevel)}</div>
                    ) : null}
                    <div className="mt-auto flex items-center gap-2 border-t pt-3">
                      <Badge variant="outline" className="font-mono text-xs">
                        {d.value != null ? formatINR(d.value) : "No value"}
                      </Badge>
                      <div className="ml-auto">{rowMenu(d)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin"
              role="list"
              aria-label="Distributions"
            >
              {pagedDist.map((d) => {
                const meta = TYPE_META[d.type] ?? TYPE_META.OTHER;
                const Icon = meta.icon;
                return (
                  <div
                    key={d.id}
                    role="listitem"
                    className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40"
                    onClick={() => setDetail(d)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg border",
                        meta.cls
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {d.beneficiary?.name ?? "Community hand-out"} × {d.quantity}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {meta.label} · {d.location || "—"} · {formatDate(d.distributedAt)}
                      </p>
                    </div>
                    <span className="hidden font-mono text-sm font-medium tabular-nums sm:block">
                      {d.value != null ? formatINR(d.value) : "—"}
                    </span>
                    {rowMenu(d)}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ============================ PAD DRIVES ============================ */}
        <TabsContent value="pads" className="mt-4 space-y-4">
          {/* pads mini-metrics */}
          <div
            className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm"
            aria-label="Pad programme summary"
          >
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              <Sparkles className="size-4 text-pink-600 dark:text-pink-400" aria-hidden="true" />
              Programme
            </span>
            <span className="text-muted-foreground">
              <strong className="font-semibold text-foreground tabular-nums">
                {(padTotals?.sumPads ?? 0).toLocaleString("en-IN")}
              </strong>{" "}
              pads distributed
            </span>
            <span className="text-muted-foreground">
              <strong className="font-semibold text-foreground tabular-nums">
                {(padTotals?.sumGirls ?? 0).toLocaleString("en-IN")}
              </strong>{" "}
              girls reached
            </span>
            <span className="text-muted-foreground">
              <strong className="font-semibold text-foreground tabular-nums">
                {padTotals?.sessions ?? 0}
              </strong>{" "}
              awareness sessions
            </span>
            <span className="text-muted-foreground">
              <strong className="font-semibold text-foreground tabular-nums">
                {padTotals?.schools ?? 0}
              </strong>{" "}
              schools covered
            </span>
          </div>

          {/* filters bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={padQuery}
                onChange={(e) => setPadQuery(e.target.value)}
                placeholder="Search school or area…"
                aria-label="Search pad drives"
                className="pl-8"
              />
            </div>
            <select
              aria-label="Filter by awareness session"
              value={padSession}
              onChange={(e) => {
                setPadSession(e.target.value as "all" | "yes" | "no");
                setPadPage(1);
              }}
              className={cn(NATIVE_SELECT_CLS, "w-full sm:w-52")}
            >
              <option value="all">All drives</option>
              <option value="yes">With awareness session</option>
              <option value="no">Without session</option>
            </select>
            <select
              aria-label="Filter pad drives by date range"
              value={padRange}
              onChange={(e) => {
                setPadRange(e.target.value as DateRange);
                setPadPage(1);
              }}
              className={cn(NATIVE_SELECT_CLS, "w-full sm:w-44")}
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {isAdmin ? (
              <select
                aria-label="Filter pad drives by volunteer"
                value={padVolunteer}
                onChange={(e) => {
                  setPadVolunteer(e.target.value);
                  setPadPage(1);
                }}
                className={cn(NATIVE_SELECT_CLS, "w-full sm:w-48")}
              >
                <option value="">All volunteers</option>
                {volunteers.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.user.name}
                  </option>
                ))}
              </select>
            ) : null}
            {padFiltersActive ? (
              <Button variant="ghost" size="sm" onClick={clearPadFilters}>
                <X className="size-3.5" aria-hidden="true" /> Clear
              </Button>
            ) : null}
            <span className="text-xs tabular-nums text-muted-foreground">
              {padRows.length} drive{padRows.length === 1 ? "" : "s"}
            </span>
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <ExportMenu
                columns={padCsv}
                rows={padRows}
                filename="uar-pad-drives"
                disabled={padRows.length === 0}
              />
              <ViewSwitcher value={viewPad} onChange={setViewPad} />
              <Button size="sm" onClick={openPadCreate}>
                <Plus className="size-4" aria-hidden="true" /> Record pad drive
              </Button>
            </div>
          </div>

          {viewPad === "table" ? (
            <DataTable
              columns={padColumns}
              rows={pagedPads}
              rowKey={(p) => p.id}
              loading={loading}
              skeletonRows={6}
              height="fill"
              fillOffset={470}
              onRowClick={(p) => setPadDetail(p)}
              page={padPageSafe}
              pages={padPages}
              total={padRows.length}
              pageSize={padPageSize}
              onPage={setPadPage}
              onPageSize={(n) => {
                setPadPageSize(n);
                setPadPage(1);
              }}
              itemLabel="pad drives"
              empty={
                <EmptyState
                  icon={<Sparkles className="size-8" aria-hidden="true" />}
                  title={
                    padFiltersActive
                      ? "No pad drives match these filters"
                      : "No pad drives recorded yet"
                  }
                  hint="Record school visits with pads distributed and menstrual-health awareness session counts."
                >
                  <Button variant="outline" onClick={openPadCreate}>
                    <Plus className="size-4" aria-hidden="true" /> Record pad drive
                  </Button>
                </EmptyState>
              }
            />
          ) : loading ? (
            viewPad === "grid" ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-44 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            )
          ) : padRows.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-8" aria-hidden="true" />}
              title={
                padFiltersActive
                  ? "No pad drives match these filters"
                  : "No pad drives recorded yet"
              }
              hint="Record school visits with pads distributed and menstrual-health awareness session counts."
            >
              <Button variant="outline" onClick={openPadCreate}>
                <Plus className="size-4" aria-hidden="true" /> Record pad drive
              </Button>
            </EmptyState>
          ) : viewPad === "grid" ? (
            <div
              className="grid max-h-[36rem] gap-4 overflow-y-auto scrollbar-thin sm:grid-cols-2 xl:grid-cols-3"
              role="list"
              aria-label="Pad drives"
            >
              {pagedPads.map((p) => (
                <div
                  key={p.id}
                  role="listitem"
                  className="flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-accent/40"
                  onClick={() => setPadDetail(p)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex size-9 items-center justify-center rounded-lg border border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-400"
                    >
                      <Sparkles className="size-4" />
                    </span>
                    <p className="min-w-0 flex-1 truncate font-semibold">{p.area}</p>
                    {p.awarenessSession ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400"
                      >
                        Session
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(p.distributionDate)} · {p.schoolName || "Community visit"}
                  </p>
                  <p className="text-sm">
                    <strong className="font-semibold">{p.padsDistributed}</strong> pads ·{" "}
                    <strong className="font-semibold">{p.girlsCount}</strong> girls
                    {p.girlsCount > 0 ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {(p.padsDistributed / p.girlsCount).toFixed(1)}/girl
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-auto flex items-center border-t pt-3">{padRowMenu(p)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin"
              role="list"
              aria-label="Pad drives"
            >
              {pagedPads.map((p) => (
                <div
                  key={p.id}
                  role="listitem"
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40"
                  onClick={() => setPadDetail(p)}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-400"
                  >
                    <Sparkles className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.area}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.schoolName || "Community visit"} · {formatDate(p.distributionDate)}
                    </p>
                  </div>
                  <span className="hidden text-sm tabular-nums sm:block">
                    {p.padsDistributed} pads · {p.girlsCount} girls
                  </span>
                  {padRowMenu(p)}
                </div>
              ))}
            </div>
          )}

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
                hint="Register schools here, or just type a new school name in the drive form — it registers automatically."
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
                      {s.city ? (
                        <span className="font-normal text-muted-foreground"> — {s.city}</span>
                      ) : null}
                    </span>
                    <Badge variant="outline">{s.visitsCount} visits</Badge>
                    <Badge variant="outline">{s.totalGirls} girls</Badge>
                    {!s.isActive ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Inactive
                      </Badge>
                    ) : null}
                    {s.lastVisited ? (
                      <span className="text-xs text-muted-foreground">
                        last {formatDate(s.lastVisited)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* ==================== DISTRIBUTION ANALYTICS SLIDER ==================== */}
      <DetailSheet
        open={analyticsOpen}
        onOpenChange={setAnalyticsOpen}
        eyebrow="Distributions · Analytics"
        title="Distribution analytics"
        description="Full-funnel view of what moved, where, and for whom — all recorded time."
        status={
          <Badge variant="outline" className="tabular-nums">
            {distRows.length} records
          </Badge>
        }
      >
        <DistributionAnalyticsSlider rows={distRows} pads={padRows} kpi={kpi} />
      </DetailSheet>

      {/* ========================= DISTRIBUTION DETAIL ========================= */}
      <DetailSheet
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        eyebrow="Distributions"
        title={
          detail
            ? `${(TYPE_META[detail.type] ?? TYPE_META.OTHER).label} · ${formatDate(detail.distributedAt)}`
            : ""
        }
        description={detail?.location ?? undefined}
        status={detail ? typeChip(detail.type) : null}
        footer={
          detail ? (
            <>
              <p className="text-xs text-muted-foreground">
                Recorded {detail.createdAt ? formatDateTime(detail.createdAt) : formatDate(detail.distributedAt)}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openDistCreateFrom(detail)}>
                  <Plus className="size-3.5" aria-hidden="true" /> Record here
                </Button>
                <Button variant="outline" size="sm" onClick={() => openDistEdit(detail)}>
                  <Pencil className="size-3.5" aria-hidden="true" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  onClick={() => setDeleteTarget(detail)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> Delete
                </Button>
              </div>
            </>
          ) : null
        }
      >
        {detail ? (
          <>
            <DetailSection title="Overview" description="What moved, for whom, and where.">
              <DetailGrid cols={4}>
                <DataField
                  label="Beneficiary"
                  value={detail.beneficiary?.name ?? "Community hand-out"}
                />
                <DataField label="Quantity" value={detail.quantity.toLocaleString("en-IN")} />
                <DataField
                  label="Estimated value"
                  value={detail.value != null ? formatINR(detail.value) : null}
                  mono
                />
                <DataField label="Location" value={detail.location ?? null} icon={<MapPin className="size-3" aria-hidden="true" />} />
                <DataField label="Volunteer" value={detail.volunteer?.user?.name ?? null} />
                <DataField label="Campaign" value={detail.campaign?.title ?? null} icon={<Megaphone className="size-3" aria-hidden="true" />} />
                <DataField
                  label="Distributed on"
                  value={formatDateTime(detail.distributedAt)}
                  icon={<CalendarDays className="size-3" aria-hidden="true" />}
                />
                <DataField
                  label="Reference"
                  value={detail.id}
                  mono
                  copy
                />
              </DetailGrid>
            </DetailSection>

            <DetailSection title="Items" description="Item-level breakdown recorded in the field.">
              {parseItems(detail.items).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No item breakdown recorded — quantity {detail.quantity} ×{" "}
                  {(TYPE_META[detail.type] ?? TYPE_META.OTHER).label.toLowerCase()}.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/70">
                      <tr className="border-b text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-3 py-2">Item</th>
                        <th scope="col" className="px-3 py-2 text-right">Qty</th>
                        <th scope="col" className="px-3 py-2">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parseItems(detail.items).map((i, idx) => (
                        <tr key={idx} className="border-b last:border-b-0">
                          <td className="px-3 py-2">{String(i?.name ?? i)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {String(i?.qty ?? 1)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {i?.unit ? String(i.unit) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DetailSection>

            <DetailSection title="Linked records" description="People and campaigns connected to this distribution.">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Beneficiary
                  </p>
                  {detail.beneficiary ? (
                    <div className="mt-1.5 space-y-1.5">
                      <p className="font-medium">{detail.beneficiary.name}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {urgencyBadge(detail.beneficiary.urgencyLevel)}
                        <Badge variant="outline">
                          {titleCase(detail.beneficiary.category)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Family of {detail.beneficiary.familyMembers}
                        {detail.beneficiary.city ? ` · ${detail.beneficiary.city}` : ""}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      Community hand-out — no individual case linked.
                    </p>
                  )}
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Volunteer
                  </p>
                  <p className="mt-1.5 font-medium">
                    {detail.volunteer?.user?.name ?? "Not attributed"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {detail.volunteer
                      ? "Field volunteer on record for this distribution"
                      : "Recorded without a volunteer profile"}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Campaign
                  </p>
                  {detail.campaign ? (
                    <div className="mt-1.5 space-y-1.5">
                      <p className="font-medium">{detail.campaign.title}</p>
                      {detail.campaign.targetAmount ? (
                        <>
                          <Progress
                            value={Math.min(
                              100,
                              Math.round(
                                ((detail.campaign.raisedAmount ?? 0) /
                                  detail.campaign.targetAmount) *
                                  100
                              )
                            )}
                            className="h-1.5"
                            aria-label="Campaign progress"
                          />
                          <p className="text-xs text-muted-foreground">
                            {formatINRCompact(detail.campaign.raisedAmount ?? 0)} of{" "}
                            {formatINRCompact(detail.campaign.targetAmount)} ·{" "}
                            {titleCase(detail.campaign.status ?? "")}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {titleCase(detail.campaign.status ?? "")}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      Not linked to a campaign.
                    </p>
                  )}
                </div>
              </div>
            </DetailSection>

            <DetailSection
              title="Impact estimate"
              description="Rough field math — assumptions are indicative, not audited figures."
            >
              <div className="space-y-2">
                {(
                  IMPACT_PER_TYPE[detail.type] ??
                  IMPACT_PER_TYPE.OTHER
                )(detail.quantity)
                  .split("—")
                  .map((line, i) => (
                    <p
                      key={i}
                      className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                    >
                      <Calculator
                        className="mt-0.5 size-3.5 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      {line.trim()}
                    </p>
                  ))}
                {detail.value != null ? (
                  <p className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    <Wallet className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                    Estimated market value {formatINR(detail.value)}
                    {detail.type === "FOOD"
                      ? ` ≈ ${Math.floor(detail.value / RATION_KIT_COST)} ration kits at ₹${RATION_KIT_COST}/kit`
                      : ""}
                  </p>
                ) : null}
              </div>
            </DetailSection>

            {detail.notes ? (
              <DetailSection title="Notes">
                <p className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
                  {detail.notes}
                </p>
              </DetailSection>
            ) : null}
          </>
        ) : null}
      </DetailSheet>

      {/* =========================== PAD DRIVE DETAIL =========================== */}
      <DetailSheet
        open={!!padDetail}
        onOpenChange={(o) => !o && setPadDetail(null)}
        eyebrow="Sanitary pads programme"
        title={
          padDetail
            ? `${padDetail.schoolName || padDetail.area} · ${formatDate(padDetail.distributionDate)}`
            : ""
        }
        description={padDetail ? `${padDetail.area}${padDetail.schoolName ? ` · ${padDetail.schoolName}` : ""}` : undefined}
        status={
          padDetail?.awarenessSession ? (
            <Badge
              variant="outline"
              className="border-teal-500/30 bg-teal-500/10 font-medium text-teal-700 dark:text-teal-400"
            >
              Awareness session
            </Badge>
          ) : null
        }
        footer={
          padDetail ? (
            <>
              <p className="text-xs text-muted-foreground">
                Drive date {formatDate(padDetail.distributionDate)}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openPadEdit(padDetail)}>
                  <Pencil className="size-3.5" aria-hidden="true" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  onClick={() => setDeletePad(padDetail)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> Delete
                </Button>
              </div>
            </>
          ) : null
        }
      >
        {padDetail ? (
          <>
            <DetailSection title="Overview" description="School or community drive details.">
              <DetailGrid cols={4}>
                <DataField label="School" value={padDetail.schoolName ?? "Community visit"} icon={<School className="size-3" aria-hidden="true" />} />
                <DataField label="Area" value={padDetail.area} icon={<MapPin className="size-3" aria-hidden="true" />} />
                <DataField
                  label="Drive date"
                  value={formatDate(padDetail.distributionDate)}
                  icon={<CalendarDays className="size-3" aria-hidden="true" />}
                />
                <DataField
                  label="Volunteer"
                  value={padDetail.volunteer?.name ?? padDetail.volunteerName ?? null}
                />
                <DataField
                  label="Girls reached"
                  value={padDetail.girlsCount.toLocaleString("en-IN")}
                />
                <DataField
                  label="Pads distributed"
                  value={padDetail.padsDistributed.toLocaleString("en-IN")}
                />
                <DataField
                  label="Pads per girl"
                  value={
                    padDetail.girlsCount > 0
                      ? (Math.round((padDetail.padsDistributed / padDetail.girlsCount) * 10) / 10).toFixed(1)
                      : null
                  }
                  mono
                />
                <DataField
                  label="Session attendees"
                  value={
                    padDetail.awarenessSession
                      ? padDetail.sessionAttendees != null
                        ? padDetail.sessionAttendees.toLocaleString("en-IN")
                        : "Held — count not recorded"
                      : null
                  }
                />
              </DetailGrid>
            </DetailSection>

            <DetailSection
              title="Impact estimate"
              description="Protection math based on 18 pads per girl-month."
            >
              <div className="space-y-2">
                <p className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  <Calculator className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  {padDetail.padsDistributed.toLocaleString("en-IN")} pads ≈{" "}
                  {Math.floor(padDetail.padsDistributed / PADS_PER_GIRL_MONTH).toLocaleString("en-IN")}{" "}
                  girl-month{Math.floor(padDetail.padsDistributed / PADS_PER_GIRL_MONTH) === 1 ? "" : "s"} of protection
                  {padDetail.girlsCount > 0
                    ? ` — about ${(Math.round((padDetail.padsDistributed / padDetail.girlsCount) * 10) / 10).toFixed(1)} months per girl reached`
                    : ""}
                </p>
                {padDetail.awarenessSession ? (
                  <p className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    <Users className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                    Menstrual-health awareness session delivered
                    {padDetail.sessionAttendees != null
                      ? ` to ${padDetail.sessionAttendees.toLocaleString("en-IN")} attendee${padDetail.sessionAttendees === 1 ? "" : "s"}`
                      : ""}
                    .
                  </p>
                ) : null}
              </div>
            </DetailSection>

            {padDetail.notes ? (
              <DetailSection title="Notes">
                <p className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
                  {padDetail.notes}
                </p>
              </DetailSection>
            ) : null}
          </>
        ) : null}
      </DetailSheet>

      {/* ======================= RECORD DISTRIBUTION (FormSheet) ====================== */}
      <FormSheet
        open={distOpen}
        onOpenChange={(o) => {
          if (o) {
            setDistOpen(true);
            return;
          }
          // wizard step > 1: the footer button acts as "Back", not close
          if (!editingDist && wizardStep > 1) {
            wizardBack();
            return;
          }
          setDistOpen(false);
          setWizardStep(1);
        }}
        title={editingDist ? "Edit distribution" : "Record distribution"}
        description={
          editingDist
            ? "Update the field record — changes apply immediately."
            : "Four quick steps: what & for whom → items → people & place → review."
        }
        badge={
          editingDist ? (
            <Badge variant="outline">Editing</Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400"
            >
              Step {wizardStep} of 4 · {WIZARD_STEPS[wizardStep - 1]}
            </Badge>
          )
        }
        footerExtra={
          !editingDist ? (
            <span className="flex items-center gap-1.5">
              {WIZARD_STEPS.map((s, i) => (
                <span
                  key={s}
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full transition-colors",
                    i + 1 === wizardStep ? "bg-primary" : i + 1 < wizardStep ? "bg-primary/50" : "bg-muted-foreground/30"
                  )}
                />
              ))}
              <span className="ml-1">{WIZARD_STEPS[wizardStep - 1]}</span>
            </span>
          ) : undefined
        }
        onSubmit={() => {
          if (editingDist) {
            void saveDist();
          } else if (wizardStep < 4) {
            wizardNext();
          } else {
            void saveDist();
          }
        }}
        submitLabel={
          editingDist
            ? "Save changes"
            : wizardStep < 4
              ? "Next"
              : "Record distribution"
        }
        cancelLabel={editingDist || wizardStep === 1 ? "Cancel" : "Back"}
        loading={savingDist}
        dirty={distDirty}
        size="full"
      >
        {/* Step 1 — What & for whom */}
        <div className={cn(wizardStep !== 1 && "hidden")}>
          <FormSection title="What & for whom" description="Type, beneficiary and quantity.">
          <FieldGrid>
            <SelectField
              label="Type"
              required
              value={distForm.type}
              onChange={(v) => setDistForm((f) => ({ ...f, type: v }))}
              options={DISTRIBUTION_TYPES.map((t) => ({
                value: t,
                label: (TYPE_META[t] ?? TYPE_META.OTHER).label,
              }))}
            />
            <TextField
              label="Quantity (units / kits)"
              required
              type="number"
              min="1"
              value={distForm.quantity}
              onChange={(v) => setDistForm((f) => ({ ...f, quantity: v }))}
              error={distErrors.quantity ?? null}
            />
          </FieldGrid>

          {distForm.type === "SANITARY_PADS" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-pink-500/30 bg-pink-500/10 px-3 py-2.5 text-xs text-pink-700 dark:text-pink-400">
              <Info className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                Running a school or community pad drive with an awareness session? The
                pads tracker records girls count and sessions.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-pink-500/40 text-pink-700 hover:bg-pink-500/10 dark:text-pink-400"
                onClick={() => {
                  setDistOpen(false);
                  setTab("pads");
                  openPadCreate();
                }}
              >
                Log as Pad Drive instead
              </Button>
            </div>
          ) : null}

          <Field
            label="Beneficiary"
            hint={
              beneficiaries.length > 0
                ? `${beneficiaries.length} on file — filter by name or city. Leave empty for a community hand-out.`
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
                onChange={(e) =>
                  setDistForm((f) => ({ ...f, beneficiaryId: e.target.value }))
                }
                className={NATIVE_SELECT_CLS}
              >
                <option value="">Community hand-out (none)</option>
                {benFiltered.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.city ? ` — ${b.city}` : ""} · {titleCase(b.category)} ·{" "}
                    {titleCase(b.urgencyLevel)} urgency
                  </option>
                ))}
              </select>
              {selectedBeneficiary ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                  <Users className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{selectedBeneficiary.name}</span>
                  {urgencyBadge(selectedBeneficiary.urgencyLevel)}
                  <span className="text-muted-foreground">
                    {titleCase(selectedBeneficiary.category)} · family of{" "}
                    {selectedBeneficiary.familyMembers}
                    {selectedBeneficiary.city ? ` · ${selectedBeneficiary.city}` : ""}
                  </span>
                </div>
              ) : null}
            </div>
          </Field>

          <TextField
            label="Estimated value (₹)"
            prefix="₹"
            type="number"
            min="0"
            value={distForm.value}
            onChange={(v) => setDistForm((f) => ({ ...f, value: v }))}
            error={distErrors.value ?? null}
            hint={
              itemTotals.estValue > 0 && distForm.value === ""
                ? `Inventory estimate: ${formatINR(itemTotals.estValue)} — type it above to persist.`
                : perUnitHint
            }
          />
        </FormSection>
        </div>

        {/* Step 2 — Items */}
        <div className={cn(wizardStep !== 2 && "hidden")}>
        <FormSection
          title="Items in this distribution"
          description="Pulled from the items master — names auto-match inventory to estimate value."
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                {itemTotals.lines} item line{itemTotals.lines === 1 ? "" : "s"} ·{" "}
                {itemTotals.units.toLocaleString("en-IN")} total units
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setDistForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }))
                }
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
                  <div className="grid grid-cols-[1fr_76px_88px_36px] items-center gap-2">
                    <Input
                      value={item.name}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDistForm((f) => ({
                          ...f,
                          items: f.items.map((it, j) => (j === i ? { ...it, name: v } : it)),
                        }));
                      }}
                      placeholder="Rice (5kg bags)"
                      aria-label={`Item ${i + 1} name`}
                    />
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={item.qty}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDistForm((f) => ({
                          ...f,
                          items: f.items.map((it, j) => (j === i ? { ...it, qty: v } : it)),
                        }));
                      }}
                      aria-label={`Item ${i + 1} quantity`}
                    />
                    <Input
                      value={item.unit}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDistForm((f) => ({
                          ...f,
                          items: f.items.map((it, j) => (j === i ? { ...it, unit: v } : it)),
                        }));
                      }}
                      placeholder="kg, kits…"
                      aria-label={`Item ${i + 1} unit`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setDistForm((f) => ({
                          ...f,
                          items: f.items.filter((_, j) => j !== i),
                        }))
                      }
                      aria-label={`Remove item ${i + 1}`}
                      disabled={distForm.items.length <= 1}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                  {itemError(distErrors, i) ? (
                    <p className="text-xs font-medium text-destructive" role="alert">
                      {itemError(distErrors, i)}
                    </p>
                  ) : null}
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
        </div>

        {/* Step 3 — People & place */}
        <div className={cn(wizardStep !== 3 && "hidden")}>
        <FormSection title="People & place" description="Volunteer assignment, campaign linkage and location.">
          {isAdmin ? (
            <FieldGrid>
              <SelectField
                label="Volunteer"
                value={distForm.volunteerId || "NONE"}
                onChange={(v) =>
                  setDistForm((f) => ({ ...f, volunteerId: v === "NONE" ? "" : v }))
                }
                options={[
                  { value: "NONE", label: "— Not assigned —" },
                  ...volunteers.map((v) => ({
                    value: v.id,
                    label: `${v.user.name}${v.assignedArea ? ` — ${v.assignedArea}` : ""}${v.status !== "ACTIVE" ? ` (${titleCase(v.status)})` : ""}`,
                  })),
                ]}
                hint="Assigning here does NOT create volunteer tasks — use “Assign to record” from the detail view for task generation."
              />
              <SelectField
                label="Campaign"
                value={distForm.campaignId || "NONE"}
                onChange={(v) =>
                  setDistForm((f) => ({ ...f, campaignId: v === "NONE" ? "" : v }))
                }
                options={[
                  { value: "NONE", label: "— No campaign —" },
                  ...campaigns.map((c) => ({
                    value: c.id,
                    label: `${c.title}${c.status ? ` (${titleCase(c.status)})` : ""}`,
                  })),
                ]}
              />
            </FieldGrid>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
              <Users className="size-4 shrink-0" aria-hidden="true" />
              This record will be attributed to your volunteer profile automatically.
            </div>
          )}
          <TextField
            label="Location"
            required
            value={distForm.location}
            onChange={(v) => setDistForm((f) => ({ ...f, location: v }))}
            error={distErrors.location ?? null}
            placeholder="Ambedkar Nagar community hall, Bengaluru"
          />
        </FormSection>

        <FormSection title="Notes & timing" description="When it happened and anything worth remembering.">
          <TextField
            label="Distributed on"
            type="datetime-local"
            value={distForm.distributedAt}
            onChange={(v) => setDistForm((f) => ({ ...f, distributedAt: v }))}
            error={distErrors.distributedAt ?? null}
          />
          <TextareaField
            label="Notes"
            rows={3}
            value={distForm.notes}
            onChange={(v) => setDistForm((f) => ({ ...f, notes: v }))}
            placeholder="Follow-ups, community feedback, photos pending…"
          />
        </FormSection>
        </div>

        {/* Step 4 — Review */}
        <div className={cn(wizardStep !== 4 && "hidden")}>
          <FormSection
            title="Review & save"
            description="A last look before the record is written — everything stays editable via Back."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ReviewTile label="Type" value={(TYPE_META[distForm.type] ?? TYPE_META.OTHER).label} />
              <ReviewTile label="Quantity" value={`${distForm.quantity} unit(s)`} />
              <ReviewTile
                label="Beneficiary"
                value={selectedBeneficiary?.name ?? "Community hand-out"}
                sub={
                  selectedBeneficiary
                    ? `${titleCase(selectedBeneficiary.category)} · family of ${selectedBeneficiary.familyMembers}`
                    : undefined
                }
              />
              <ReviewTile
                label="Estimated value"
                value={
                  distForm.value.trim() !== ""
                    ? formatINR(Number(distForm.value))
                    : itemTotals.estValue > 0
                      ? `${formatINR(itemTotals.estValue)} (inventory estimate)`
                      : "—"
                }
              />
              <ReviewTile
                label="Volunteer"
                value={volunteers.find((v) => v.id === distForm.volunteerId)?.user.name ?? "Not assigned"}
              />
              <ReviewTile
                label="Campaign"
                value={campaigns.find((c) => c.id === distForm.campaignId)?.title ?? "—"}
              />
              <ReviewTile label="Location" value={distForm.location || "—"} />
              <ReviewTile
                label="Distributed on"
                value={distForm.distributedAt ? formatDateTime(new Date(distForm.distributedAt).toISOString()) : "—"}
              />
            </div>

            {/* item preview */}
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/70">
                  <tr className="border-b text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-2">Item</th>
                    <th scope="col" className="px-3 py-2 text-right">Qty</th>
                    <th scope="col" className="px-3 py-2">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {distForm.items.filter((i) => i.name.trim()).length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-3 text-sm text-muted-foreground">
                        No item lines — the summary quantity is the record.
                      </td>
                    </tr>
                  ) : (
                    distForm.items
                      .filter((i) => i.name.trim())
                      .map((i, idx) => (
                        <tr key={idx} className="border-b last:border-b-0">
                          <td className="px-3 py-2 font-medium">{i.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{i.qty}</td>
                          <td className="px-3 py-2 text-muted-foreground">{i.unit || "—"}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>

            {distForm.notes.trim() ? (
              <p className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Notes: </span>
                {distForm.notes}
              </p>
            ) : null}
          </FormSection>
        </div>
      </FormSheet>

      {/* ========================= RECORD PAD DRIVE (FormSheet) ======================== */}
      <FormSheet
        open={padOpen}
        onOpenChange={setPadOpen}
        title={editingPad ? "Edit pad drive" : "Record pad drive"}
        description="School or community visit with pads distributed and an optional awareness session."
        badge={editingPad ? <Badge variant="outline">Editing</Badge> : null}
        onSubmit={savePad}
        submitLabel={editingPad ? "Save changes" : "Record drive"}
        loading={savingPad}
        dirty={padDirty}
        size="full"
      >
        <FormSection title="Where & when" description="Drive location and date.">
          <FieldGrid>
            <TextField
              label="Area"
              required
              value={padForm.area}
              onChange={(v) => setPadForm((f) => ({ ...f, area: v }))}
              error={padErrors.area ?? null}
              placeholder="Yelahanka, Bengaluru"
            />
            <TextField
              label="Drive date"
              type="date"
              value={padForm.distributionDate}
              onChange={(v) => setPadForm((f) => ({ ...f, distributionDate: v }))}
              error={padErrors.distributionDate ?? null}
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
                  const v = e.target.value;
                  setPadForm((f) => ({ ...f, schoolName: v }));
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
                          setPadForm((f) => ({
                            ...f,
                            schoolName: s.schoolName,
                            area: f.area || (s.city ? `${s.city}` : f.area),
                          }));
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
        </FormSection>

        <FormSection title="Reach & session" description="Girls reached, pads handed out and awareness session.">
          <FieldGrid>
            <TextField
              label="Girls reached"
              required
              type="number"
              min="0"
              value={padForm.girlsCount}
              onChange={(v) => setPadForm((f) => ({ ...f, girlsCount: v }))}
              error={padErrors.girlsCount ?? null}
            />
            <TextField
              label="Pads distributed"
              required
              type="number"
              min="0"
              value={padForm.padsDistributed}
              onChange={(v) => setPadForm((f) => ({ ...f, padsDistributed: v }))}
              error={padErrors.padsDistributed ?? null}
              hint={
                padPerGirl != null
                  ? `≈ ${padPerGirl} pads per girl (30 pads ≈ 2 months of protection)`
                  : undefined
              }
            />
          </FieldGrid>
          {padGirlsNum > 0 && padPadsNum > 0 && padPadsNum < padGirlsNum ? (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Fewer pads than girls — that&apos;s under {PADS_PER_GIRL_MONTH} pads per
              girl. Double-check the counts before saving.
            </p>
          ) : null}
          <SwitchField
            label="Awareness session conducted"
            hint="Menstrual health & hygiene talk."
            checked={padForm.awarenessSession}
            onChange={(v) => setPadForm((f) => ({ ...f, awarenessSession: v }))}
          />
          {padForm.awarenessSession ? (
            <TextField
              label="Session attendees"
              type="number"
              min="0"
              value={padForm.sessionAttendees}
              onChange={(v) => setPadForm((f) => ({ ...f, sessionAttendees: v }))}
              error={padErrors.sessionAttendees ?? null}
            />
          ) : null}
          {isAdmin ? (
            <FieldGrid>
              <SelectField
                label="Volunteer"
                value={padForm.volunteerId || "NONE"}
                onChange={(v) =>
                  setPadForm((f) => ({ ...f, volunteerId: v === "NONE" ? "" : v }))
                }
                options={[
                  { value: "NONE", label: "— Not assigned —" },
                  ...volunteers.map((v) => ({
                    value: v.id,
                    label: `${v.user.name}${v.assignedArea ? ` — ${v.assignedArea}` : ""}`,
                  })),
                ]}
              />
              <TextField
                label="On-site volunteer name (optional)"
                value={padForm.volunteerName}
                onChange={(v) => setPadForm((f) => ({ ...f, volunteerName: v }))}
                placeholder="For drives led by non-profile volunteers"
              />
            </FieldGrid>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                <Users className="size-4 shrink-0" aria-hidden="true" />
                This drive will be attributed to your volunteer profile automatically.
              </div>
              <TextField
                label="On-site volunteer name (optional)"
                value={padForm.volunteerName}
                onChange={(v) => setPadForm((f) => ({ ...f, volunteerName: v }))}
                placeholder="If someone else led the drive on the ground"
              />
            </>
          )}
        </FormSection>

        <FormSection title="Notes" description="Anything worth remembering about the visit.">
          <TextareaField
            label="Notes"
            rows={3}
            value={padForm.notes}
            onChange={(v) => setPadForm((f) => ({ ...f, notes: v }))}
            placeholder="School feedback, follow-up plans, session topics…"
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
            ? `${(TYPE_META[deleteTarget.type] ?? TYPE_META.OTHER).label} × ${deleteTarget.quantity} · ${deleteTarget.location ?? "unknown location"}`
            : null
        }
        description="Removes the record from beneficiary history, reports and impact stats. This cannot be undone."
        confirmLabel="Delete"
        loading={deletingDist}
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
        description="Removes the drive from programme totals. This cannot be undone."
        confirmLabel="Delete"
        loading={deletingPad}
        onConfirm={removePad}
      />
    </div>
  );
}

/** Per-item error lookup helper. */
function itemError(errors: Errors, i: number): string | null {
  return errors[`item-${i}`] ?? null;
}

/** Review-step tile in the record-distribution wizard. */
function ReviewTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold">{value}</p>
      {sub ? <p className="truncate text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/* ====================== DISTRIBUTION ANALYTICS SLIDER ====================== */

const ANALYTICS_PALETTE = [
  "#10b981",
  "#f43f5e",
  "#f59e0b",
  "#14b8a6",
  "#a855f7",
  "#f97316",
  "#84cc16",
  "#06b6d4",
];

function DistributionAnalyticsSlider({
  rows,
  pads,
  kpi,
}: {
  rows: DistributionRow[];
  pads: PadDrive[];
  kpi: { pads: number; girls: number; sessions: number } | null;
}) {
  const byType = useMemo(() => {
    const m = new Map<string, { count: number; qty: number; value: number }>();
    for (const r of rows) {
      const cur = m.get(r.type) ?? { count: 0, qty: 0, value: 0 };
      cur.count += 1;
      cur.qty += r.quantity ?? 0;
      cur.value += r.value ?? 0;
      m.set(r.type, cur);
    }
    return [...m.entries()]
      .map(([type, v], i) => ({
        type,
        name: (TYPE_META[type] ?? TYPE_META.OTHER).label,
        fill: ANALYTICS_PALETTE[i % ANALYTICS_PALETTE.length],
        ...v,
      }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const byVolunteer = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const name = r.volunteer?.user?.name ?? "Unattributed";
      m.set(name, (m.get(name) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([name, count], i) => ({
        name,
        count,
        fill: ANALYTICS_PALETTE[i % ANALYTICS_PALETTE.length],
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [rows]);

  const byLocation = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const loc = r.location?.trim() || "Unknown";
      m.set(loc, (m.get(loc) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([name, count], i) => ({
        name,
        count,
        fill: ANALYTICS_PALETTE[(i + 3) % ANALYTICS_PALETTE.length],
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [rows]);

  const monthly = useMemo(() => {
    const m = new Map<string, { count: number; value: number }>();
    for (const r of rows) {
      const d = new Date(r.distributedAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
      const cur = m.get(key) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += r.value ?? 0;
      m.set(key, cur);
    }
    return [...m.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .reverse();
  }, [rows]);

  const totals = useMemo(() => {
    const value = rows.reduce((s, r) => s + (r.value ?? 0), 0);
    const qty = rows.reduce((s, r) => s + (r.quantity ?? 0), 0);
    const beneficiaries = rows.filter((r) => r.beneficiary).length;
    const walkIn = rows.length - beneficiaries;
    const girlMonths = Math.floor((kpi?.pads ?? 0) / PADS_PER_GIRL_MONTH);
    return { value, qty, beneficiaries, walkIn, girlMonths };
  }, [rows, kpi]);

  const hasData = rows.length > 0;
  const AXIS = { fontSize: 11 };

  return (
    <>
      {/* headline numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MiniStatA label="Distributions" value={rows.length.toLocaleString("en-IN")} />
        <MiniStatA label="Units delivered" value={totals.qty.toLocaleString("en-IN")} />
        <MiniStatA label="Value disbursed" value={formatINRCompact(totals.value)} />
        <MiniStatA
          label="Registered cases"
          value={`${totals.beneficiaries.toLocaleString("en-IN")} · ${totals.walkIn.toLocaleString("en-IN")} walk-in`}
        />
        <MiniStatA
          label="Girl-months (pads)"
          value={totals.girlMonths.toLocaleString("en-IN")}
        />
      </div>

      {!hasData ? (
        <EmptyState
          icon={<BarChart3 className="size-6" aria-hidden="true" />}
          title="No distributions recorded yet"
          hint="Analytics appear as soon as field records come in."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* type split donut */}
          <SectionCard
            title="What moved"
            description="Distribution records by aid type"
            icon={<Package className="size-4" aria-hidden="true" />}
          >
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={byType}
                    dataKey="count"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="85%"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {byType.map((t) => (
                      <Cell key={t.type} fill={t.fill} />
                    ))}
                  </Pie>
                  <ReTooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
              {byType.map((t) => (
                <li key={t.type} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: t.fill }}
                  />
                  <span className="truncate">{t.name}</span>
                  <span className="ml-auto font-medium tabular-nums">
                    {t.count} · {formatINRCompact(t.value)}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>

          {/* monthly trend */}
          <SectionCard
            title="Monthly rhythm"
            description="Records and value per month"
            icon={<TrendingUp className="size-4" aria-hidden="true" />}
          >
            {monthly.length === 0 ? (
              <EmptyState icon={<TrendingUp className="size-6" aria-hidden="true" />} title="No dated records" />
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                    <ReTooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="count" name="Distributions" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>

          {/* top volunteers */}
          <SectionCard
            title="Field attribution"
            description="Top volunteers by recorded distributions"
            icon={<Users className="size-4" aria-hidden="true" />}
          >
            {byVolunteer.length === 0 ? (
              <EmptyState icon={<Users className="size-6" aria-hidden="true" />} title="No records" />
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byVolunteer} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      tick={AXIS}
                      tickLine={false}
                      axisLine={false}
                    />
                    <ReTooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="count" name="Distributions" radius={[0, 6, 6, 0]} maxBarSize={18}>
                      {byVolunteer.map((v) => (
                        <Cell key={v.name} fill={v.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>

          {/* top locations */}
          <SectionCard
            title="Where the work happens"
            description="Top locations by distribution count"
            icon={<MapPin className="size-4" aria-hidden="true" />}
          >
            {byLocation.length === 0 ? (
              <EmptyState icon={<MapPin className="size-6" aria-hidden="true" />} title="No locations recorded" />
            ) : (
              <ul className="space-y-1.5">
                {byLocation.map((l, i) => (
                  <li key={l.name} className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                      style={{ backgroundColor: l.fill }}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{l.name}</span>
                    <Badge variant="outline" className="tabular-nums">
                      {l.count}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* pads programme recap */}
          <SectionCard
            title="Pads programme recap"
            description="Sanitary-pad drives recorded in the same period"
            icon={<Sparkles className="size-4" aria-hidden="true" />}
            className="lg:col-span-2"
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStatA label="Drives" value={pads.length.toLocaleString("en-IN")} />
              <MiniStatA label="Pads" value={(kpi?.pads ?? 0).toLocaleString("en-IN")} />
              <MiniStatA label="Girls reached" value={(kpi?.girls ?? 0).toLocaleString("en-IN")} />
              <MiniStatA label="Sessions" value={(kpi?.sessions ?? 0).toLocaleString("en-IN")} />
            </div>
          </SectionCard>
        </div>
      )}
    </>
  );
}

function MiniStatA({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}
