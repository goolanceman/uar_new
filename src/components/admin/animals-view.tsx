"use client";

/**
 * Animal Welfare — Angel Paws (admin), rebuilt on the round-5 design system
 * to match the distributions gold standard.
 *
 * Tab 1 "Rescue directory": toolbar (search + species filter + status chips
 *   with counts + ViewSwitcher + CSV + "Add animal"), DataTable with every
 *   column, lime grid cards, compact list rows, row → full-screen DetailSheet
 *   (profile, health quick-toggles, adoption, food cost, pledges + add-pledge)
 *   and quick-action footer (adopt / foster / critical / vaccinate / sterilize).
 * Tab 2 "Analytics": KPI StatCards + Recharts (species donut, status bar,
 *   pledge-kind split, food cost by species) + the shared shelter-fund pool
 *   (AnimalPledge with animalId null) with its own add-pledge flow.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  BarChart3,
  Bird,
  Cat,
  Check,
  Dog,
  Eye,
  HandCoins,
  HeartPulse,
  Home,
  MapPin,
  Milk,
  MoreHorizontal,
  PawPrint,
  Pencil,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  Stethoscope,
  Syringe,
  Trash2,
  TriangleAlert,
  TrendingUp,
  UserCheck,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { formatDate, formatINR, formatINRCompact, titleCase } from "@/lib/format";
import { amountRule, required } from "@/lib/validators";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import {
  PaginationBar,
  useViewPref,
  ViewSwitcher,
} from "@/components/shared/view-switcher";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface PledgeRow {
  id: string;
  animalId?: string | null;
  shelterFund?: string | null;
  donorId?: string | null;
  donorName: string;
  kind: string;
  amount: number;
  frequency: string;
  status: string;
  createdAt?: string;
  animal?: { name: string; species: string } | null;
}

interface AnimalRow {
  id: string;
  name: string;
  species: string;
  breed?: string | null;
  ageMonths: number;
  gender: string;
  story: string;
  healthStatus?: string | null;
  vaccinated: boolean;
  sterilized: boolean;
  location: string;
  status: string;
  monthlyFood: number;
  adoptedById?: string | null;
  adoptedByName?: string | null;
  createdAt?: string;
  pledges?: PledgeRow[];
}

interface Analytics {
  animals: {
    total: number;
    available: number;
    fostered: number;
    adopted: number;
    critical: number;
    vaccinated: number;
    sterilized: number;
    monthlyFoodCommitment: number;
  };
  species: Array<{ species: string; count: number; monthlyFood: number }>;
  status: Array<{ status: string; count: number }>;
  pledges: {
    total: number;
    active: number;
    monthlyValue: number;
    monthlyCount: number;
    oneTimeValue: number;
    oneTimeCount: number;
    byKind: Array<{
      kind: string;
      count: number;
      amount: number;
      activeCount: number;
      monthlyAmount: number;
    }>;
    shelterFund: {
      count: number;
      activeCount: number;
      monthlyValue: number;
      oneTimeValue: number;
    };
  };
}

interface AnimalForm {
  name: string;
  species: string;
  breed: string;
  ageMonths: string;
  gender: string;
  story: string;
  healthStatus: string;
  vaccinated: boolean;
  sterilized: boolean;
  location: string;
  status: string;
  monthlyFood: string;
}

interface PledgeForm {
  donorName: string;
  kind: string;
  amount: string;
  frequency: string;
  shelterFund: string;
}

interface UserLite {
  id: string;
  name: string;
  email: string;
  role: string;
}

type Errors = Record<string, string | null>;
type PledgeContext =
  | { mode: "animal"; animal: AnimalRow }
  | { mode: "shelter" }
  | null;

/* -------------------------------- constants -------------------------------- */

const SPECIES_META: Record<
  string,
  { label: string; icon: React.ElementType }
> = {
  DOG: { label: "Dog", icon: Dog },
  CAT: { label: "Cat", icon: Cat },
  COW: { label: "Cow", icon: Milk },
  BIRD: { label: "Bird", icon: Bird },
  OTHER: { label: "Other", icon: PawPrint },
};

const ANIMAL_STATUSES = ["AVAILABLE", "FOSTERED", "ADOPTED", "CRITICAL"];

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  AVAILABLE: {
    label: "Available",
    cls: "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-400",
    dot: "#84cc16",
  },
  FOSTERED: {
    label: "Fostered",
    cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    dot: "#f59e0b",
  },
  ADOPTED: {
    label: "Adopted",
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "#14b8a6",
  },
  CRITICAL: {
    label: "Critical",
    cls: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
    dot: "#ef4444",
  },
};

const KIND_META: Record<string, { label: string; icon: React.ElementType; cls: string; dot: string }> = {
  FOOD: {
    label: "Food",
    icon: UtensilsCrossed,
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "#10b981",
  },
  MEDICAL: {
    label: "Medical",
    icon: Stethoscope,
    cls: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
    dot: "#14b8a6",
  },
  VACCINATION: {
    label: "Vaccination",
    icon: Syringe,
    cls: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
    dot: "#06b6d4",
  },
  SHELTER: {
    label: "Shelter",
    icon: Home,
    cls: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
    dot: "#f97316",
  },
};

const PLEDGE_KINDS = ["FOOD", "MEDICAL", "VACCINATION", "SHELTER"];
const GENDERS = ["MALE", "FEMALE", "UNKNOWN"];

const LIME_CHIP =
  "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-400";
const CARE_ON =
  "border-lime-500/40 bg-lime-500/15 text-lime-700 dark:text-lime-400";
const CARE_OFF = "border-border bg-muted/40 text-muted-foreground/50";

const NATIVE_SELECT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

const EMPTY_ANIMAL_FORM: AnimalForm = {
  name: "",
  species: "DOG",
  breed: "",
  ageMonths: "12",
  gender: "MALE",
  story: "",
  healthStatus: "",
  vaccinated: false,
  sterilized: false,
  location: "",
  status: "AVAILABLE",
  monthlyFood: "",
};

const EMPTY_PLEDGE_FORM: PledgeForm = {
  donorName: "",
  kind: "FOOD",
  amount: "",
  frequency: "MONTHLY",
  shelterFund: "Angel Paws shelter fund",
};

/* -------------------------------- utilities -------------------------------- */

/** Compact KPI tile used inside the animal detail sheet tabs. */
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

/** ageMonths → "2y 3m" (months under a year render as "8m"). */
function ageText(months: number): string {
  const m = Math.max(0, Math.trunc(Number(months ?? 0)));
  if (m < 12) return `${m}m`;
  const y = Math.floor(m / 12);
  const rest = m % 12;
  return rest ? `${y}y ${rest}m` : `${y}y`;
}

function kindChip(kind: string) {
  const meta = KIND_META[kind] ?? KIND_META.FOOD;
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-medium whitespace-nowrap", meta.cls)}
    >
      <Icon className="size-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

/** Local fallback when /api/animal-analytics is unavailable (non-admin). */
function deriveAnalytics(animals: AnimalRow[], pledges: PledgeRow[]): Analytics {
  const statusCount = (s: string) => animals.filter((a) => a.status === s).length;
  const active = pledges.filter((p) => p.status === "ACTIVE");
  return {
    animals: {
      total: animals.length,
      available: statusCount("AVAILABLE"),
      fostered: statusCount("FOSTERED"),
      adopted: statusCount("ADOPTED"),
      critical: statusCount("CRITICAL"),
      vaccinated: animals.filter((a) => a.vaccinated).length,
      sterilized: animals.filter((a) => a.sterilized).length,
      monthlyFoodCommitment: animals.reduce((s, a) => s + (a.monthlyFood ?? 0), 0),
    },
    species: Object.keys(SPECIES_META)
      .map((species) => ({
        species,
        count: animals.filter((a) => a.species === species).length,
        monthlyFood: animals
          .filter((a) => a.species === species)
          .reduce((s, a) => s + (a.monthlyFood ?? 0), 0),
      }))
      .filter((s) => s.count > 0),
    status: ANIMAL_STATUSES.map((status) => ({
      status,
      count: statusCount(status),
    })),
    pledges: {
      total: pledges.length,
      active: active.length,
      monthlyValue: active
        .filter((p) => p.frequency === "MONTHLY")
        .reduce((s, p) => s + p.amount, 0),
      monthlyCount: active.filter((p) => p.frequency === "MONTHLY").length,
      oneTimeValue: active
        .filter((p) => p.frequency === "ONE_TIME")
        .reduce((s, p) => s + p.amount, 0),
      oneTimeCount: active.filter((p) => p.frequency === "ONE_TIME").length,
      byKind: PLEDGE_KINDS.map((kind) => {
        const all = pledges.filter((p) => p.kind === kind);
        const act = all.filter((p) => p.status === "ACTIVE");
        return {
          kind,
          count: all.length,
          amount: all.reduce((s, p) => s + p.amount, 0),
          activeCount: act.length,
          monthlyAmount: act
            .filter((p) => p.frequency === "MONTHLY")
            .reduce((s, p) => s + p.amount, 0),
        };
      }),
      shelterFund: {
        count: pledges.filter((p) => !p.animalId).length,
        activeCount: active.filter((p) => !p.animalId).length,
        monthlyValue: active
          .filter((p) => !p.animalId && p.frequency === "MONTHLY")
          .reduce((s, p) => s + p.amount, 0),
        oneTimeValue: active
          .filter((p) => !p.animalId && p.frequency === "ONE_TIME")
          .reduce((s, p) => s + p.amount, 0),
      },
    },
  };
}

/* ---------------------------------- view ----------------------------------- */

export default function AnimalsView() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  /* ------------------------------- list state ------------------------------ */
  const [animals, setAnimals] = useState<AnimalRow[]>([]);
  const [pledges, setPledges] = useState<PledgeRow[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [pledgesLoading, setPledgesLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  /* --------------------------------- tab ---------------------------------- */
  const [tab, setTab] = useState<"directory" | "analytics">("directory");

  /* ------------------------------- filters -------------------------------- */
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [view, setView] = useViewPref("animals", "table");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  /* --------------------------- animal forms/sheets ------------------------ */
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AnimalRow | null>(null);
  const [form, setForm] = useState<AnimalForm>(EMPTY_ANIMAL_FORM);
  const [snapshot, setSnapshot] = useState(JSON.stringify(EMPTY_ANIMAL_FORM));
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AnimalRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* --------------------------- pledge forms/sheets ------------------------ */
  const [pledgeOpen, setPledgeOpen] = useState(false);
  const [pledgeContext, setPledgeContext] = useState<PledgeContext>(null);
  const [pledgeForm, setPledgeForm] = useState<PledgeForm>(EMPTY_PLEDGE_FORM);
  const [pledgeSnapshot, setPledgeSnapshot] = useState(
    JSON.stringify(EMPTY_PLEDGE_FORM)
  );
  const [savingPledge, setSavingPledge] = useState(false);
  const [pledgeDeleteTarget, setPledgeDeleteTarget] = useState<PledgeRow | null>(
    null
  );
  const [deletingPledge, setDeletingPledge] = useState(false);

  /* ------------------------------ adopt flow ------------------------------ */
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [adoptTarget, setAdoptTarget] = useState<AnimalRow | null>(null);
  const [adopterName, setAdopterName] = useState("");
  const [adoptUserId, setAdoptUserId] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [userMatches, setUserMatches] = useState<UserLite[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  const speciesOptions = useMasters("ANIMAL_SPECIES");

  /* ================================= loading ============================== */

  const loadAnimals = useCallback(async () => {
    try {
      const data = await get<AnimalRow[]>("/api/animals");
      setAnimals(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load animals");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPledges = useCallback(async () => {
    try {
      const data = await get<PledgeRow[]>("/api/animals/pledges");
      setPledges(Array.isArray(data) ? data : []);
    } catch {
      // Pledge list is supplementary — the directory still works without it.
      setPledges([]);
    } finally {
      setPledgesLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const data = await get<Analytics>("/api/animal-analytics");
      setAnalytics(data ?? null);
    } catch {
      // Non-admin or endpoint unavailable — fall back to client-side math.
      setAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    void loadAnimals();
    void loadPledges();
    void loadAnalytics();
  }, [loadAnimals, loadPledges, loadAnalytics]);

  useEffect(() => {
    void loadAnimals();
    void loadPledges();
    void loadAnalytics();
  }, [loadAnimals, loadPledges, loadAnalytics]);

  /* debounce search 300ms */
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [speciesFilter, statusFilter, pageSize]);

  /* ============================== derived data ============================ */

  const effectiveAnalytics = useMemo(
    () => analytics ?? deriveAnalytics(animals, pledges),
    [analytics, animals, pledges]
  );

  const speciesLabel = useCallback(
    (value: string) => {
      const l = labelOf(speciesOptions.options, value);
      return l === value ? titleCase(value) : l;
    },
    [speciesOptions.options]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return animals.filter((a) => {
      if (speciesFilter !== "ALL" && a.species !== speciesFilter) return false;
      if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
      if (
        q &&
        !a.name.toLowerCase().includes(q) &&
        !(a.breed ?? "").toLowerCase().includes(q) &&
        !(a.location ?? "").toLowerCase().includes(q) &&
        !(a.healthStatus ?? "").toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [animals, query, speciesFilter, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      ALL: animals.length,
      AVAILABLE: 0,
      FOSTERED: 0,
      ADOPTED: 0,
      CRITICAL: 0,
    };
    for (const a of animals) counts[a.status] = (counts[a.status] ?? 0) + 1;
    return counts;
  }, [animals]);

  const criticalAnimals = useMemo(
    () => animals.filter((a) => a.status === "CRITICAL"),
    [animals]
  );

  const shelterFundPledges = useMemo(
    () => pledges.filter((p) => !p.animalId),
    [pledges]
  );

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize]
  );

  const detail = useMemo(
    () => animals.find((a) => a.id === detailId) ?? null,
    [animals, detailId]
  );

  const detailPledges = useMemo(() => {
    if (!detail) return [];
    const fromState = pledges.filter((p) => p.animalId === detail.id);
    return fromState.length > 0 ? fromState : (detail.pledges ?? []);
  }, [pledges, detail]);

  const detailMonthlySupport = useMemo(
    () =>
      detailPledges
        .filter((p) => p.status === "ACTIVE" && p.frequency === "MONTHLY")
        .reduce((s, p) => s + p.amount, 0),
    [detailPledges]
  );

  const detailTotalPledged = useMemo(
    () => detailPledges.reduce((s, p) => s + p.amount, 0),
    [detailPledges]
  );

  const filtersActive =
    query.trim() !== "" || speciesFilter !== "ALL" || statusFilter !== "ALL";

  /* ------------------------------- validation ------------------------------ */

  const errors = useMemo<Errors>(() => {
    const age = form.ageMonths.trim() === "" ? NaN : Number(form.ageMonths);
    return {
      name: required("Name")(form.name),
      story: required("Story")(form.story),
      location: required("Location")(form.location),
      ageMonths:
        Number.isFinite(age) && age >= 0 && age <= 600
          ? null
          : "Age must be between 0 and 600 months",
      monthlyFood:
        form.monthlyFood.trim() === ""
          ? null
          : Number.isFinite(Number(form.monthlyFood)) &&
              Number(form.monthlyFood) >= 0 &&
              Number(form.monthlyFood) <= 1_000_000
            ? null
            : "Enter a valid monthly food cost (₹0 – ₹10,00,000)",
    };
  }, [form]);
  const errorCount = Object.values(errors).filter(Boolean).length;
  const dirty = JSON.stringify(form) !== snapshot;

  const pledgeErrors = useMemo<Errors>(() => {
    return {
      donorName: required("Donor name")(pledgeForm.donorName),
      amount: amountRule({
        optional: false,
        min: 1,
        max: 10_000_000,
        label: "Pledge amount",
      })(pledgeForm.amount),
      shelterFund:
        pledgeContext?.mode === "shelter"
          ? required("Fund label")(pledgeForm.shelterFund)
          : null,
    };
  }, [pledgeForm, pledgeContext]);
  const pledgeErrorCount = Object.values(pledgeErrors).filter(Boolean).length;
  const pledgeDirty = JSON.stringify(pledgeForm) !== pledgeSnapshot;

  /* ----------------------------- animal actions ---------------------------- */

  const openCreate = () => {
    setEditing(null);
    const f = {
      ...EMPTY_ANIMAL_FORM,
      species: speciesOptions.options[0]?.value ?? "DOG",
    };
    setForm(f);
    setSnapshot(JSON.stringify(f));
    setFormOpen(true);
  };

  const openEdit = (a: AnimalRow) => {
    setEditing(a);
    const f: AnimalForm = {
      name: a.name ?? "",
      species: a.species ?? "DOG",
      breed: a.breed ?? "",
      ageMonths: String(a.ageMonths ?? 12),
      gender: a.gender ?? "MALE",
      story: a.story ?? "",
      healthStatus: a.healthStatus ?? "",
      vaccinated: !!a.vaccinated,
      sterilized: !!a.sterilized,
      location: a.location ?? "",
      status: a.status ?? "AVAILABLE",
      monthlyFood: a.monthlyFood != null ? String(a.monthlyFood) : "",
    };
    setForm(f);
    setSnapshot(JSON.stringify(f));
    setFormOpen(true);
  };

  const saveAnimal = async () => {
    if (errorCount > 0) {
      toast.error(`${errorCount} field(s) need attention`);
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        species: form.species,
        breed: form.breed.trim(),
        ageMonths: Math.trunc(Number(form.ageMonths || 0)),
        gender: form.gender,
        story: form.story.trim(),
        healthStatus: form.healthStatus.trim(),
        vaccinated: form.vaccinated,
        sterilized: form.sterilized,
        location: form.location.trim(),
        status: form.status,
        monthlyFood: form.monthlyFood.trim() === "" ? 0 : Number(form.monthlyFood),
      };
      if (editing) {
        await patch(`/api/animals/${editing.id}`, body);
        toast.success(`${body.name} updated`);
      } else {
        await post("/api/animals", body);
        toast.success(`${body.name} joined Angel Paws`);
      }
      setFormOpen(false);
      await loadAnimals();
      void loadAnalytics();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const removeAnimal = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del(`/api/animals/${deleteTarget.id}`);
      toast.success(`${deleteTarget.name} removed from the directory`);
      setDeleteTarget(null);
      if (detailId === deleteTarget.id) setDetailId(null);
      await loadAnimals();
      void loadPledges();
      void loadAnalytics();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  /** Quick status change (adopted goes through the adopt FormSheet instead). */
  const setStatus = async (a: AnimalRow, status: string) => {
    setBusyAction(`status-${a.id}-${status}`);
    try {
      await patch(`/api/animals/${a.id}`, { status });
      toast.success(`${a.name} marked ${titleCase(status).toLowerCase()}`);
      await loadAnimals();
      void loadAnalytics();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyAction(null);
    }
  };

  const toggleCare = async (
    a: AnimalRow,
    field: "vaccinated" | "sterilized"
  ) => {
    setBusyAction(`care-${a.id}-${field}`);
    try {
      await patch(`/api/animals/${a.id}`, { [field]: !a[field] });
      toast.success(
        `${a.name} marked ${field === "vaccinated" ? (a.vaccinated ? "not vaccinated" : "vaccinated") : a.sterilized ? "not sterilized" : "sterilized"}`
      );
      await loadAnimals();
      void loadAnalytics();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyAction(null);
    }
  };

  /* ------------------------------ adopt flow ------------------------------- */

  const openAdopt = (a: AnimalRow) => {
    setAdoptTarget(a);
    setAdopterName(a.adoptedByName ?? "");
    setAdoptUserId(a.adoptedById ?? null);
    setUserQuery("");
    setUserMatches([]);
    setAdoptOpen(true);
  };

  const searchUsers = useCallback(async () => {
    if (!userQuery.trim()) {
      setUserMatches([]);
      return;
    }
    setSearchingUsers(true);
    try {
      const rows = await get<UserLite[]>(
        `/api/users?q=${encodeURIComponent(userQuery.trim())}`
      );
      setUserMatches(Array.isArray(rows) ? rows.slice(0, 6) : []);
    } catch {
      setUserMatches([]);
    } finally {
      setSearchingUsers(false);
    }
  }, [userQuery]);

  useEffect(() => {
    if (!adoptOpen || !isAdmin) return;
    const t = window.setTimeout(() => void searchUsers(), 350);
    return () => window.clearTimeout(t);
  }, [adoptOpen, isAdmin, searchUsers]);

  /** Best-effort adoption certificate — never blocks the adoption itself. */
  const issueCertificate = async (a: AnimalRow) => {
    if (!a.adoptedByName) return;
    try {
      const res = await post<{ certificate?: { code?: string } }>(
        "/api/certificates",
        {
          type: "ANIMAL_ADOPTION",
          recipientName: a.adoptedByName,
          userId: a.adoptedById ?? undefined,
          title: "Animal Adoption Certificate",
          description: `Adoption of ${a.name} (${speciesLabel(a.species)})`,
          meta: JSON.stringify({ animal: a.name, species: a.species }),
        }
      );
      const code = res?.certificate?.code;
      if (code) {
        toast.success(`Adoption certificate ${code} issued`, {
          action: {
            label: "Open",
            onClick: () => window.open(`/api/certificates/${code}/html`, "_blank"),
          },
        });
      }
    } catch {
      // Certificate is a bonus — ignore failures.
    }
  };

  const saveAdopt = async () => {
    if (!adoptTarget) return;
    const adopter = adopterName.trim();
    if (!adopter) {
      toast.error("Adopter name is required");
      return;
    }
    setBusyAction("adopt");
    try {
      const updated = await patch<AnimalRow>(`/api/animals/${adoptTarget.id}`, {
        status: "ADOPTED",
        adoptedByName: adopter,
        adoptedById: adoptUserId ?? undefined,
      });
      toast.success(`${adoptTarget.name} adopted by ${adopter}`);
      setAdoptOpen(false);
      await loadAnimals();
      void loadAnalytics();
      void issueCertificate(updated ?? adoptTarget);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Adoption failed");
    } finally {
      setBusyAction(null);
    }
  };

  /* ----------------------------- pledge actions ---------------------------- */

  const openPledgeForAnimal = (a: AnimalRow) => {
    const f = { ...EMPTY_PLEDGE_FORM, kind: "FOOD" };
    setPledgeForm(f);
    setPledgeSnapshot(JSON.stringify(f));
    setPledgeContext({ mode: "animal", animal: a });
    setPledgeOpen(true);
  };

  const openShelterPledge = () => {
    const f = { ...EMPTY_PLEDGE_FORM, kind: "SHELTER" };
    setPledgeForm(f);
    setPledgeSnapshot(JSON.stringify(f));
    setPledgeContext({ mode: "shelter" });
    setPledgeOpen(true);
  };

  const savePledge = async () => {
    if (pledgeErrorCount > 0) {
      toast.error(`${pledgeErrorCount} field(s) need attention`);
      return;
    }
    setSavingPledge(true);
    try {
      const isShelter = pledgeContext?.mode === "shelter";
      const animal = pledgeContext?.mode === "animal" ? pledgeContext.animal : null;
      const donorName = pledgeForm.donorName.trim() || user?.name || "Anonymous Donor";
      await post("/api/animals/pledges", {
        animalId: animal?.id,
        shelterFund: isShelter ? pledgeForm.shelterFund.trim() : undefined,
        donorName,
        kind: pledgeForm.kind,
        amount: Number(pledgeForm.amount),
        frequency: pledgeForm.frequency,
      });
      toast.success(
        isShelter
          ? `${formatINR(Number(pledgeForm.amount))} pledged to ${pledgeForm.shelterFund.trim()}`
          : `${formatINR(Number(pledgeForm.amount))} ${titleCase(pledgeForm.kind).toLowerCase()} pledge recorded for ${animal?.name ?? "the resident"}`
      );
      setPledgeOpen(false);
      await Promise.all([loadPledges(), loadAnimals()]);
      void loadAnalytics();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pledge failed");
    } finally {
      setSavingPledge(false);
    }
  };

  const setPledgeStatus = async (p: PledgeRow, status: string) => {
    setBusyAction(`pledge-${p.id}-${status}`);
    try {
      await patch(`/api/animal-pledges/${p.id}`, { status });
      toast.success(`Pledge marked ${titleCase(status).toLowerCase()}`);
      await Promise.all([loadPledges(), loadAnimals()]);
      void loadAnalytics();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyAction(null);
    }
  };

  const removePledge = async () => {
    if (!pledgeDeleteTarget) return;
    setDeletingPledge(true);
    try {
      await del(`/api/animal-pledges/${pledgeDeleteTarget.id}`);
      toast.success("Pledge deleted");
      setPledgeDeleteTarget(null);
      await Promise.all([loadPledges(), loadAnimals()]);
      void loadAnalytics();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingPledge(false);
    }
  };

  /* ------------------------------- actions menu ---------------------------- */

  const rowMenu = (a: AnimalRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-8"
          aria-label={`Actions for ${a.name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem onSelect={() => setDetailId(a.id)}>
          <Eye className="size-4" aria-hidden="true" /> View details
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openEdit(a)}>
          <Pencil className="size-4" aria-hidden="true" /> Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => setDeleteTarget(a)}
          className="text-red-600 focus:text-red-600 dark:text-red-400"
        >
          <Trash2 className="size-4" aria-hidden="true" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const pledgeMenu = (p: PledgeRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-8"
          aria-label={`Pledge actions for ${p.donorName}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {p.status !== "COMPLETED" && (
          <DropdownMenuItem
            onSelect={() => void setPledgeStatus(p, "COMPLETED")}
            disabled={busyAction === `pledge-${p.id}-COMPLETED`}
          >
            <Check className="size-4" aria-hidden="true" /> Mark completed
          </DropdownMenuItem>
        )}
        {p.status !== "ACTIVE" && (
          <DropdownMenuItem
            onSelect={() => void setPledgeStatus(p, "ACTIVE")}
            disabled={busyAction === `pledge-${p.id}-ACTIVE`}
          >
            <TrendingUp className="size-4" aria-hidden="true" /> Reactivate
          </DropdownMenuItem>
        )}
        {p.status !== "CANCELLED" && (
          <DropdownMenuItem
            onSelect={() => void setPledgeStatus(p, "CANCELLED")}
            disabled={busyAction === `pledge-${p.id}-CANCELLED`}
          >
            <X className="size-4" aria-hidden="true" /> Cancel pledge
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => setPledgeDeleteTarget(p)}
          className="text-red-600 focus:text-red-600 dark:text-red-400"
        >
          <Trash2 className="size-4" aria-hidden="true" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const carePills = (a: AnimalRow) => (
    <div className="flex items-center gap-1" aria-label="Care indicators">
      <span
        title={a.vaccinated ? "Vaccinated" : "Not vaccinated"}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
          a.vaccinated ? CARE_ON : CARE_OFF
        )}
      >
        <Syringe className="size-3" aria-hidden="true" /> Vax
      </span>
      <span
        title={a.sterilized ? "Sterilized" : "Not sterilized"}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
          a.sterilized ? CARE_ON : CARE_OFF
        )}
      >
        <Scissors className="size-3" aria-hidden="true" /> Ster
      </span>
    </div>
  );

  const speciesChip = (a: AnimalRow) => {
    const meta = SPECIES_META[a.species] ?? SPECIES_META.OTHER;
    const Icon = meta.icon;
    return (
      <Badge variant="outline" className={cn("gap-1 font-medium", LIME_CHIP)}>
        <Icon className="size-3" aria-hidden="true" />
        {speciesLabel(a.species)}
      </Badge>
    );
  };

  /* ---------------------------------- CSV ---------------------------------- */

  const csvColumns: CsvColumn<AnimalRow>[] = [
    { header: "Name", value: (a) => a.name },
    { header: "Species", value: (a) => speciesLabel(a.species) },
    { header: "Breed", value: (a) => a.breed ?? "" },
    { header: "Age (months)", value: (a) => a.ageMonths },
    { header: "Age", value: (a) => ageText(a.ageMonths) },
    { header: "Gender", value: (a) => titleCase(a.gender) },
    { header: "Health status", value: (a) => a.healthStatus ?? "" },
    { header: "Vaccinated", value: (a) => (a.vaccinated ? "Yes" : "No") },
    { header: "Sterilized", value: (a) => (a.sterilized ? "Yes" : "No") },
    { header: "Location", value: (a) => a.location },
    { header: "Monthly food (INR)", value: (a) => a.monthlyFood },
    { header: "Status", value: (a) => a.status },
    { header: "Adopted by", value: (a) => a.adoptedByName ?? "" },
    { header: "Pledges", value: (a) => (a.pledges ?? []).length },
  ];

  /* ------------------------------- table cols ------------------------------ */

  const animalColumns: DataTableColumn<AnimalRow>[] = [
    {
      key: "name",
      header: "Name",
      accessor: (a) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{a.name}</p>
          {a.adoptedByName ? (
            <p className="truncate text-xs text-muted-foreground">
              Adopted by {a.adoptedByName}
            </p>
          ) : null}
        </div>
      ),
    },
    { key: "species", header: "Species", accessor: (a) => speciesChip(a) },
    {
      key: "breed",
      header: "Breed",
      hideBelow: "md",
      accessor: (a) => (
        <span className="block max-w-40 truncate text-muted-foreground" title={a.breed ?? ""}>
          {a.breed || "—"}
        </span>
      ),
    },
    {
      key: "age",
      header: "Age",
      hideBelow: "lg",
      accessor: (a) => (
        <span className="tabular-nums text-muted-foreground">
          {ageText(a.ageMonths)}
        </span>
      ),
    },
    {
      key: "gender",
      header: "Gender",
      hideBelow: "lg",
      accessor: (a) => (
        <span className="text-muted-foreground">{titleCase(a.gender)}</span>
      ),
    },
    {
      key: "health",
      header: "Health",
      hideBelow: "lg",
      accessor: (a) => (
        <span
          className="block max-w-36 truncate text-muted-foreground"
          title={a.healthStatus ?? ""}
        >
          {a.healthStatus || "—"}
        </span>
      ),
    },
    { key: "care", header: "Care", accessor: (a) => carePills(a) },
    {
      key: "location",
      header: "Location",
      hideBelow: "sm",
      accessor: (a) => (
        <span
          className="block max-w-44 truncate text-muted-foreground"
          title={a.location}
        >
          {a.location}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      accessor: (a) => <StatusBadge status={a.status} />,
    },
    {
      key: "monthlyFood",
      header: "Monthly food",
      align: "right",
      mono: true,
      accessor: (a) => (
        <span className="font-medium">{formatINR(a.monthlyFood)}</span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "w-12",
      accessor: (a) => rowMenu(a),
    },
  ];

  /* -------------------------------- renderers ------------------------------ */

  const emptyState = (
    <EmptyState
      icon={<PawPrint className="size-8" aria-hidden="true" />}
      title={
        filtersActive
          ? "No animals match these filters"
          : "No rescue residents yet"
      }
      hint={
        filtersActive
          ? "Try a different search term, species or status — or clear the filters."
          : "Add the first rescue to Angel Paws — track health, foster and adoption, food costs and donor pledges."
      }
    >
      {filtersActive ? (
        <Button
          variant="outline"
          onClick={() => {
            setSearch("");
            setSpeciesFilter("ALL");
            setStatusFilter("ALL");
          }}
        >
          <X className="size-4" aria-hidden="true" /> Clear filters
        </Button>
      ) : (
        <Button onClick={openCreate}>
          <Plus className="size-4" aria-hidden="true" /> Add animal
        </Button>
      )}
    </EmptyState>
  );

  const gridSkeleton = (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-52 rounded-xl" />
      ))}
    </div>
  );

  const listSkeleton = (
    <div className="space-y-2" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );

  const renderGrid = () => (
    <div
      className="grid max-h-[36rem] gap-4 overflow-y-auto scrollbar-thin sm:grid-cols-2 xl:grid-cols-3"
      role="list"
      aria-label="Rescue animals"
    >
      {paged.map((a) => {
        const meta = SPECIES_META[a.species] ?? SPECIES_META.OTHER;
        const Icon = meta.icon;
        return (
          <div
            key={a.id}
            role="listitem"
            className="flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-accent/40"
            onClick={() => setDetailId(a.id)}
          >
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-lg border",
                  LIME_CHIP
                )}
              >
                <Icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{a.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {a.breed || meta.label} · {ageText(a.ageMonths)}
                </p>
              </div>
              <StatusBadge status={a.status} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {a.healthStatus ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-emerald-500/30 bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-400"
                >
                  <HeartPulse className="size-3" aria-hidden="true" />
                  <span className="max-w-36 truncate">{a.healthStatus}</span>
                </Badge>
              ) : null}
              {a.vaccinated ? (
                <Badge variant="outline" className={cn("gap-1 font-medium", CARE_ON)}>
                  <Syringe className="size-3" aria-hidden="true" /> Vaccinated
                </Badge>
              ) : null}
              {a.sterilized ? (
                <Badge variant="outline" className={cn("gap-1 font-medium", CARE_ON)}>
                  <Scissors className="size-3" aria-hidden="true" /> Sterilized
                </Badge>
              ) : null}
            </div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{a.location}</span>
            </p>
            <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
              <Badge variant="outline" className={cn("font-mono text-xs", LIME_CHIP)}>
                {formatINRCompact(a.monthlyFood)}/mo food
              </Badge>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`View ${a.name}`}
                  onClick={() => setDetailId(a.id)}
                >
                  <Eye className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Edit ${a.name}`}
                  onClick={() => openEdit(a)}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
                {rowMenu(a)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderList = () => (
    <div
      className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin"
      role="list"
      aria-label="Rescue animals"
    >
      {paged.map((a) => {
        const meta = SPECIES_META[a.species] ?? SPECIES_META.OTHER;
        const Icon = meta.icon;
        return (
          <div
            key={a.id}
            role="listitem"
            className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40"
            onClick={() => setDetailId(a.id)}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg border",
                LIME_CHIP
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {a.name}
                {a.adoptedByName ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · adopted by {a.adoptedByName}
                  </span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {a.breed || meta.label} · {ageText(a.ageMonths)} · {a.location}
              </p>
            </div>
            <StatusBadge status={a.status} className="hidden sm:inline-flex" />
            <span className="hidden w-20 shrink-0 text-right font-mono text-sm font-medium tabular-nums sm:block">
              {formatINR(a.monthlyFood)}
            </span>
            {rowMenu(a)}
          </div>
        );
      })}
    </div>
  );

  /* --------------------------------- charts -------------------------------- */

  const speciesChart = effectiveAnalytics.species
    .map((s) => ({
      name: speciesLabel(s.species),
      value: s.count,
      food: s.monthlyFood,
      fill: SPECIES_COLOR(s.species),
    }))
    .filter((s) => s.value > 0);

  const statusChart = ANIMAL_STATUSES.map((s) => ({
    status: STATUS_META[s].label,
    count: effectiveAnalytics.status.find((x) => x.status === s)?.count ?? 0,
    fill: STATUS_META[s].dot,
  }));

  const kindChart = effectiveAnalytics.pledges.byKind
    .map((k) => ({
      name: KIND_META[k.kind]?.label ?? titleCase(k.kind),
      count: k.count,
      amount: k.amount,
      fill: KIND_META[k.kind]?.dot ?? "#71717a",
    }))
    .filter((k) => k.count > 0);

  const foodChart = effectiveAnalytics.species
    .map((s) => ({
      species: speciesLabel(s.species),
      food: s.monthlyFood,
    }))
    .filter((s) => s.food > 0)
    .sort((a, b) => b.food - a.food);

  /* ================================= render ================================ */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Animal Welfare"
        description="Angel Paws — rescue residents, foster families, adoptions and the donors who keep bowls full."
        icon={<PawPrint className="size-5" aria-hidden="true" />}
        actions={
          <Button variant="outline" onClick={refreshAll} aria-label="Refresh animal welfare data">
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "directory" | "analytics")}>
        <TabsList className="h-auto w-full flex-wrap sm:w-auto">
          <TabsTrigger value="directory">
            Rescue directory
            <Badge variant="outline" className="ml-1.5 px-1.5 tabular-nums">
              {animals.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="mr-1 size-3.5" aria-hidden="true" /> Analytics
          </TabsTrigger>
        </TabsList>

        {/* ============================ DIRECTORY ============================ */}
        <TabsContent value="directory" className="mt-4 space-y-4">
          {/* critical cases banner */}
          {criticalAnimals.length > 0 && !loading ? (
            <div
              className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3"
              role="alert"
            >
              <TriangleAlert
                className="size-4 shrink-0 text-red-600 dark:text-red-400"
                aria-hidden="true"
              />
              <p className="min-w-0 flex-1 text-sm text-red-700 dark:text-red-300">
                <strong className="font-semibold">
                  {criticalAnimals.length} critical case{criticalAnimals.length === 1 ? "" : "s"}
                </strong>{" "}
                need urgent care right now.
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {criticalAnimals.slice(0, 3).map((a) => (
                  <Button
                    key={a.id}
                    variant="outline"
                    size="sm"
                    className="border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-300"
                    onClick={() => setDetailId(a.id)}
                    aria-label={`Quick view ${a.name}`}
                  >
                    <Eye className="size-3.5" aria-hidden="true" /> {a.name}
                  </Button>
                ))}
                {criticalAnimals.length > 3 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-300"
                    onClick={() => setStatusFilter("CRITICAL")}
                  >
                    View all
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-60">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, breed, location…"
                aria-label="Search animals"
                className="pl-8"
              />
            </div>

            <select
              aria-label="Filter by species"
              value={speciesFilter}
              onChange={(e) => {
                setSpeciesFilter(e.target.value);
                setPage(1);
              }}
              className={cn(NATIVE_SELECT_CLS, "w-full sm:w-40")}
            >
              <option value="ALL">All species</option>
              {speciesOptions.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {/* status chips with counts */}
            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Filter by status"
            >
              {(["ALL", ...ANIMAL_STATUSES] as const).map((s) => {
                const active = statusFilter === s;
                const meta = s === "ALL" ? null : STATUS_META[s];
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setStatusFilter(s);
                      setPage(1);
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? (meta?.cls ??
                            "border-primary bg-primary/10 text-primary")
                        : "border-border bg-background text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {s === "ALL" ? "All" : meta?.label}
                    <span className="ml-1 tabular-nums opacity-70">
                      {statusCounts[s] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>

            {filtersActive ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setSpeciesFilter("ALL");
                  setStatusFilter("ALL");
                }}
              >
                <X className="size-3.5" aria-hidden="true" /> Clear
              </Button>
            ) : null}

            <span className="text-xs tabular-nums text-muted-foreground">
              {filtered.length} of {animals.length}
            </span>

            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <ExportMenu
                columns={csvColumns}
                rows={filtered}
                filename="uar-animals"
                disabled={filtered.length === 0}
              />
              <ViewSwitcher value={view} onChange={setView} />
              <Button size="sm" onClick={openCreate} aria-label="Add animal">
                <Plus className="size-4" aria-hidden="true" /> Add animal
              </Button>
            </div>
          </div>

          {/* views */}
          {view === "table" ? (
            <DataTable
              columns={animalColumns}
              rows={paged}
              rowKey={(a) => a.id}
              loading={loading}
              skeletonRows={7}
              height="fill"
              fillOffset={400}
              onRowClick={(a) => setDetailId(a.id)}
              page={safePage}
              pages={pages}
              total={filtered.length}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(n) => {
                setPageSize(n);
                setPage(1);
              }}
              itemLabel="animals"
              empty={emptyState}
            />
          ) : loading ? (
            view === "grid" ? (
              gridSkeleton
            ) : (
              listSkeleton
            )
          ) : filtered.length === 0 ? (
            emptyState
          ) : (
            <>
              {view === "grid" ? renderGrid() : renderList()}
              <PaginationBar
                page={safePage}
                pages={pages}
                total={filtered.length}
                onPage={setPage}
                itemLabel="animals"
              />
            </>
          )}
        </TabsContent>

        {/* ============================ ANALYTICS ============================ */}
        <TabsContent value="analytics" className="mt-4 space-y-4">
          {/* KPI strip */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Rescue residents"
              value={effectiveAnalytics.animals.total.toLocaleString("en-IN")}
              hint={`${effectiveAnalytics.animals.vaccinated} vaccinated · ${effectiveAnalytics.animals.sterilized} sterilized`}
              icon={<PawPrint className="size-5" aria-hidden="true" />}
              accent="lime"
              loading={analyticsLoading}
            />
            <StatCard
              label="Available"
              value={effectiveAnalytics.animals.available.toLocaleString("en-IN")}
              hint="ready for adoption today"
              icon={<HeartPulse className="size-5" aria-hidden="true" />}
              accent="emerald"
              loading={analyticsLoading}
            />
            <StatCard
              label="Fostered"
              value={effectiveAnalytics.animals.fostered.toLocaleString("en-IN")}
              hint="in foster families & partner care"
              icon={<Home className="size-5" aria-hidden="true" />}
              accent="amber"
              loading={analyticsLoading}
            />
            <StatCard
              label="Adopted"
              value={effectiveAnalytics.animals.adopted.toLocaleString("en-IN")}
              hint="found their forever homes"
              icon={<UserCheck className="size-5" aria-hidden="true" />}
              accent="teal"
              loading={analyticsLoading}
            />
            <StatCard
              label="Critical rescues"
              value={effectiveAnalytics.animals.critical.toLocaleString("en-IN")}
              hint="need urgent medical care"
              icon={<TriangleAlert className="size-5" aria-hidden="true" />}
              accent="red"
              loading={analyticsLoading}
            />
            <StatCard
              label="Monthly food commitment"
              value={formatINRCompact(effectiveAnalytics.animals.monthlyFoodCommitment)}
              hint="total cost of feeding all residents"
              icon={<Wallet className="size-5" aria-hidden="true" />}
              accent="lime"
              loading={analyticsLoading}
            />
            <StatCard
              label="Active pledges"
              value={effectiveAnalytics.pledges.active.toLocaleString("en-IN")}
              hint={`${effectiveAnalytics.pledges.total.toLocaleString("en-IN")} recorded all-time`}
              icon={<HandCoins className="size-5" aria-hidden="true" />}
              accent="orange"
              loading={analyticsLoading}
            />
            <StatCard
              label="Monthly pledge value"
              value={`${formatINRCompact(effectiveAnalytics.pledges.monthlyValue)}/mo`}
              hint={`+ ${formatINRCompact(effectiveAnalytics.pledges.oneTimeValue)} one-time pledged`}
              icon={<Banknote className="size-5" aria-hidden="true" />}
              accent="teal"
              loading={analyticsLoading}
            />
          </div>

          {analyticsLoading ? (
            <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-72 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* species distribution donut */}
              <SectionCard
                title="Species distribution"
                description="Residents across the rescue, by species"
                icon={<PawPrint className="size-4" aria-hidden="true" />}
              >
                {speciesChart.length === 0 ? (
                  <EmptyState
                    icon={<PawPrint className="size-6" aria-hidden="true" />}
                    title="No residents yet"
                    hint="Species mix charts here as animals are added."
                  />
                ) : (
                  <>
                    <ChartContainer config={{}} className="aspect-auto h-44 w-full sm:h-56">
                      <PieChart>
                        <Pie
                          data={speciesChart}
                          dataKey="value"
                          nameKey="name"
                          innerRadius="55%"
                          outerRadius="85%"
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {speciesChart.map((s) => (
                            <Cell key={s.name} fill={s.fill} />
                          ))}
                        </Pie>
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(value, name) => (
                                <span className="flex w-full items-center justify-between gap-4">
                                  <span className="text-muted-foreground">{String(name)}</span>
                                  <span className="font-mono font-medium tabular-nums">
                                    {Number(value)} animal{Number(value) === 1 ? "" : "s"}
                                  </span>
                                </span>
                              )}
                            />
                          }
                        />
                      </PieChart>
                    </ChartContainer>
                    <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                      {speciesChart.map((s) => (
                        <li key={s.name} className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: s.fill }}
                          />
                          <span className="truncate">{s.name}</span>
                          <span className="ml-auto font-medium tabular-nums">
                            {s.value} · {formatINRCompact(s.food)}/mo
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </SectionCard>

              {/* status breakdown bar */}
              <SectionCard
                title="Adoption pipeline"
                description="Available → fostered → adopted, plus critical cases"
                icon={<TrendingUp className="size-4" aria-hidden="true" />}
              >
                <ChartContainer config={{}} className="aspect-auto h-44 w-full sm:h-56">
                  <BarChart data={statusChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="status"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value, name) => (
                            <span className="flex w-full items-center justify-between gap-4">
                              <span className="text-muted-foreground">{String(name)}</span>
                              <span className="font-mono font-medium tabular-nums">
                                {Number(value)} animal{Number(value) === 1 ? "" : "s"}
                              </span>
                            </span>
                          )}
                        />
                      }
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
                      {statusChart.map((s) => (
                        <Cell key={s.status} fill={s.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </SectionCard>

              {/* pledge kind split */}
              <SectionCard
                title="Pledge kind split"
                description="Food, medical, vaccination and shelter support"
                icon={<HandCoins className="size-4" aria-hidden="true" />}
              >
                {kindChart.length === 0 ? (
                  <EmptyState
                    icon={<HandCoins className="size-6" aria-hidden="true" />}
                    title="No pledges recorded yet"
                    hint="Donor pledges — food, medical, vaccination or shelter — chart here as they come in. Add the first one from a resident's profile or the shelter fund below."
                  />
                ) : (
                  <>
                    <ChartContainer config={{}} className="aspect-auto h-44 w-full sm:h-56">
                      <PieChart>
                        <Pie
                          data={kindChart}
                          dataKey="count"
                          nameKey="name"
                          innerRadius="55%"
                          outerRadius="85%"
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {kindChart.map((k) => (
                            <Cell key={k.name} fill={k.fill} />
                          ))}
                        </Pie>
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(value, name, item) => (
                                <span className="flex w-full items-center justify-between gap-4">
                                  <span className="text-muted-foreground">{String(name)}</span>
                                  <span className="font-mono font-medium tabular-nums">
                                    {Number(value)} pledge{Number(value) === 1 ? "" : "s"}
                                    {item?.payload?.amount
                                      ? ` · ${formatINRCompact(Number(item.payload.amount))}`
                                      : ""}
                                  </span>
                                </span>
                              )}
                            />
                          }
                        />
                      </PieChart>
                    </ChartContainer>
                    <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                      {kindChart.map((k) => (
                        <li key={k.name} className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: k.fill }}
                          />
                          <span className="truncate">{k.name}</span>
                          <span className="ml-auto font-medium tabular-nums">
                            {k.count} · {formatINRCompact(k.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </SectionCard>

              {/* monthly food cost by species */}
              <SectionCard
                title="Monthly food cost by species"
                description="Where the feeding budget goes every month"
                icon={<UtensilsCrossed className="size-4" aria-hidden="true" />}
              >
                {foodChart.length === 0 ? (
                  <EmptyState
                    icon={<UtensilsCrossed className="size-6" aria-hidden="true" />}
                    title="No food costs recorded"
                    hint="Set a monthly food cost on each resident to see the feeding budget split."
                  />
                ) : (
                  <ChartContainer
                    config={{ food: { label: "Monthly food", color: "#84cc16" } }}
                    className="aspect-auto h-44 w-full sm:h-56"
                  >
                    <BarChart data={foodChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis
                        dataKey="species"
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={54}
                        tickFormatter={(v: number) => formatINRCompact(v)}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value, name) => (
                              <span className="flex w-full items-center justify-between gap-4">
                                <span className="text-muted-foreground">{String(name)}</span>
                                <span className="font-mono font-medium tabular-nums">
                                  {formatINR(Number(value))}
                                </span>
                              </span>
                            )}
                          />
                        }
                      />
                      <Bar dataKey="food" fill="var(--color-food)" radius={[6, 6, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ChartContainer>
                )}
              </SectionCard>
            </div>
          )}

          {/* shelter fund pool */}
          <SectionCard
            title="Shelter fund"
            description="Pledges not tied to a specific animal — the shared pool for kennels, bedding, rent and vet bills."
            icon={<Home className="size-5" aria-hidden="true" />}
            actions={
              <Button size="sm" onClick={openShelterPledge}>
                <Plus className="size-4" aria-hidden="true" /> Add shelter fund pledge
              </Button>
            }
          >
            <div
              className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm"
              aria-label="Shelter fund summary"
            >
              <span className="flex items-center gap-1.5 font-semibold text-foreground">
                <Home className="size-4 text-lime-600 dark:text-lime-400" aria-hidden="true" />
                Pool
              </span>
              <span className="text-muted-foreground">
                <strong className="font-semibold text-foreground tabular-nums">
                  {effectiveAnalytics.pledges.shelterFund.activeCount}
                </strong>{" "}
                active of {effectiveAnalytics.pledges.shelterFund.count} pledges
              </span>
              <span className="text-muted-foreground">
                <strong className="font-semibold text-foreground tabular-nums">
                  {formatINR(effectiveAnalytics.pledges.shelterFund.monthlyValue)}
                </strong>{" "}
                /month
              </span>
              <span className="text-muted-foreground">
                <strong className="font-semibold text-foreground tabular-nums">
                  {formatINR(effectiveAnalytics.pledges.shelterFund.oneTimeValue)}
                </strong>{" "}
                one-time pledged
              </span>
            </div>

            {pledgesLoading ? (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 rounded-lg" />
                ))}
              </div>
            ) : shelterFundPledges.length === 0 ? (
              <EmptyState
                icon={<Home className="size-8" aria-hidden="true" />}
                title="The shelter fund is waiting for its first pledge"
                hint="Monthly and one-time gifts to the shared pool keep kennels warm, beds dry and emergency vet bills covered — even when a pledge isn't tied to one specific resident."
              >
                <Button onClick={openShelterPledge}>
                  <Plus className="size-4" aria-hidden="true" /> Add shelter fund pledge
                </Button>
              </EmptyState>
            ) : (
              <ul className="scrollbar-thin max-h-72 space-y-1.5 overflow-y-auto text-sm">
                {shelterFundPledges.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2"
                  >
                    {kindChip(p.kind)}
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {p.donorName}
                      {p.shelterFund ? (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · {p.shelterFund}
                        </span>
                      ) : null}
                    </span>
                    <Badge variant="outline" className="font-mono">
                      {formatINR(p.amount)} · {titleCase(p.frequency)}
                    </Badge>
                    <StatusBadge status={p.status} />
                    {p.createdAt ? (
                      <span className="hidden text-xs text-muted-foreground sm:inline">
                        {formatDate(p.createdAt)}
                      </span>
                    ) : null}
                    {pledgeMenu(p)}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* ========================== ANIMAL DETAIL SHEET ========================== */}
      <DetailSheet
        open={!!detail}
        onOpenChange={(o) => !o && setDetailId(null)}
        eyebrow="Angel Paws · Animal Welfare"
        title={detail?.name ?? ""}
        description={
          detail
            ? `${speciesLabel(detail.species)}${detail.breed ? ` · ${detail.breed}` : ""} · ${ageText(detail.ageMonths)} · ${detail.location}`
            : undefined
        }
        status={
          detail ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {speciesChip(detail)}
              <StatusBadge status={detail.status} />
            </div>
          ) : null
        }
        actions={
          detail ? (
            <Button variant="outline" size="sm" onClick={() => openEdit(detail)}>
              <Pencil className="size-3.5" aria-hidden="true" /> Edit
            </Button>
          ) : null
        }
        footer={
          detail ? (
            <div className="flex w-full flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={detail.status === "ADOPTED" || busyAction !== null}
                onClick={() => openAdopt(detail)}
              >
                <UserCheck className="size-3.5" aria-hidden="true" />
                {detail.status === "ADOPTED" ? "Adopted" : "Mark adopted"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={detail.status === "FOSTERED" || busyAction !== null}
                onClick={() => void setStatus(detail, "FOSTERED")}
              >
                <Home className="size-3.5" aria-hidden="true" /> Mark fostered
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={detail.status === "CRITICAL" || busyAction !== null}
                onClick={() => void setStatus(detail, "CRITICAL")}
                className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
              >
                <TriangleAlert className="size-3.5" aria-hidden="true" /> Mark critical
              </Button>
              <span className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyAction !== null}
                  onClick={() => void toggleCare(detail, "vaccinated")}
                >
                  <Syringe className="size-3.5" aria-hidden="true" />
                  {detail.vaccinated ? "Unmark vaccinated" : "Toggle vaccinated"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyAction !== null}
                  onClick={() => void toggleCare(detail, "sterilized")}
                >
                  <Scissors className="size-3.5" aria-hidden="true" />
                  {detail.sterilized ? "Unmark sterilized" : "Toggle sterilized"}
                </Button>
              </span>
            </div>
          ) : null
        }
      >
        {detail ? (
          <Tabs
            defaultValue="overview"
            className="gap-5"
          >
            <TabsList className="h-auto w-full flex-wrap justify-start">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="health">Health &amp; care</TabsTrigger>
              <TabsTrigger value="adoption">Adoption</TabsTrigger>
              <TabsTrigger value="pledges">
                Pledges
                <Badge variant="outline" className="ml-1.5 px-1.5 tabular-nums">
                  {detailPledges.length}
                </Badge>
              </TabsTrigger>
            </TabsList>

            {/* ---------------------------- OVERVIEW ---------------------------- */}
            <TabsContent value="overview" className="space-y-6">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MiniStat label="Monthly food" value={formatINR(detail.monthlyFood)} />
                <MiniStat
                  label="Donor support"
                  value={`${formatINRCompact(detailMonthlySupport)}/mo`}
                />
                <MiniStat
                  label="Shortfall"
                  value={formatINRCompact(Math.max(0, detail.monthlyFood - detailMonthlySupport))}
                />
                <MiniStat label="Pledges" value={String(detailPledges.length)} />
              </div>

              <DetailSection title="Profile" description="Who this resident is and where they came from.">
                <DetailGrid cols={4}>
                  <DataField label="Species" value={speciesLabel(detail.species)} />
                  <DataField label="Breed" value={detail.breed ?? null} />
                  <DataField
                    label="Age"
                    value={`${ageText(detail.ageMonths)} (${detail.ageMonths} months)`}
                  />
                  <DataField label="Gender" value={titleCase(detail.gender)} />
                  <DataField
                    label="Location"
                    value={detail.location}
                    icon={<MapPin className="size-3" aria-hidden="true" />}
                  />
                  <DataField label="Health status" value={detail.healthStatus ?? null} />
                  <DataField
                    label="Resident since"
                    value={detail.createdAt ? formatDate(detail.createdAt) : null}
                  />
                  <DataField label="Reference" value={detail.id} mono copy />
                </DetailGrid>
                <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Rescue story
                  </p>
                  <p className="mt-1 text-sm leading-relaxed">{detail.story || "—"}</p>
                </div>
              </DetailSection>

              <DetailSection
                title="Food & cost"
                description="What it costs to keep this resident fed, and what donors cover."
              >
                <DetailGrid cols={4}>
                  <DataField
                    label="Monthly food"
                    value={formatINR(detail.monthlyFood)}
                    mono
                  />
                  <DataField
                    label="Monthly donor support"
                    value={
                      <span>
                        {formatINR(detailMonthlySupport)}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {detailPledges.filter((p) => p.status === "ACTIVE" && p.frequency === "MONTHLY").length} active monthly
                          pledge(s)
                        </span>
                      </span>
                    }
                    mono
                  />
                  <DataField label="Total pledged (all time)" value={formatINR(detailTotalPledged)} mono />
                  <DataField
                    label="Monthly shortfall"
                    value={
                      <span>
                        {formatINR(Math.max(0, detail.monthlyFood - detailMonthlySupport))}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {detail.monthlyFood - detailMonthlySupport > 0
                            ? "Not yet fully covered by pledges"
                            : "Fully covered by donors"}
                        </span>
                      </span>
                    }
                    mono
                  />
                </DetailGrid>
              </DetailSection>
            </TabsContent>

            {/* -------------------------- HEALTH & CARE -------------------------- */}
            <TabsContent value="health" className="space-y-6">
              <DetailSection
                title="Preventive care"
                description="Toggle vaccination and sterilization right here — changes save instantly."
                actions={
                  busyAction === `care-${detail.id}-vaccinated` ||
                  busyAction === `care-${detail.id}-sterilized` ? (
                    <Skeleton className="h-6 w-24" />
                  ) : null
                }
              >
                <DetailGrid cols={2}>
                  <SwitchField
                    label="Vaccinated"
                    hint={detail.vaccinated ? "Vaccination complete" : "Vaccination pending"}
                    checked={detail.vaccinated}
                    disabled={busyAction !== null}
                    onChange={() => void toggleCare(detail, "vaccinated")}
                  />
                  <SwitchField
                    label="Sterilized"
                    hint={detail.sterilized ? "Sterilization complete" : "Sterilization pending"}
                    checked={detail.sterilized}
                    disabled={busyAction !== null}
                    onChange={() => void toggleCare(detail, "sterilized")}
                  />
                </DetailGrid>
              </DetailSection>

              <DetailSection
                title="Medical condition"
                description="Free-text health status shown as a badge across the module."
                actions={
                  <Button variant="outline" size="sm" onClick={() => openEdit(detail)}>
                    <Pencil className="size-3.5" aria-hidden="true" /> Update
                  </Button>
                }
              >
                <p className="min-h-10 whitespace-pre-wrap rounded-lg border bg-muted/30 px-3 py-2.5 text-sm leading-relaxed">
                  {detail.healthStatus || "No condition recorded — mark a status in the edit form."}
                </p>
              </DetailSection>
            </TabsContent>

            {/* ---------------------------- ADOPTION ---------------------------- */}
            <TabsContent value="adoption" className="space-y-6">
              <DetailSection
                title="Adoption pipeline"
                description="Foster and adoption status with the adopter on record."
                actions={
                  detail.status !== "ADOPTED" ? (
                    <Button variant="outline" size="sm" onClick={() => openAdopt(detail)}>
                      <UserCheck className="size-3.5" aria-hidden="true" /> Mark adopted…
                    </Button>
                  ) : null
                }
              >
                <DetailGrid cols={3}>
                  <DataField label="Current status" value={<StatusBadge status={detail.status} />} />
                  <DataField label="Adopted by" value={detail.adoptedByName ?? null} />
                  <DataField label="Adopter ID" value={detail.adoptedById ?? null} mono />
                </DetailGrid>
              </DetailSection>

              <DetailSection
                title="Status actions"
                description="Move the resident through the care pipeline — each change is logged."
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={detail.status === "AVAILABLE" || busyAction !== null}
                    onClick={() => void setStatus(detail, "AVAILABLE")}
                  >
                    <HeartPulse className="size-3.5" aria-hidden="true" /> Mark available
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={detail.status === "FOSTERED" || busyAction !== null}
                    onClick={() => void setStatus(detail, "FOSTERED")}
                  >
                    <Home className="size-3.5" aria-hidden="true" /> Mark fostered
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={detail.status === "CRITICAL" || busyAction !== null}
                    onClick={() => void setStatus(detail, "CRITICAL")}
                    className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  >
                    <TriangleAlert className="size-3.5" aria-hidden="true" /> Mark critical
                  </Button>
                </div>
              </DetailSection>
            </TabsContent>

            {/* ---------------------------- PLEDGES ---------------------------- */}
            <TabsContent value="pledges" className="space-y-6">
              <DetailSection
                title="Pledges"
                description="Donor commitments backing this resident's care."
                actions={
                  <Button variant="outline" size="sm" onClick={() => openPledgeForAnimal(detail)}>
                    <Plus className="size-3.5" aria-hidden="true" /> Add pledge
                  </Button>
                }
              >
                {detailPledges.length === 0 ? (
                  <EmptyState
                    icon={<HandCoins className="size-8" aria-hidden="true" />}
                    title={`No pledges for ${detail.name} yet`}
                    hint={`A ${formatINR(detail.monthlyFood) || "₹900"}/mo food pledge keeps this ${speciesLabel(detail.species).toLowerCase()}'s bowl full. Donors can pledge food, medical care, vaccinations or shelter support.`}
                  >
                    <Button onClick={() => openPledgeForAnimal(detail)}>
                      <Plus className="size-4" aria-hidden="true" /> Add pledge
                    </Button>
                  </EmptyState>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {detailPledges.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2"
                      >
                        {kindChip(p.kind)}
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {p.donorName}
                        </span>
                        <Badge variant="outline" className="font-mono">
                          {formatINR(p.amount)} · {titleCase(p.frequency)}
                        </Badge>
                        <StatusBadge status={p.status} />
                        {p.createdAt ? (
                          <span className="hidden text-xs text-muted-foreground sm:inline">
                            {formatDate(p.createdAt)}
                          </span>
                        ) : null}
                        {pledgeMenu(p)}
                      </li>
                    ))}
                  </ul>
                )}
              </DetailSection>
            </TabsContent>
          </Tabs>
        ) : null}
      </DetailSheet>

      {/* ======================= ADD / EDIT ANIMAL (FormSheet) ======================= */}
      <FormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? `Edit ${editing.name}` : "Add animal"}
        description={
          editing
            ? "Update the resident's record — changes apply immediately."
            : "Register a new rescue with Angel Paws — profile, health flags and food cost."
        }
        badge={editing ? <Badge variant="outline">Editing</Badge> : null}
        onSubmit={saveAnimal}
        submitLabel={editing ? "Save changes" : "Add animal"}
        loading={saving}
        dirty={dirty}
        size="lg"
      >
        <FormSection title="Profile" description="Identity, species and where the animal lives.">
          <FieldGrid>
            <TextField
              label="Name"
              required
              value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              error={errors.name ?? null}
              placeholder="Brownie"
            />
            <SelectField
              label="Species"
              required
              value={form.species}
              onChange={(v) => setForm((f) => ({ ...f, species: v }))}
              options={
                speciesOptions.options.length > 0
                  ? speciesOptions.options.map((o) => ({ value: o.value, label: o.label }))
                  : Object.entries(SPECIES_META).map(([value, m]) => ({
                      value,
                      label: m.label,
                    }))
              }
            />
            <TextField
              label="Breed"
              value={form.breed}
              onChange={(v) => setForm((f) => ({ ...f, breed: v }))}
              placeholder="Indie, Hallikar mix…"
              hint="Optional — leave blank for mixed or unknown."
            />
            <TextField
              label="Age (months)"
              required
              type="number"
              min="0"
              max="600"
              inputMode="numeric"
              value={form.ageMonths}
              onChange={(v) => setForm((f) => ({ ...f, ageMonths: v }))}
              error={errors.ageMonths ?? null}
              hint={form.ageMonths !== "" && Number.isFinite(Number(form.ageMonths)) ? `≈ ${ageText(Number(form.ageMonths))} old` : "24 months = 2y"}
            />
            <SelectField
              label="Gender"
              required
              value={form.gender}
              onChange={(v) => setForm((f) => ({ ...f, gender: v }))}
              options={GENDERS.map((g) => ({ value: g, label: titleCase(g) }))}
            />
            <TextField
              label="Location"
              required
              value={form.location}
              onChange={(v) => setForm((f) => ({ ...f, location: v }))}
              error={errors.location ?? null}
              placeholder="HSR Layout, Bengaluru"
            />
          </FieldGrid>
          <TextareaField
            label="Rescue story"
            required
            rows={4}
            value={form.story}
            onChange={(v) => setForm((f) => ({ ...f, story: v }))}
            error={errors.story ?? null}
            placeholder="Where they were rescued, how they're healing, and the home they're hoping for…"
          />
        </FormSection>

        <FormSection title="Health & care" description="Medical condition and preventive care flags.">
          <TextField
            label="Health status"
            value={form.healthStatus}
            onChange={(v) => setForm((f) => ({ ...f, healthStatus: v }))}
            placeholder="Healthy, recovering, fracture surgery pending…"
            hint="Free text — shown as a badge across the module."
          />
          <FieldGrid>
            <SwitchField
              label="Vaccinated"
              hint="Rabies & core vaccines done"
              checked={form.vaccinated}
              onChange={(v) => setForm((f) => ({ ...f, vaccinated: v }))}
            />
            <SwitchField
              label="Sterilized"
              hint="Spay / neuter complete"
              checked={form.sterilized}
              onChange={(v) => setForm((f) => ({ ...f, sterilized: v }))}
            />
          </FieldGrid>
        </FormSection>

        <FormSection title="Adoption & cost" description="Current status and the monthly feeding cost.">
          <FieldGrid>
            <SelectField
              label="Status"
              required
              value={form.status}
              onChange={(v) => setForm((f) => ({ ...f, status: v }))}
              options={ANIMAL_STATUSES.map((s) => ({
                value: s,
                label: STATUS_META[s].label,
              }))}
              hint="Mark adopted from the detail sheet to also record the adopter."
            />
            <TextField
              label="Monthly food cost"
              prefix="₹"
              type="number"
              min="0"
              step="50"
              value={form.monthlyFood}
              onChange={(v) => setForm((f) => ({ ...f, monthlyFood: v }))}
              error={errors.monthlyFood ?? null}
              placeholder="900"
              hint="Feeds analytics and pledge-coverage math."
            />
          </FieldGrid>
        </FormSection>
      </FormSheet>

      {/* =========================== ADD PLEDGE (FormSheet) =========================== */}
      <FormSheet
        open={pledgeOpen}
        onOpenChange={setPledgeOpen}
        title={
          pledgeContext?.mode === "shelter"
            ? "Add shelter fund pledge"
            : `Add pledge for ${
                pledgeContext?.mode === "animal" ? pledgeContext.animal.name : ""
              }`
        }
        description={
          pledgeContext?.mode === "shelter"
            ? "A gift to the shared shelter pool — kennels, bedding, rent and emergency vet care."
            : "Record a donor commitment backing this resident's care."
        }
        onSubmit={savePledge}
        submitLabel="Record pledge"
        loading={savingPledge}
        dirty={pledgeDirty}
        size="md"
      >
        <FormSection title="Pledge" description="Who is pledging, for what, and how much.">
          <TextField
            label="Donor name"
            required
            value={pledgeForm.donorName}
            onChange={(v) => setPledgeForm((f) => ({ ...f, donorName: v }))}
            error={pledgeErrors.donorName ?? null}
            placeholder="Rahul Sharma"
            hint="Leave as recorded on the pledge — shown on lists and analytics."
          />
          <FieldGrid>
            <SelectField
              label="Kind"
              required
              value={pledgeForm.kind}
              onChange={(v) => setPledgeForm((f) => ({ ...f, kind: v }))}
              options={PLEDGE_KINDS.map((k) => ({
                value: k,
                label: KIND_META[k].label,
              }))}
            />
            <SelectField
              label="Frequency"
              required
              value={pledgeForm.frequency}
              onChange={(v) => setPledgeForm((f) => ({ ...f, frequency: v }))}
              options={[
                { value: "MONTHLY", label: "Monthly" },
                { value: "ONE_TIME", label: "One-time" },
              ]}
            />
          </FieldGrid>
          <TextField
            label="Amount"
            required
            prefix="₹"
            type="number"
            min="1"
            value={pledgeForm.amount}
            onChange={(v) => setPledgeForm((f) => ({ ...f, amount: v }))}
            error={pledgeErrors.amount ?? null}
            placeholder="900"
            hint={
              pledgeContext?.mode === "animal"
                ? `This resident's monthly food cost is ${formatINR(pledgeContext.animal.monthlyFood)}.`
                : "Monthly amounts power the recurring-support KPIs."
            }
          />
          {pledgeContext?.mode === "shelter" ? (
            <TextField
              label="Fund label"
              required
              value={pledgeForm.shelterFund}
              onChange={(v) => setPledgeForm((f) => ({ ...f, shelterFund: v }))}
              error={pledgeErrors.shelterFund ?? null}
              placeholder="Angel Paws shelter fund"
              hint="Groups the pledge under a named shelter fund."
            />
          ) : null}
        </FormSection>
      </FormSheet>

      {/* ========================== MARK ADOPTED (FormSheet) ========================== */}
      <FormSheet
        open={adoptOpen}
        onOpenChange={setAdoptOpen}
        title={`Mark ${adoptTarget?.name ?? ""} adopted`}
        description="Record the adoption — the adopter is credited on the resident's profile."
        onSubmit={saveAdopt}
        submitLabel="Confirm adoption"
        loading={busyAction === "adopt"}
        dirty={
          adopterName.trim() !== (adoptTarget?.adoptedByName ?? "") ||
          adoptUserId !== (adoptTarget?.adoptedById ?? null)
        }
        size="sm"
      >
        <FormSection title="Adopter" description="Who is taking this resident home.">
          <TextField
            label="Adopter name"
            required
            value={adopterName}
            onChange={(v) => setAdopterName(v)}
            placeholder="Priya Verma"
          />
          {isAdmin ? (
            <div className="space-y-2">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Link a registered user (optional)…"
                  aria-label="Search registered users"
                  className="pl-8"
                />
              </div>
              {searchingUsers ? (
                <div className="space-y-1.5" aria-busy="true">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : userMatches.length > 0 ? (
                <ul className="scrollbar-thin max-h-40 space-y-1 overflow-y-auto">
                  {userMatches.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
                          adoptUserId === u.id && "border-primary bg-primary/10"
                        )}
                        onClick={() => {
                          setAdoptUserId(u.id);
                          setAdopterName(u.name);
                        }}
                      >
                        <Users className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">
                          {u.name}
                          <span className="block truncate text-xs text-muted-foreground">
                            {u.email} · {titleCase(u.role)}
                          </span>
                        </span>
                        {adoptUserId === u.id ? (
                          <Check className="size-4 text-primary" aria-hidden="true" />
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {adoptUserId ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Check className="size-3.5 text-primary" aria-hidden="true" />
                  Linked adopter will be recorded on the profile.
                </p>
              ) : null}
            </div>
          ) : null}
        </FormSection>
      </FormSheet>

      {/* ============================== confirmations ============================= */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete animal"
        recordName={deleteTarget ? `${deleteTarget.name} · ${speciesLabel(deleteTarget.species)} · ${deleteTarget.location}` : undefined}
        description="This permanently removes the resident and all of their pledges. Consider marking them adopted or fostered instead."
        confirmLabel="Delete animal"
        loading={deleting}
        onConfirm={removeAnimal}
      />
      <ConfirmDialog
        open={!!pledgeDeleteTarget}
        onOpenChange={(o) => !o && setPledgeDeleteTarget(null)}
        title="Delete pledge"
        recordName={
          pledgeDeleteTarget
            ? `${pledgeDeleteTarget.donorName} · ${formatINR(pledgeDeleteTarget.amount)} · ${titleCase(pledgeDeleteTarget.kind)}`
            : undefined
        }
        description="This permanently removes the pledge. Cancel it instead if the donor may resume."
        confirmLabel="Delete pledge"
        loading={deletingPledge}
        onConfirm={removePledge}
      />
    </div>
  );
}

/* Chart palette helper (declared after the component for readability). */
function SPECIES_COLOR(species: string): string {
  switch (species) {
    case "DOG":
      return "#84cc16"; // lime
    case "CAT":
      return "#14b8a6"; // teal
    case "COW":
      return "#f59e0b"; // amber
    case "BIRD":
      return "#ec4899"; // pink
    default:
      return "#71717a"; // zinc
  }
}
