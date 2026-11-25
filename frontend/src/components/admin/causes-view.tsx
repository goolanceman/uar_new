"use client";

/**
 * Adopt-a-Medicine (admin) — rebuilt on the round-5 design system.
 *
 * - KPI stat strip: total causes, seeking/partial, adopted, monthly pledged
 * - Toolbar: debounced search + status/condition filters + active-filter
 *   chips + result count in one row; ViewSwitcher and CSV export in the
 *   card header
 * - Table view = DataTable (height="fill", sticky header, skeleton rows,
 *   built-in premium pager); grid/list persist via useViewPref
 * - Full-screen DetailSheet: every Cause field, monthly sponsorship math,
 *   adopter, story and the pledges table, with Edit / Pause / Certificate
 *   actions
 * - Create/Edit via FormSheet (lg) with inline validation, dirty tracking
 *   and an unsaved-changes guard
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  BarChart3,
  Banknote,
  Eye,
  HandCoins,
  HeartPulse,
  IndianRupee,
  MapPin,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Trash2,
  TrendingUp,
  UserCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { formatDate, formatINR, formatINRCompact, titleCase } from "@/lib/format";
import { amountRule, minLen, required } from "@/lib/validators";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import {
  PaginationBar,
  PageSizeSelect,
  useViewPref,
  ViewSwitcher,
  type DataViewMode,
} from "@/components/shared/view-switcher";
import {
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import {
  FieldGrid,
  FormSection,
  SelectField,
  TextareaField,
  TextField,
} from "@/components/shared/form-fields";
import { FormSheet } from "@/components/shared/form-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ---------------------------------- types ---------------------------------- */

interface Pledge {
  id: string;
  donorName: string;
  amountPerMonth: number;
  months: number;
  startDate?: string | null;
  status: string;
}

interface Cause {
  id: string;
  code: string;
  patientName: string;
  age: number;
  city: string;
  condition: string;
  monthlyCost: number;
  durationMonths: number;
  story: string;
  status: string;
  raised: number;
  adoptedById?: string | null;
  adoptedByName?: string | null;
  createdAt?: string | null;
  pledges?: Pledge[];
}

interface CauseForm {
  patientName: string;
  age: string;
  city: string;
  condition: string;
  monthlyCost: string;
  durationMonths: string;
  story: string;
}

/* --------------------------------- helpers --------------------------------- */

import { CAUSE_STATUSES } from "@/lib/causes";

/** Hex fills for recharts (Tailwind classes don't apply to SVG fill). */
const STATUS_HEX: Record<string, string> = {
  SEEKING: "#f59e0b",
  PARTIAL: "#06b6d4",
  ADOPTED: "#10b981",
  PAUSED: "#a1a1aa",
};
const CONDITION_PALETTE = [
  "#14b8a6", "#f97316", "#d946ef", "#f59e0b", "#6366f1", "#84cc16", "#ef4444",
];

interface CauseAnalytics {
  causes: {
    total: number;
    seeking: number;
    partial: number;
    adopted: number;
    paused: number;
    totalRaised: number;
    totalNeeded: number;
  };
  condition: Array<{ condition: string; count: number; monthlyCost: number }>;
  status: Array<{ status: string; count: number }>;
  monthly: Array<{ label: string; amount: number; count: number }>;
  pledges: { total: number; active: number; monthlyValue: number };
  topCities: Array<{ city: string; count: number }>;
  topCauses: Array<{
    id: string;
    code: string;
    patientName: string;
    status: string;
    raised: number;
    total: number;
    pct: number;
  }>;
}

const EMPTY_FORM: CauseForm = {
  patientName: "",
  age: "",
  city: "",
  condition: "BP",
  monthlyCost: "",
  durationMonths: "12",
  story: "",
};

function totalCost(c: Pick<Cause, "monthlyCost" | "durationMonths">): number {
  return (c.monthlyCost ?? 0) * (c.durationMonths ?? 0);
}

function pctOf(c: Pick<Cause, "raised" | "monthlyCost" | "durationMonths">): number {
  const t = totalCost(c);
  return t > 0 ? Math.min(100, Math.round(((c.raised || 0) / t) * 100)) : 0;
}

function validateCauseForm(f: CauseForm): Record<string, string | null> {
  const age = f.age.trim() === "" ? NaN : Number(f.age);
  const duration = f.durationMonths.trim() === "" ? NaN : Number(f.durationMonths);
  return {
    patientName: required("Patient name")(f.patientName),
    age:
      Number.isFinite(age) && age >= 0 && age <= 120
        ? null
        : "Age must be between 0 and 120",
    city: required("City")(f.city),
    monthlyCost: amountRule({ label: "Monthly cost" })(f.monthlyCost),
    durationMonths:
      Number.isFinite(duration) && duration >= 1 && duration <= 120
        ? null
        : "Duration must be between 1 and 120 months",
    story: minLen(30, "Story")(f.story),
  };
}

function ViewSkeleton({ view }: { view: DataViewMode }) {
  if (view === "table") {
    return (
      <div className="space-y-2 rounded-xl border bg-card p-4" aria-busy="true">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  if (view === "list") {
    return (
      <div className="space-y-2 rounded-xl border bg-card p-4" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-60 rounded-xl" />
      ))}
    </div>
  );
}

/* ---------------------------------- view ----------------------------------- */

export default function CausesView() {
  const [causes, setCauses] = useState<Cause[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState<string | null>(null);

  // tabs
  const [tab, setTab] = useState<"directory" | "analytics">("directory");
  const [analytics, setAnalytics] = useState<CauseAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // filters (search debounced into `query`)
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [conditionFilter, setConditionFilter] = useState("ALL");

  // view + pagination
  const [view, setView] = useViewPref("causes", "grid");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // form sheet
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Cause | null>(null);
  const [form, setForm] = useState<CauseForm>(EMPTY_FORM);
  const [snapshot, setSnapshot] = useState(JSON.stringify(EMPTY_FORM));
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // detail sheet + confirm
  const [sheet, setSheet] = useState<Cause | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Cause | null>(null);

  const cityOptions = useMasters("CITY");
  const conditionOptions = useMasters("CONDITION");

  const load = useCallback(async () => {
    try {
      const data = await get<Cause[]>("/api/causes");
      setCauses(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load causes");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const data = await get<CauseAnalytics>("/api/cause-analytics");
      setAnalytics(data ?? null);
    } catch {
      setAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    void loadAnalytics();
  }, [load, loadAnalytics]);

  const refreshAll = useCallback(() => {
    void load();
    void loadAnalytics();
  }, [load, loadAnalytics]);

  // debounce search 300ms
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  // reset pagination when the result set changes
  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, conditionFilter, pageSize]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return causes.filter((c) => {
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (conditionFilter !== "ALL" && c.condition !== conditionFilter) return false;
      if (
        q &&
        !`${c.patientName}`.toLowerCase().includes(q) &&
        !`${c.city ?? ""}`.toLowerCase().includes(q) &&
        !`${c.code}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [causes, query, statusFilter, conditionFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize]
  );

  const stats = useMemo(() => {
    const seeking = causes.filter((c) => c.status === "SEEKING" || c.status === "PARTIAL").length;
    const adopted = causes.filter((c) => c.status === "ADOPTED").length;
    const monthly = causes
      .flatMap((c) => c.pledges ?? [])
      .filter((pl) => pl.status === "ACTIVE")
      .reduce((s, pl) => s + (pl.amountPerMonth || 0), 0);
    return { seeking, adopted, monthly, total: causes.length };
  }, [causes]);

  /* ------------------------------- validation ------------------------------ */

  const errors = useMemo(() => validateCauseForm(form), [form]);
  const errorCount = useMemo(() => Object.values(errors).filter(Boolean).length, [errors]);
  const dirty = JSON.stringify(form) !== snapshot;

  /* ------------------------------ form actions ----------------------------- */

  const handleFormOpenChange = (open: boolean) => {
    if (!open && dirty) {
      setConfirmDiscard(true);
      return;
    }
    setFormOpen(false);
  };

  const openCreate = () => {
    setEditing(null);
    const f = { ...EMPTY_FORM, city: cityOptions.options[0]?.value ?? "" };
    setForm(f);
    setSnapshot(JSON.stringify(f));
    setFormOpen(true);
  };

  const openEdit = (c: Cause) => {
    setEditing(c);
    const f: CauseForm = {
      patientName: c.patientName ?? "",
      age: String(c.age ?? ""),
      city: c.city ?? "",
      condition: c.condition ?? "BP",
      monthlyCost: String(c.monthlyCost ?? ""),
      durationMonths: String(c.durationMonths ?? 12),
      story: c.story ?? "",
    };
    setForm(f);
    setSnapshot(JSON.stringify(f));
    setFormOpen(true);
  };

  const save = async () => {
    if (errorCount > 0) {
      toast.error(`${errorCount} field(s) need attention`);
      return;
    }
    setSaving(true);
    try {
      const body = {
        patientName: form.patientName.trim(),
        age: Math.trunc(Number(form.age)),
        city: form.city.trim(),
        condition: form.condition,
        monthlyCost: Number(form.monthlyCost),
        durationMonths: Math.trunc(Number(form.durationMonths)),
        story: form.story.trim(),
      };
      if (editing) {
        await patch(`/api/causes/${editing.id}`, body);
        toast.success(`Cause ${editing.code} updated`);
      } else {
        await post("/api/causes", body);
        toast.success("Medicine cause created — code UAR-MED-#### assigned automatically");
      }
      setFormOpen(false);
      setSheet(null);
      await Promise.all([load(), loadAnalytics()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (c: Cause) => {
    const next = c.status === "PAUSED" ? "SEEKING" : "PAUSED";
    try {
      await patch(`/api/causes/${c.id}`, { status: next });
      toast.success(`${c.code} ${next === "PAUSED" ? "paused" : "resumed"}`);
      setSheet((prev) => (prev && prev.id === c.id ? { ...prev, status: next } : prev));
      await Promise.all([load(), loadAnalytics()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await del(`/api/causes/${deleteTarget.id}`);
      toast.success(`${deleteTarget.code} deleted`);
      setDeleteTarget(null);
      setSheet(null);
      await Promise.all([load(), loadAnalytics()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  const issueCertificate = async (c: Cause) => {
    if (!c.adoptedByName) {
      toast.error("This cause has no adopter recorded yet");
      return;
    }
    setIssuing(c.id);
    try {
      const res = await post<{ certificate?: { code?: string } }>("/api/certificates", {
        type: "MEDICINE_SPONSOR",
        recipientName: c.adoptedByName,
        userId: c.adoptedById ?? undefined,
        refType: "PLEDGE",
        refId: c.id,
        title: "Medicine Sponsorship Certificate",
        description: `Monthly medicine support for ${c.patientName} (${c.code})`,
        meta: JSON.stringify({ cause: c.code, patient: c.patientName, condition: c.condition }),
      });
      const code = res?.certificate?.code;
      if (code) {
        toast.success(`Certificate ${code} issued to ${c.adoptedByName}`, {
          action: {
            label: "Open",
            onClick: () => window.open(`/api/certificates/${code}/html`, "_blank"),
          },
        });
      } else {
        toast.success("Sponsorship certificate issued");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Certificate failed");
    } finally {
      setIssuing(null);
    }
  };

  /* ------------------------------ actions menu ----------------------------- */

  const RowMenu = ({ c }: { c: Cause }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-8"
          aria-label={`Actions for cause ${c.code}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => setSheet(c)}>
          <Eye className="size-4" /> View details
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openEdit(c)}>
          <Pencil className="size-4" /> Edit
        </DropdownMenuItem>
        {c.status === "PAUSED" ? (
          <DropdownMenuItem onSelect={() => void togglePause(c)}>
            <Play className="size-4" /> Resume
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => void togglePause(c)}>
            <Pause className="size-4" /> Pause
          </DropdownMenuItem>
        )}
        {c.status === "ADOPTED" && c.adoptedByName && (
          <DropdownMenuItem onSelect={() => void issueCertificate(c)} disabled={issuing === c.id}>
            <Award className="size-4" /> Issue certificate
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => setDeleteTarget(c)}
          className="text-red-600 focus:text-red-600 dark:text-red-400"
        >
          <Trash2 className="size-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  /* --------------------------------- CSV ----------------------------------- */

  const csvColumns: CsvColumn<Cause>[] = [
    { header: "Code", value: (c) => c.code },
    { header: "Patient", value: (c) => c.patientName },
    { header: "Age", value: (c) => c.age },
    { header: "City", value: (c) => c.city },
    { header: "Condition", value: (c) => labelOf(conditionOptions.options, c.condition) },
    { header: "Monthly cost (INR)", value: (c) => c.monthlyCost },
    { header: "Duration (months)", value: (c) => c.durationMonths },
    { header: "Total needed (INR)", value: (c) => totalCost(c) },
    { header: "Raised (INR)", value: (c) => c.raised },
    { header: "Progress %", value: (c) => pctOf(c) },
    { header: "Status", value: (c) => c.status },
    { header: "Active pledges", value: (c) => (c.pledges ?? []).length },
    { header: "Adopted by", value: (c) => c.adoptedByName ?? "" },
  ];

  /* ---------------------------- table + toolbar ---------------------------- */

  const filterChips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (query.trim())
    filterChips.push({ key: "q", label: `“${query.trim()}”`, clear: () => setSearch("") });
  if (statusFilter !== "ALL")
    filterChips.push({
      key: "status",
      label: titleCase(statusFilter),
      clear: () => setStatusFilter("ALL"),
    });
  if (conditionFilter !== "ALL")
    filterChips.push({
      key: "condition",
      label: labelOf(conditionOptions.options, conditionFilter),
      clear: () => setConditionFilter("ALL"),
    });

  const emptyNode = (
    <EmptyState
      icon={<HeartPulse className="size-6" aria-hidden="true" />}
      title={causes.length === 0 ? "No medicine causes yet" : "No causes match the filters"}
      hint={
        causes.length === 0
          ? "Create a cause so donors can adopt a patient's monthly medicine cost."
          : "Try clearing the status, condition or search filters."
      }
    >
      {causes.length === 0 ? (
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" aria-hidden="true" /> New cause
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setSearch("");
            setQuery("");
            setStatusFilter("ALL");
            setConditionFilter("ALL");
          }}
        >
          Clear filters
        </Button>
      )}
    </EmptyState>
  );

  const causeColumns: DataTableColumn<Cause>[] = [
    { key: "code", header: "Code", mono: true },
    { key: "patient", header: "Patient" },
    { key: "condition", header: "Condition", hideBelow: "lg" },
    { key: "monthly", header: "Monthly", align: "right", mono: true },
    { key: "progress", header: "Progress", hideBelow: "md" },
    { key: "status", header: "Status" },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right" },
  ];

  const renderCauseCell = (c: Cause, col: DataTableColumn<Cause>) => {
    const pct = pctOf(c);
    switch (col.key) {
      case "code":
        return c.code;
      case "patient":
        return (
          <div className="flex flex-col">
            <span className="font-medium">{c.patientName}</span>
            <span className="text-[11px] text-muted-foreground">
              {c.age} yrs · {c.city}
            </span>
          </div>
        );
      case "condition":
        return (
          <Badge
            variant="outline"
            className="border-teal-500/30 bg-teal-500/10 text-[10px] text-teal-700 dark:text-teal-400"
          >
            {labelOf(conditionOptions.options, c.condition)}
          </Badge>
        );
      case "monthly":
        return formatINR(c.monthlyCost);
      case "progress":
        return (
          <div className="flex items-center gap-2">
            <Progress
              value={pct}
              className="h-2 w-24 [&>div]:bg-teal-600"
              aria-label={`${c.code} progress ${pct}%`}
            />
            <span className="text-xs text-muted-foreground">{pct}%</span>
          </div>
        );
      case "status":
        return <StatusBadge status={c.status} />;
      case "actions":
        return (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <RowMenu c={c} />
          </div>
        );
      default:
        return null;
    }
  };

  /* --------------------------------- charts -------------------------------- */

  const conditionChart = (analytics?.condition ?? [])
    .map((c, i) => ({
      name: labelOf(conditionOptions.options, c.condition),
      value: c.count,
      monthlyCost: c.monthlyCost,
      fill: CONDITION_PALETTE[i % CONDITION_PALETTE.length],
    }))
    .filter((c) => c.value > 0);

  const statusChart = CAUSE_STATUSES.map((s) => ({
    status: titleCase(s),
    count: analytics?.status.find((x) => x.status === s)?.count ?? 0,
    fill: STATUS_HEX[s] ?? "#71717a",
  }));

  const monthlyChart = analytics?.monthly ?? [];

  /* -------------------------------- render --------------------------------- */

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Adopt-a-Medicine"
        description="Monthly medicine causes that donors can adopt until a patient recovers."
        icon={<HeartPulse className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={refreshAll} aria-label="Refresh cause data">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
            <Button onClick={openCreate} aria-label="Create new medicine cause">
              <Plus className="size-4" aria-hidden="true" /> New cause
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "directory" | "analytics")}>
        <TabsList className="h-auto w-full flex-wrap sm:w-auto">
          <TabsTrigger value="directory">
            Cause directory
            <Badge variant="outline" className="ml-1.5 px-1.5 tabular-nums">
              {causes.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="mr-1 size-3.5" aria-hidden="true" /> Analytics
          </TabsTrigger>
        </TabsList>

      <TabsContent value="directory" className="mt-4 space-y-4 sm:space-y-6">

      {/* stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total causes" value={stats.total} accent="teal" icon={<HeartPulse className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Seeking / partial" value={stats.seeking} accent="amber" icon={<HandCoins className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Adopted" value={stats.adopted} accent="emerald" icon={<UserCheck className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Monthly pledged" value={formatINR(stats.monthly)} accent="pink" icon={<HandCoins className="size-5" aria-hidden="true" />} loading={loading} hint="Sum of active pledges" />
      </div>

      <SectionCard
        title="Cause directory"
        icon={<HeartPulse className="size-4" aria-hidden="true" />}
        description={loading ? "Loading causes…" : `${filtered.length} of ${causes.length} causes`}
        bodyClassName="space-y-4"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu columns={csvColumns} rows={filtered} filename="uar-medicine-causes" disabled={loading || filtered.length === 0} />
            <ViewSwitcher value={view} onChange={setView} />
          </div>
        }
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient, city or code…"
              className="h-8 pl-8 text-sm"
              aria-label="Search patient, city or code"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger size="sm" className="w-[126px] text-xs" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {CAUSE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={conditionFilter} onValueChange={setConditionFilter}>
            <SelectTrigger size="sm" className="w-[136px] text-xs" aria-label="Filter by condition">
              <SelectValue placeholder="All conditions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All conditions</SelectItem>
              {conditionOptions.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {filterChips.map((chip) => (
            <Badge key={chip.key} variant="outline" className="gap-1 pr-1 text-xs font-medium">
              {chip.label}
              <button
                type="button"
                aria-label={`Clear ${chip.label} filter`}
                onClick={chip.clear}
                className="rounded-full p-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}

          {filterChips.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Clear all filters"
              onClick={() => {
                setSearch("");
                setQuery("");
                setStatusFilter("ALL");
                setConditionFilter("ALL");
              }}
            >
              <X className="size-4" /> Clear all
            </Button>
          ) : null}

          <span
            className="ml-auto text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            {loading ? "Loading…" : `${filtered.length} result${filtered.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {view === "table" ? (
          <DataTable
            columns={causeColumns}
            rows={paged}
            rowKey={(c) => c.id}
            loading={loading}
            skeletonRows={8}
            height="fill"
            fillOffset={520}
            onRowClick={setSheet}
            page={safePage}
            pages={pages}
            total={filtered.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={setPageSize}
            itemLabel="causes"
            empty={emptyNode}
          >
            {renderCauseCell}
          </DataTable>
        ) : loading ? (
          <ViewSkeleton view={view} />
        ) : filtered.length === 0 ? (
          emptyNode
        ) : view === "list" ? (
          <ul className="divide-y rounded-xl border bg-card">
            {paged.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSheet(c)}
                  aria-label={`Open details for cause ${c.code} — ${c.patientName}`}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary sm:px-4"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
                    <HeartPulse className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      <span className="mr-1.5 font-mono text-xs text-muted-foreground">{c.code}</span>
                      {c.patientName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {labelOf(conditionOptions.options, c.condition)} · {c.city} · {c.durationMonths} mo
                    </p>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <p className="text-sm font-semibold">{formatINRCompact(c.raised)}</p>
                    <p className="text-[11px] text-muted-foreground">{pctOf(c)}% of {formatINRCompact(totalCost(c))}</p>
                  </div>
                  <StatusBadge status={c.status} className="shrink-0" />
                  <div onClick={(e) => e.stopPropagation()}>
                    <RowMenu c={c} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {paged.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSheet(c)}
                aria-label={`Open details for ${c.code} — ${c.patientName}`}
                className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-teal-500/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                  <StatusBadge status={c.status} className="ml-auto" />
                </div>
                <div>
                  <p className="font-semibold leading-tight">{c.patientName}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.age} yrs · {c.city}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400">
                    {labelOf(conditionOptions.options, c.condition)}
                  </Badge>
                  <Badge variant="outline">
                    <HandCoins className="size-3" aria-hidden="true" />
                    {(c.pledges ?? []).length} pledge{(c.pledges ?? []).length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="mt-auto space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold text-teal-700 dark:text-teal-400">{formatINR(c.monthlyCost)}/mo</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.durationMonths} mo · {formatINR(c.raised)} raised
                    </span>
                  </div>
                  <Progress
                    value={pctOf(c)}
                    className="h-2 [&>div]:bg-teal-600"
                    aria-label={`${pctOf(c)}% of total medicine cost raised`}
                  />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Pagination (grid / list — the DataTable pager covers the table view) */}
        {view !== "table" && !loading && filtered.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PaginationBar page={safePage} pages={pages} total={filtered.length} onPage={setPage} itemLabel="causes" />
            <PageSizeSelect value={pageSize} onChange={setPageSize} />
          </div>
        ) : null}
      </SectionCard>

      </TabsContent>

      {/* ============================ ANALYTICS ============================ */}
      <TabsContent value="analytics" className="mt-4 space-y-4">
        {/* KPI strip */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Total causes"
            value={(analytics?.causes.total ?? 0).toLocaleString("en-IN")}
            hint={`${analytics?.causes.seeking ?? 0} seeking · ${analytics?.causes.partial ?? 0} partial`}
            icon={<HeartPulse className="size-5" aria-hidden="true" />}
            accent="teal"
            loading={analyticsLoading}
          />
          <StatCard
            label="Adopted / Paused"
            value={`${analytics?.causes.adopted ?? 0} / ${analytics?.causes.paused ?? 0}`}
            hint="Fully sponsored vs. on hold"
            icon={<UserCheck className="size-5" aria-hidden="true" />}
            accent="emerald"
            loading={analyticsLoading}
          />
          <StatCard
            label="Total raised"
            value={formatINRCompact(analytics?.causes.totalRaised ?? 0)}
            hint={`of ${formatINRCompact(analytics?.causes.totalNeeded ?? 0)} needed`}
            icon={<IndianRupee className="size-5" aria-hidden="true" />}
            accent="amber"
            loading={analyticsLoading}
          />
          <StatCard
            label="Overall progress"
            value={`${
              analytics && analytics.causes.totalNeeded > 0
                ? Math.min(100, Math.round((analytics.causes.totalRaised / analytics.causes.totalNeeded) * 100))
                : 0
            }%`}
            hint="Raised vs. full sponsorship cost"
            icon={<TrendingUp className="size-5" aria-hidden="true" />}
            accent="lime"
            loading={analyticsLoading}
          />
          <StatCard
            label="Active pledges"
            value={(analytics?.pledges.active ?? 0).toLocaleString("en-IN")}
            hint={`${analytics?.pledges.total ?? 0} recorded all-time`}
            icon={<HandCoins className="size-5" aria-hidden="true" />}
            accent="orange"
            loading={analyticsLoading}
          />
          <StatCard
            label="Monthly pledge value"
            value={`${formatINRCompact(analytics?.pledges.monthlyValue ?? 0)}/mo`}
            hint="Sum of active monthly pledges"
            icon={<Banknote className="size-5" aria-hidden="true" />}
            accent="pink"
            loading={analyticsLoading}
          />
          <StatCard
            label="Top city"
            value={analytics?.topCities[0]?.city ?? "—"}
            hint={analytics?.topCities[0] ? `${analytics.topCities[0].count} cases` : "No causes yet"}
            icon={<MapPin className="size-5" aria-hidden="true" />}
            accent="cyan"
            loading={analyticsLoading}
          />
          <StatCard
            label="Conditions tracked"
            value={String(conditionChart.length)}
            hint="Distinct medical conditions"
            icon={<Stethoscope className="size-5" aria-hidden="true" />}
            accent="fuchsia"
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
            {/* condition distribution donut */}
            <SectionCard
              title="Condition distribution"
              description="Medicine causes across the trust, by condition"
              icon={<Stethoscope className="size-4" aria-hidden="true" />}
            >
              {conditionChart.length === 0 ? (
                <EmptyState
                  icon={<Stethoscope className="size-6" aria-hidden="true" />}
                  title="No causes yet"
                  hint="Condition mix charts here as medicine causes are created."
                />
              ) : (
                <>
                  <ChartContainer config={{}} className="aspect-auto h-44 w-full sm:h-56">
                    <PieChart>
                      <Pie
                        data={conditionChart}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="55%"
                        outerRadius="85%"
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {conditionChart.map((c) => (
                          <Cell key={c.name} fill={c.fill} />
                        ))}
                      </Pie>
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value, name, item) => (
                              <span className="flex w-full items-center justify-between gap-4">
                                <span className="text-muted-foreground">{String(name)}</span>
                                <span className="font-mono font-medium tabular-nums">
                                  {Number(value)} case{Number(value) === 1 ? "" : "s"}
                                  {item?.payload?.monthlyCost ? ` · ${formatINRCompact(Number(item.payload.monthlyCost))}/mo` : ""}
                                </span>
                              </span>
                            )}
                          />
                        }
                      />
                    </PieChart>
                  </ChartContainer>
                  <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                    {conditionChart.map((c) => (
                      <li key={c.name} className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: c.fill }}
                        />
                        <span className="truncate">{c.name}</span>
                        <span className="ml-auto font-medium tabular-nums">
                          {c.value} · {formatINRCompact(c.monthlyCost)}/mo
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </SectionCard>

            {/* status breakdown bar */}
            <SectionCard
              title="Sponsorship pipeline"
              description="Seeking → partial → adopted, plus paused cases"
              icon={<TrendingUp className="size-4" aria-hidden="true" />}
            >
              <ChartContainer config={{}} className="aspect-auto h-44 w-full sm:h-56">
                <BarChart data={statusChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) => (
                          <span className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">{String(name)}</span>
                            <span className="font-mono font-medium tabular-nums">
                              {Number(value)} case{Number(value) === 1 ? "" : "s"}
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

            {/* monthly pledge value committed */}
            <SectionCard
              title="Monthly pledges committed"
              description="New pledge value committed each month, last 12 months"
              icon={<IndianRupee className="size-4" aria-hidden="true" />}
              className="lg:col-span-2"
            >
              {monthlyChart.every((m) => m.amount === 0) ? (
                <EmptyState
                  icon={<IndianRupee className="size-6" aria-hidden="true" />}
                  title="No pledges yet"
                  hint="Monthly commitment charts here once donors start pledging."
                />
              ) : (
                <ChartContainer
                  config={{ amount: { label: "Pledged", color: "#14b8a6" } }}
                  className="aspect-auto h-52 w-full sm:h-64"
                >
                  <BarChart data={monthlyChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
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
                              <span className="font-mono font-medium tabular-nums">{formatINR(Number(value))}/mo</span>
                            </span>
                          )}
                        />
                      }
                    />
                    <Bar dataKey="amount" fill="var(--color-amount)" radius={[6, 6, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ChartContainer>
              )}
            </SectionCard>
          </div>
        )}

        {/* top causes by funds raised */}
        <SectionCard
          title="Top causes by funds raised"
          description="The five closest-to-fully-funded medicine causes"
          icon={<Award className="size-5" aria-hidden="true" />}
        >
          {analyticsLoading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : !analytics || analytics.topCauses.length === 0 ? (
            <EmptyState
              icon={<Award className="size-8" aria-hidden="true" />}
              title="No causes with funds raised yet"
              hint="The leaderboard appears once pledges start coming in."
            />
          ) : (
            <ul className="space-y-2">
              {analytics.topCauses.map((c, i) => (
                <li key={c.id} className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {c.patientName} <span className="font-mono text-xs text-muted-foreground">({c.code})</span>
                      </span>
                      <StatusBadge status={c.status} />
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Progress value={c.pct} className="h-1.5 flex-1 [&>div]:bg-teal-600" />
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{c.pct}%</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold">{formatINRCompact(c.raised)}</p>
                    <p className="text-[11px] text-muted-foreground">of {formatINRCompact(c.total)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </TabsContent>
      </Tabs>

      {/* ============================== DETAIL SHEET ============================= */}
      <DetailSheet
        open={!!sheet}
        onOpenChange={(o) => !o && setSheet(null)}
        eyebrow="Adopt-a-Medicine"
        title={sheet?.patientName ?? "Cause"}
        description={
          sheet
            ? `Medicine sponsorship case · ${sheet.city} · ${sheet.durationMonths} months of support`
            : undefined
        }
        status={sheet ? <StatusBadge status={sheet.status} /> : undefined}
        actions={
          sheet ? (
            <>
              <Button variant="outline" size="sm" onClick={() => openEdit(sheet)}>
                <Pencil className="size-4" aria-hidden="true" /> Edit
              </Button>
              {sheet.status === "ADOPTED" && sheet.adoptedByName ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                  onClick={() => void issueCertificate(sheet)}
                  disabled={issuing === sheet.id}
                >
                  <Award className="size-4" aria-hidden="true" />
                  {issuing === sheet.id ? "Issuing…" : "Certificate"}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
        footer={
          sheet ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void togglePause(sheet)}
                aria-label={sheet.status === "PAUSED" ? "Resume cause" : "Pause cause"}
              >
                {sheet.status === "PAUSED" ? (
                  <Play className="size-4" aria-hidden="true" />
                ) : (
                  <Pause className="size-4" aria-hidden="true" />
                )}
                {sheet.status === "PAUSED" ? "Resume" : "Pause"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                onClick={() => setDeleteTarget(sheet)}
                aria-label={`Delete ${sheet.code}`}
              >
                <Trash2 className="size-4" aria-hidden="true" /> Delete
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSheet(null)}>
                Close
              </Button>
            </>
          ) : undefined
        }
      >
        {sheet && (
          <div className="flex flex-col gap-6">
            {/* Monthly math */}
            <DetailSection
              title="Sponsorship math"
              description="Raised = sum of active monthly pledges recorded against this cause."
            >
              <Progress
                value={pctOf(sheet)}
                className="h-2.5 [&>div]:bg-teal-600"
                aria-label="Fundraising progress"
              />
              <p className="text-xs text-muted-foreground">
                {formatINR(sheet.raised)} of {formatINR(totalCost(sheet))} ({sheet.durationMonths} ×{" "}
                {formatINR(sheet.monthlyCost)})
              </p>
              <div className="mt-2">
                <DetailGrid cols={3}>
                  <DataField label="Monthly cost" value={`${formatINR(sheet.monthlyCost)} / mo`} />
                  <DataField label="Duration" value={`${sheet.durationMonths} months`} />
                  <DataField label="Total needed" value={formatINR(totalCost(sheet))} />
                  <DataField label="Raised so far" value={formatINR(sheet.raised)} />
                  <DataField
                    label="Still needed"
                    value={formatINR(Math.max(0, totalCost(sheet) - (sheet.raised || 0)))}
                  />
                  <DataField
                    label="Active monthly pledges"
                    value={formatINR(
                      (sheet.pledges ?? [])
                        .filter((pl) => pl.status === "ACTIVE")
                        .reduce((s, pl) => s + (pl.amountPerMonth || 0), 0)
                    )}
                  />
                </DetailGrid>
              </div>
            </DetailSection>

            {/* Patient profile — every Cause field */}
            <DetailSection title="Patient profile">
              <DetailGrid cols={3}>
                <DataField label="Cause code" value={sheet.code} mono copy />
                <DataField label="Patient name" value={sheet.patientName} />
                <DataField label="Age" value={`${sheet.age} years`} />
                <DataField label="City" value={sheet.city} />
                <DataField
                  label="Condition"
                  value={
                    <Badge
                      variant="outline"
                      className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400"
                    >
                      {labelOf(conditionOptions.options, sheet.condition)}
                    </Badge>
                  }
                />
                <DataField label="Status" value={<StatusBadge status={sheet.status} />} />
                <DataField label="Created" value={formatDate(sheet.createdAt)} />
              </DetailGrid>
            </DetailSection>

            {/* Adoption */}
            {sheet.adoptedByName ? (
              <DetailSection title="Adoption">
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                    <UserCheck className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Adopted by</p>
                    <p className="truncate text-sm font-semibold">{sheet.adoptedByName}</p>
                  </div>
                </div>
              </DetailSection>
            ) : null}

            {/* Story */}
            <DetailSection title="Story" description="Shown on the public cause page.">
              <p className="text-sm leading-relaxed text-muted-foreground">{sheet.story}</p>
            </DetailSection>

            {/* Pledges */}
            <DetailSection
              title={`Pledges (${(sheet.pledges ?? []).length})`}
              description="Donors can pledge from the public cause page."
            >
              {(sheet.pledges ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No pledges yet — donors can pledge from the public cause page.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead>Donor</TableHead>
                        <TableHead className="text-right">Pledge</TableHead>
                        <TableHead className="hidden text-right sm:table-cell">Since</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(sheet.pledges ?? []).map((pl) => (
                        <TableRow key={pl.id}>
                          <TableCell className="text-sm">{pl.donorName}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {formatINR(pl.amountPerMonth)}/mo × {pl.months} mo
                          </TableCell>
                          <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                            {pl.startDate ? formatDate(pl.startDate) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <StatusBadge status={pl.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </DetailSection>
          </div>
        )}
      </DetailSheet>

      {/* ============================ CREATE / EDIT ============================= */}
      <FormSheet
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        title={editing ? `Edit ${editing.code}` : "New medicine cause"}
        description={
          editing
            ? "Update patient details or costs — active pledges are not affected."
            : "Donors adopt a patient's full monthly medicine cost. The code (UAR-MED-####) is generated automatically."
        }
        onSubmit={save}
        submitLabel={editing ? "Save changes" : "Create cause"}
        loading={saving}
        dirty={dirty}
        size="lg"
        footerExtra={
          errorCount > 0 ? (
            <span className="font-medium text-destructive">{errorCount} field(s) need attention</span>
          ) : null
        }
      >
        <FormSection title="Patient" description="Who this medicine cause supports.">
          <FieldGrid>
            <TextField
              label="Patient name"
              required
              value={form.patientName}
              onChange={(v) => setForm((f) => ({ ...f, patientName: v }))}
              placeholder="Lakshmi Devi"
              error={errors.patientName}
            />
            <TextField
              label="Age (years)"
              required
              type="number"
              min="0"
              max="120"
              value={form.age}
              onChange={(v) => setForm((f) => ({ ...f, age: v }))}
              placeholder="62"
              error={errors.age}
            />
          </FieldGrid>
          <FieldGrid>
            <SelectField
              label="City"
              required
              value={form.city}
              onChange={(v) => setForm((f) => ({ ...f, city: v }))}
              options={cityOptions.options}
              placeholder="Select city"
              error={errors.city}
            />
            <SelectField
              label="Condition"
              value={form.condition}
              onChange={(v) => setForm((f) => ({ ...f, condition: v }))}
              options={conditionOptions.options}
              placeholder="Select condition"
            />
          </FieldGrid>
        </FormSection>

        <FormSection title="Sponsorship" description="Monthly cost and how long support is needed.">
          <FieldGrid>
            <TextField
              label="Monthly cost"
              required
              type="number"
              min="1"
              prefix="₹"
              value={form.monthlyCost}
              onChange={(v) => setForm((f) => ({ ...f, monthlyCost: v }))}
              placeholder="2400"
              error={errors.monthlyCost}
            />
            <TextField
              label="Duration (months)"
              required
              type="number"
              min="1"
              max="120"
              value={form.durationMonths}
              onChange={(v) => setForm((f) => ({ ...f, durationMonths: v }))}
              placeholder="12"
              error={errors.durationMonths}
            />
          </FieldGrid>
          {Number(form.monthlyCost) > 0 && Number(form.durationMonths) > 0 && (
            <p className="text-xs text-muted-foreground">
              Total sponsorship value:{" "}
              <span className="font-semibold text-foreground">
                {formatINR(Number(form.monthlyCost) * Number(form.durationMonths))}
              </span>
            </p>
          )}
        </FormSection>

        <FormSection title="Story" description="Shown on the public cause page — help donors connect.">
          <TextareaField
            label="Story"
            required
            rows={5}
            value={form.story}
            onChange={(v) => setForm((f) => ({ ...f, story: v }))}
            placeholder="Widowed, lives alone, needs BP + thyroid medicines every month…"
            hint={`${form.story.trim().length}/30 characters minimum`}
            error={errors.story}
          />
        </FormSection>
      </FormSheet>

      {/* ============================ DELETE CONFIRM ============================ */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete cause?"
        recordName={deleteTarget ? `${deleteTarget.code} — ${deleteTarget.patientName}` : null}
        description="This permanently removes the cause and its pledge history. Consider pausing instead if donors are already engaged."
        confirmLabel="Delete cause"
        loading={saving}
        onConfirm={remove}
      />

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard unsaved changes?"
        description="Your edits to this cause haven't been saved yet. Closing now will lose them."
        confirmLabel="Discard"
        onConfirm={() => {
          setFormOpen(false);
          setConfirmDiscard(false);
        }}
      />
    </div>
  );
}
