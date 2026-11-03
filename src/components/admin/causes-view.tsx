"use client";

/**
 * Adopt-a-Medicine (admin) — rebuilt on the round-3 design system.
 *
 * - Toolbar: debounced search + status/condition filters + ViewSwitcher
 *   (table / grid / list, persisted) + CSV export + "New cause"
 * - Create/Edit via FormSheet (md) with inline validation, dirty tracking
 *   and an unsaved-changes guard
 * - Detail Sheet: cause fields, raised progress, pledges table and the
 *   certificate / pause / delete actions
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  Eye,
  HandCoins,
  HeartPulse,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { formatINR, formatINRCompact, titleCase } from "@/lib/format";
import { amountRule, minLen, required } from "@/lib/validators";
import { cn } from "@/lib/utils";
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

interface Pledge {
  id: string;
  donorName: string;
  amountPerMonth: number;
  months: number;
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

/* ------------------------------- chip styles ------------------------------- */

const CAUSE_STATUS: Record<string, string> = {
  SEEKING: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  PARTIAL: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  ADOPTED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  PAUSED: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const PLEDGE_STATUS: Record<string, string> = {
  ACTIVE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  COMPLETED: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  CANCELLED: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const CAUSE_STATUSES = ["SEEKING", "PARTIAL", "ADOPTED", "PAUSED"];

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

  useEffect(() => {
    load();
  }, [load]);

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
      await load();
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
      await load();
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
      await load();
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

  /* -------------------------------- render --------------------------------- */

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Adopt-a-Medicine"
        description="Monthly medicine causes that donors can adopt until a patient recovers."
        icon={<HeartPulse className="size-5" aria-hidden="true" />}
        actions={
          <Button onClick={openCreate} aria-label="Create new medicine cause">
            <Plus className="size-4" aria-hidden="true" /> New cause
          </Button>
        }
      />

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
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative w-full sm:w-48">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search patient, city or code…"
                className="pl-9"
                aria-label="Search patient, city or code"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Filter by status">
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
              <SelectTrigger className="w-full sm:w-40" aria-label="Filter by condition">
                <SelectValue placeholder="All conditions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All conditions</SelectItem>
                {conditionOptions.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ViewSwitcher value={view} onChange={setView} />
            <ExportMenu columns={csvColumns} rows={filtered} filename="uar-medicine-causes" disabled={loading || filtered.length === 0} />
          </div>
        }
      >
        {loading ? (
          <ViewSkeleton view={view} />
        ) : filtered.length === 0 ? (
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
        ) : view === "table" ? (
          <>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Code</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead className="hidden lg:table-cell">Condition</TableHead>
                    <TableHead className="text-right">Monthly</TableHead>
                    <TableHead className="hidden md:table-cell">Progress</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((c) => {
                    const pct = pctOf(c);
                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer"
                        onClick={() => setSheet(c)}
                        aria-label={`Open cause ${c.code} — ${c.patientName}`}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">{c.code}</TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{c.patientName}</p>
                          <p className="text-[11px] text-muted-foreground">{c.age} yrs · {c.city}</p>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <Badge variant="outline" className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400">
                            {labelOf(conditionOptions.options, c.condition)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatINR(c.monthlyCost)}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex items-center gap-2">
                            <Progress value={pct} className="h-2 w-24 [&>div]:bg-teal-600" aria-label={`${c.code} progress ${pct}%`} />
                            <span className="text-xs text-muted-foreground">{pct}%</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(CAUSE_STATUS[c.status] ?? CAUSE_STATUS.SEEKING)}>
                            {titleCase(c.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                            <RowMenu c={c} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PaginationBar page={safePage} pages={pages} total={filtered.length} onPage={setPage} itemLabel="causes" />
              <PageSizeSelect value={pageSize} onChange={setPageSize} />
            </div>
          </>
        ) : view === "list" ? (
          <>
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
                    <Badge variant="outline" className={cn("shrink-0", CAUSE_STATUS[c.status] ?? CAUSE_STATUS.SEEKING)}>
                      {titleCase(c.status)}
                    </Badge>
                    <div onClick={(e) => e.stopPropagation()}>
                      <RowMenu c={c} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PaginationBar page={safePage} pages={pages} total={filtered.length} onPage={setPage} itemLabel="causes" />
              <PageSizeSelect value={pageSize} onChange={setPageSize} />
            </div>
          </>
        ) : (
          <>
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
                    <Badge variant="outline" className={cn("ml-auto", CAUSE_STATUS[c.status] ?? CAUSE_STATUS.SEEKING)}>
                      {titleCase(c.status)}
                    </Badge>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PaginationBar page={safePage} pages={pages} total={filtered.length} onPage={setPage} itemLabel="causes" />
              <PageSizeSelect value={pageSize} onChange={setPageSize} />
            </div>
          </>
        )}
      </SectionCard>

      {/* ============================== DETAIL SHEET ============================= */}
      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg">
          {sheet && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0 text-left">
                <SheetTitle className="flex items-center gap-2">
                  <span className="font-mono text-sm">{sheet.code}</span>
                  <Badge variant="outline" className={cn("ml-auto", CAUSE_STATUS[sheet.status] ?? CAUSE_STATUS.SEEKING)}>
                    {titleCase(sheet.status)}
                  </Badge>
                </SheetTitle>
                <SheetDescription>Medicine sponsorship case · {sheet.city}</SheetDescription>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-3">
                <DataField label="Patient" value={sheet.patientName} />
                <DataField label="Age" value={`${sheet.age} years`} />
                <DataField
                  label="Condition"
                  value={
                    <Badge variant="outline" className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400">
                      {labelOf(conditionOptions.options, sheet.condition)}
                    </Badge>
                  }
                />
                <DataField label="City" value={sheet.city} />
                <DataField label="Monthly cost" value={`${formatINR(sheet.monthlyCost)} / mo`} />
                <DataField label="Duration" value={`${sheet.durationMonths} months`} />
                <DataField label="Raised so far" value={formatINR(sheet.raised)} />
                <DataField label="Total needed" value={formatINR(totalCost(sheet))} />
              </div>

              <SectionCard title="Progress">
                <Progress
                  value={pctOf(sheet)}
                  className="h-2.5 [&>div]:bg-teal-600"
                  aria-label="Fundraising progress"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatINR(sheet.raised)} of {formatINR(totalCost(sheet))} ({sheet.durationMonths} × {formatINR(sheet.monthlyCost)})
                </p>
              </SectionCard>

              <SectionCard title="Story">
                <p className="text-sm leading-relaxed text-muted-foreground">{sheet.story}</p>
              </SectionCard>

              {sheet.adoptedByName ? (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                    <UserCheck className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Adopted by</p>
                    <p className="truncate text-sm font-semibold">{sheet.adoptedByName}</p>
                  </div>
                </div>
              ) : null}

              <SectionCard title={`Pledges (${(sheet.pledges ?? []).length})`}>
                {(sheet.pledges ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No pledges yet — donors can pledge from the public cause page.</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableHead>Donor</TableHead>
                          <TableHead className="text-right">Pledge</TableHead>
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
                            <TableCell className="text-right">
                              <Badge variant="outline" className={cn(PLEDGE_STATUS[pl.status] ?? "")}>
                                {titleCase(pl.status)}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </SectionCard>

              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button variant="outline" size="sm" onClick={() => openEdit(sheet)}>
                  <Pencil className="size-3.5" aria-hidden="true" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void togglePause(sheet)}
                  aria-label={sheet.status === "PAUSED" ? "Resume cause" : "Pause cause"}
                >
                  {sheet.status === "PAUSED" ? (
                    <Play className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Pause className="size-3.5" aria-hidden="true" />
                  )}
                  {sheet.status === "PAUSED" ? "Resume" : "Pause"}
                </Button>
                {sheet.status === "ADOPTED" && sheet.adoptedByName && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                    onClick={() => void issueCertificate(sheet)}
                    disabled={issuing === sheet.id}
                  >
                    <Award className="size-3.5" aria-hidden="true" />
                    {issuing === sheet.id ? "Issuing…" : "Issue certificate"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                  onClick={() => setDeleteTarget(sheet)}
                  aria-label={`Delete ${sheet.code}`}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

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
        size="md"
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
