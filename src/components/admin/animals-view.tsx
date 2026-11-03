"use client";

/**
 * Animal Welfare — Angel Paws (admin), rebuilt on the round-3 design system.
 *
 * - Toolbar: debounced search + species/status filters + ViewSwitcher
 *   (table / grid / list, persisted) + CSV export + "Add animal"
 * - Create/Edit via FormSheet (lg) with inline validation, dirty tracking
 *   and an unsaved-changes guard
 * - Detail Sheet: rescue profile, health flags, pledges and the
 *   adopt / foster / critical / delete actions
 * - Adoption flow kept: adopt Dialog with user search + certificate issuance
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bird,
  Cat,
  Dog,
  Eye,
  HeartPulse,
  MapPin,
  Milk,
  MoreHorizontal,
  PawPrint,
  Pencil,
  Plus,
  Scissors,
  Search,
  Syringe,
  Trash2,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { formatINR, formatINRCompact, initials, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { required } from "@/lib/validators";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
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
  SwitchField,
  TextareaField,
  TextField,
} from "@/components/shared/form-fields";
import { FormSheet } from "@/components/shared/form-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/* ---------------------------------- types ---------------------------------- */

interface AnimalPledge {
  id: string;
  animalId?: string | null;
  shelterFund?: string | null;
  donorName: string;
  kind: string;
  amount: number;
  frequency: string;
  status: string;
}

interface Animal {
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
  pledges?: AnimalPledge[];
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
  monthlyFood: string;
}

interface UserLite {
  id: string;
  name: string;
  email: string;
  role: string;
}

/* ------------------------------- chip styles ------------------------------- */

const ANIMAL_STATUS: Record<string, string> = {
  AVAILABLE: "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-400",
  FOSTERED: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ADOPTED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  CRITICAL: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400 animate-pulse",
};

const PLEDGE_STATUS_CLS: Record<string, string> = {
  ACTIVE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  COMPLETED: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  CANCELLED: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const SPECIES_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  DOG: Dog,
  CAT: Cat,
  COW: Milk,
  BIRD: Bird,
  OTHER: PawPrint,
};

const ANIMAL_STATUSES = ["AVAILABLE", "FOSTERED", "ADOPTED", "CRITICAL"];

const EMPTY_FORM: AnimalForm = {
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
  monthlyFood: "",
};

function ageText(months: number): string {
  const m = Math.max(0, Math.trunc(Number(months ?? 0)));
  if (m < 12) return `${m} months`;
  const y = Math.floor(m / 12);
  const rest = m % 12;
  return rest ? `${y}y ${rest}m` : `${y} year${y === 1 ? "" : "s"}`;
}

function validateAnimalForm(f: AnimalForm): Record<string, string | null> {
  const age = f.ageMonths.trim() === "" ? NaN : Number(f.ageMonths);
  const food = f.monthlyFood.trim() === "" ? 0 : Number(f.monthlyFood);
  return {
    name: required("Name")(f.name),
    ageMonths:
      Number.isFinite(age) && age >= 0 && age <= 600
        ? null
        : "Age must be between 0 and 600 months",
    story: required("Story")(f.story),
    location: required("Location")(f.location),
    monthlyFood:
      Number.isFinite(food) && food >= 0 && food <= 1_000_000
        ? null
        : "Enter a valid monthly food amount (₹0 or more)",
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
        <Skeleton key={i} className="h-64 rounded-xl" />
      ))}
    </div>
  );
}

/* ---------------------------------- view ----------------------------------- */

export default function AnimalsView() {
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // filters (search debounced into `query`)
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // view + pagination
  const [view, setView] = useViewPref("animals", "grid");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // form sheet
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Animal | null>(null);
  const [form, setForm] = useState<AnimalForm>(EMPTY_FORM);
  const [snapshot, setSnapshot] = useState(JSON.stringify(EMPTY_FORM));
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // detail sheet + confirm
  const [sheet, setSheet] = useState<Animal | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Animal | null>(null);

  /* adopt dialog state */
  const [adoptTarget, setAdoptTarget] = useState<Animal | null>(null);
  const [adopterName, setAdopterName] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [userMatches, setUserMatches] = useState<UserLite[]>([]);
  const [adoptUserId, setAdoptUserId] = useState<string | null>(null);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [adopting, setAdopting] = useState(false);

  const speciesOptions = useMasters("ANIMAL_SPECIES");

  const load = useCallback(async () => {
    try {
      const data = await get<Animal[]>("/api/animals");
      setAnimals(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load animals");
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
  }, [query, speciesFilter, statusFilter, pageSize]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return animals.filter((a) => {
      if (speciesFilter !== "ALL" && a.species !== speciesFilter) return false;
      if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
      if (q && !`${a.name}`.toLowerCase().includes(q) && !`${a.location ?? ""}`.toLowerCase().includes(q) && !`${a.breed ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [animals, query, speciesFilter, statusFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize]
  );

  const counts = useMemo(
    () => ({
      total: animals.length,
      available: animals.filter((a) => a.status === "AVAILABLE").length,
      adopted: animals.filter((a) => a.status === "ADOPTED").length,
      critical: animals.filter((a) => a.status === "CRITICAL").length,
    }),
    [animals]
  );

  /* ------------------------------- validation ------------------------------ */

  const errors = useMemo(() => validateAnimalForm(form), [form]);
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
    const f = { ...EMPTY_FORM, species: speciesOptions.options[0]?.value ?? "DOG" };
    setForm(f);
    setSnapshot(JSON.stringify(f));
    setFormOpen(true);
  };

  const openEdit = (a: Animal) => {
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
      monthlyFood: String(a.monthlyFood ?? 0),
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
        monthlyFood: Number(form.monthlyFood || 0),
      };
      if (editing) {
        await patch(`/api/animals/${editing.id}`, body);
        toast.success(`${editing.name} updated`);
      } else {
        await post("/api/animals", body);
        toast.success(`${body.name} added to Angel Paws`);
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

  const setStatus = async (a: Animal, status: string) => {
    try {
      await patch(`/api/animals/${a.id}`, { status });
      toast.success(`${a.name} marked ${titleCase(status).toLowerCase()}`);
      setSheet((prev) => (prev && prev.id === a.id ? { ...prev, status } : prev));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  /* ------------------------------ adopt dialog ----------------------------- */

  const openAdopt = (a: Animal) => {
    setAdoptTarget(a);
    setAdopterName(a.adoptedByName ?? "");
    setAdoptUserId(a.adoptedById ?? null);
    setUserQuery("");
    setUserMatches([]);
  };

  const searchUsers = async () => {
    if (!userQuery.trim()) return;
    setSearchingUsers(true);
    try {
      const rows = await get<UserLite[]>(`/api/users?q=${encodeURIComponent(userQuery.trim())}`);
      setUserMatches(Array.isArray(rows) ? rows.slice(0, 6) : []);
    } catch {
      setUserMatches([]);
      toast.error("User search unavailable");
    } finally {
      setSearchingUsers(false);
    }
  };

  const confirmAdopt = async () => {
    if (!adoptTarget) return;
    const adopter = adopterName.trim();
    if (!adopter) {
      toast.error("Adopter name is required");
      return;
    }
    setAdopting(true);
    try {
      await patch(`/api/animals/${adoptTarget.id}`, {
        status: "ADOPTED",
        adoptedByName: adopter,
        adoptedById: adoptUserId ?? undefined,
      });
      const res = await post<{ certificate?: { code?: string } }>("/api/certificates", {
        type: "ANIMAL_ADOPTION",
        recipientName: adopter,
        userId: adoptUserId ?? undefined,
        title: "Animal Adoption Certificate",
        description: `Adoption of ${adoptTarget.name} (${titleCase(adoptTarget.species)})`,
        meta: JSON.stringify({ animal: adoptTarget.name, species: adoptTarget.species }),
      });
      const code = res?.certificate?.code;
      if (code) {
        toast.success(`${adoptTarget.name} adopted by ${adopter} — certificate ${code} issued`, {
          action: {
            label: "Open",
            onClick: () => window.open(`/api/certificates/${code}/html`, "_blank"),
          },
        });
      } else {
        toast.success(`${adoptTarget.name} adopted by ${adopter}`);
      }
      setAdoptTarget(null);
      setSheet(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Adoption failed");
    } finally {
      setAdopting(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await del(`/api/animals/${deleteTarget.id}`);
      toast.success(`${deleteTarget.name} removed`);
      setDeleteTarget(null);
      setSheet(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------ actions menu ----------------------------- */

  const RowMenu = ({ a }: { a: Animal }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-8"
          aria-label={`Actions for ${a.name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => setSheet(a)}>
          <Eye className="size-4" /> View details
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openEdit(a)}>
          <Pencil className="size-4" /> Edit
        </DropdownMenuItem>
        {a.status !== "ADOPTED" && (
          <DropdownMenuItem onSelect={() => openAdopt(a)}>
            <UserCheck className="size-4" /> Mark adopted…
          </DropdownMenuItem>
        )}
        {a.status === "FOSTERED" ? (
          <DropdownMenuItem onSelect={() => void setStatus(a, "AVAILABLE")}>
            <PawPrint className="size-4" /> End foster
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => void setStatus(a, "FOSTERED")} disabled={a.status === "ADOPTED"}>
            <PawPrint className="size-4" /> Send to foster
          </DropdownMenuItem>
        )}
        {a.status === "CRITICAL" ? (
          <DropdownMenuItem onSelect={() => void setStatus(a, "AVAILABLE")}>
            <HeartPulse className="size-4" /> Mark stable
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => void setStatus(a, "CRITICAL")} className="text-red-600 focus:text-red-600 dark:text-red-400">
            <HeartPulse className="size-4" /> Critical rescue
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => setDeleteTarget(a)}
          className="text-red-600 focus:text-red-600 dark:text-red-400"
        >
          <Trash2 className="size-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  /* --------------------------------- CSV ----------------------------------- */

  const csvColumns: CsvColumn<Animal>[] = [
    { header: "Name", value: (a) => a.name },
    { header: "Species", value: (a) => labelOf(speciesOptions.options, a.species) },
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

  /* -------------------------------- render --------------------------------- */

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Animal Welfare"
        description="Angel Paws — rescue residents, foster families and adoptions."
        icon={<PawPrint className="size-5" aria-hidden="true" />}
        actions={
          <Button onClick={openCreate} aria-label="Add animal">
            <Plus className="size-4" aria-hidden="true" /> Add animal
          </Button>
        }
      />

      {/* stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Residents" value={counts.total} accent="lime" icon={<PawPrint className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Available" value={counts.available} accent="emerald" icon={<HeartPulse className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Adopted" value={counts.adopted} accent="teal" icon={<UserCheck className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Critical rescues" value={counts.critical} accent="red" icon={<HeartPulse className="size-5" aria-hidden="true" />} loading={loading} hint="Need urgent care" />
      </div>

      <SectionCard
        title="Rescue directory"
        icon={<PawPrint className="size-4" aria-hidden="true" />}
        description={loading ? "Loading residents…" : `${filtered.length} of ${animals.length} residents`}
        bodyClassName="space-y-4"
        actions={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative w-full sm:w-48">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, breed or place…"
                className="pl-9"
                aria-label="Search animals"
              />
            </div>
            <Select value={speciesFilter} onValueChange={setSpeciesFilter}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Filter by species">
                <SelectValue placeholder="All species" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All species</SelectItem>
                {speciesOptions.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {ANIMAL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ViewSwitcher value={view} onChange={setView} />
            <ExportMenu columns={csvColumns} rows={filtered} filename="uar-animals" disabled={loading || filtered.length === 0} />
          </div>
        }
      >
        {loading ? (
          <ViewSkeleton view={view} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<PawPrint className="size-6" aria-hidden="true" />}
            title={animals.length === 0 ? "No residents yet" : "No animals match the filters"}
            hint={
              animals.length === 0
                ? "Add rescued animals so donors can sponsor food and medical care."
                : "Try a different search term, species or status filter."
            }
          >
            {animals.length === 0 ? (
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-4" aria-hidden="true" /> Add animal
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setQuery("");
                  setSpeciesFilter("ALL");
                  setStatusFilter("ALL");
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
                    <TableHead>Resident</TableHead>
                    <TableHead className="hidden lg:table-cell">Age / gender</TableHead>
                    <TableHead className="hidden xl:table-cell">Health</TableHead>
                    <TableHead className="hidden md:table-cell">Care flags</TableHead>
                    <TableHead className="text-right">Food / mo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((a) => {
                    const Icon = SPECIES_ICONS[a.species] ?? PawPrint;
                    return (
                      <TableRow
                        key={a.id}
                        className="cursor-pointer"
                        onClick={() => setSheet(a)}
                        aria-label={`Open details for ${a.name}`}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-lime-500/10 text-lime-600 dark:text-lime-400">
                              <Icon className="size-4" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{a.name}</p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {labelOf(speciesOptions.options, a.species)}
                                {a.breed ? ` · ${a.breed}` : ""} · {a.location}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                          {ageText(a.ageMonths)} · {a.gender === "FEMALE" ? "♀" : a.gender === "MALE" ? "♂" : "—"}
                        </TableCell>
                        <TableCell className="hidden max-w-40 truncate text-sm text-muted-foreground xl:table-cell">
                          {a.healthStatus || "No issues noted"}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex gap-1">
                            {a.vaccinated && (
                              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" aria-label="Vaccinated">
                                <Syringe className="size-3" aria-hidden="true" /> Vacc
                              </Badge>
                            )}
                            {a.sterilized && (
                              <Badge variant="outline" className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400" aria-label="Sterilized">
                                <Scissors className="size-3" aria-hidden="true" /> Ster
                              </Badge>
                            )}
                            {!a.vaccinated && !a.sterilized && <span className="text-xs text-muted-foreground">—</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatINR(a.monthlyFood)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(ANIMAL_STATUS[a.status] ?? ANIMAL_STATUS.AVAILABLE)}>
                            {titleCase(a.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                            <RowMenu a={a} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PaginationBar page={safePage} pages={pages} total={filtered.length} onPage={setPage} itemLabel="residents" />
              <PageSizeSelect value={pageSize} onChange={setPageSize} />
            </div>
          </>
        ) : view === "list" ? (
          <>
            <ul className="divide-y rounded-xl border bg-card">
              {paged.map((a) => {
                const Icon = SPECIES_ICONS[a.species] ?? PawPrint;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSheet(a)}
                      aria-label={`Open details for ${a.name}`}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary sm:px-4"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-lime-500/10 text-lime-600 dark:text-lime-400">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{a.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {labelOf(speciesOptions.options, a.species)}
                          {a.breed ? ` · ${a.breed}` : ""} · {ageText(a.ageMonths)} · {a.location}
                        </p>
                      </div>
                      <div className="hidden shrink-0 items-center gap-1 sm:flex">
                        {a.vaccinated && <Syringe className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-label="Vaccinated" />}
                        {a.sterilized && <Scissors className="size-3.5 text-teal-600 dark:text-teal-400" aria-label="Sterilized" />}
                      </div>
                      <span className="hidden shrink-0 text-sm font-medium sm:block">{formatINRCompact(a.monthlyFood)}</span>
                      <Badge variant="outline" className={cn("shrink-0", ANIMAL_STATUS[a.status] ?? ANIMAL_STATUS.AVAILABLE)}>
                        {titleCase(a.status)}
                      </Badge>
                      <div onClick={(e) => e.stopPropagation()}>
                        <RowMenu a={a} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PaginationBar page={safePage} pages={pages} total={filtered.length} onPage={setPage} itemLabel="residents" />
              <PageSizeSelect value={pageSize} onChange={setPageSize} />
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {paged.map((a) => {
                const Icon = SPECIES_ICONS[a.species] ?? PawPrint;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSheet(a)}
                    aria-label={`Open details for ${a.name}`}
                    className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-lime-500/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-lime-500/10 text-lime-600 dark:text-lime-400">
                        <Icon className="size-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold leading-tight">{a.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {labelOf(speciesOptions.options, a.species)}
                          {a.breed ? ` · ${a.breed}` : ""} · {ageText(a.ageMonths)}
                        </p>
                      </div>
                      <Badge variant="outline" className={cn("shrink-0", ANIMAL_STATUS[a.status] ?? ANIMAL_STATUS.AVAILABLE)}>
                        {titleCase(a.status)}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline">{a.gender === "FEMALE" ? "♀ Female" : a.gender === "MALE" ? "♂ Male" : "Unknown"}</Badge>
                      <Badge
                        variant="outline"
                        className={a.vaccinated ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}
                      >
                        <Syringe className="size-3" aria-hidden="true" />
                        {a.vaccinated ? "Vaccinated" : "Not vaccinated"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={a.sterilized ? "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400" : "text-muted-foreground"}
                      >
                        <Scissors className="size-3" aria-hidden="true" />
                        {a.sterilized ? "Sterilized" : "Not sterilized"}
                      </Badge>
                    </div>

                    <p className="line-clamp-2 text-xs text-muted-foreground">{a.story}</p>

                    <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3 text-xs">
                      <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                        <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{a.location}</span>
                      </span>
                      <span className="whitespace-nowrap font-medium">{formatINR(a.monthlyFood)}/mo food</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PaginationBar page={safePage} pages={pages} total={filtered.length} onPage={setPage} itemLabel="residents" />
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
                  {sheet.name}
                  <Badge variant="outline" className={cn("ml-auto", ANIMAL_STATUS[sheet.status] ?? "")}>
                    {titleCase(sheet.status)}
                  </Badge>
                </SheetTitle>
                <SheetDescription>
                  {labelOf(speciesOptions.options, sheet.species)} · Angel Paws resident
                </SheetDescription>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-3">
                <DataField label="Breed" value={sheet.breed || "—"} />
                <DataField label="Age" value={ageText(sheet.ageMonths)} />
                <DataField label="Gender" value={titleCase(sheet.gender)} />
                <DataField label="Monthly food" value={formatINR(sheet.monthlyFood)} />
                <DataField label="Location" value={sheet.location} icon={<MapPin className="size-3.5" aria-hidden="true" />} />
                <DataField label="Health" value={sheet.healthStatus || "No issues noted"} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
                  <Label htmlFor="sheet-vacc" className="text-xs">
                    Vaccinated
                  </Label>
                  <Switch id="sheet-vacc" checked={!!sheet.vaccinated} disabled aria-label="Vaccinated" />
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
                  <Label htmlFor="sheet-ster" className="text-xs">
                    Sterilized
                  </Label>
                  <Switch id="sheet-ster" checked={!!sheet.sterilized} disabled aria-label="Sterilized" />
                </div>
              </div>

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
                  <p className="text-sm text-muted-foreground">No pledges yet — donors can sponsor food, medical care or shelter.</p>
                ) : (
                  <ul className="max-h-60 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                    {(sheet.pledges ?? []).map((pl) => (
                      <li key={pl.id} className="flex items-center gap-2 rounded-lg border p-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{pl.donorName}</p>
                          <p className="text-xs text-muted-foreground">
                            {titleCase(pl.kind)} · {formatINR(pl.amount)} · {titleCase(pl.frequency)}
                          </p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", PLEDGE_STATUS_CLS[pl.status] ?? "")}>
                          {titleCase(pl.status)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <div className="flex flex-wrap gap-2 border-t pt-4">
                {sheet.status !== "ADOPTED" && (
                  <Button variant="outline" size="sm" onClick={() => openAdopt(sheet)}>
                    <UserCheck className="size-3.5" aria-hidden="true" /> Mark adopted
                  </Button>
                )}
                {sheet.status === "FOSTERED" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void setStatus(sheet, "AVAILABLE")}
                    aria-label={`Return ${sheet.name} from foster care`}
                  >
                    End foster
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sheet.status === "ADOPTED"}
                    onClick={() => void setStatus(sheet, "FOSTERED")}
                    aria-label={`Send ${sheet.name} to foster care`}
                  >
                    Foster
                  </Button>
                )}
                {sheet.status === "CRITICAL" ? (
                  <Button variant="outline" size="sm" onClick={() => void setStatus(sheet, "AVAILABLE")}>
                    Mark stable
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-400"
                    onClick={() => void setStatus(sheet, "CRITICAL")}
                  >
                    <HeartPulse className="size-3.5" aria-hidden="true" /> Critical rescue
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => openEdit(sheet)}>
                  <Pencil className="size-3.5" aria-hidden="true" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                  onClick={() => setDeleteTarget(sheet)}
                  aria-label={`Delete ${sheet.name}`}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============================ ADOPT DIALOG =============================== */}
      <Dialog open={!!adoptTarget} onOpenChange={(o) => !o && setAdoptTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark {adoptTarget?.name} as adopted</DialogTitle>
            <DialogDescription>
              Records the adopter and issues an Animal Adoption Certificate.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="adopt-name">Adopter name *</Label>
              <Input
                id="adopt-name"
                value={adopterName}
                onChange={(e) => setAdopterName(e.target.value)}
                placeholder="Ravi Kumar"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="adopt-search">Link an existing account (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="adopt-search"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Search by name or email…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void searchUsers();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="icon" className="size-11 shrink-0" onClick={() => void searchUsers()} aria-label="Search users" disabled={searchingUsers}>
                  <Search className="size-4" aria-hidden="true" />
                </Button>
              </div>
              {userMatches.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-1 scrollbar-thin">
                  {userMatches.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setAdoptUserId(u.id);
                          setAdopterName(u.name);
                          setUserMatches([]);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                          adoptUserId === u.id && "bg-accent"
                        )}
                      >
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                          {initials(u.name)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{u.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {adoptUserId && (
                <p className="text-xs text-muted-foreground">Account linked — the certificate will appear in their portal.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdoptTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmAdopt()} disabled={adopting}>
              {adopting ? "Confirming…" : "Confirm adoption"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================ CREATE / EDIT ============================= */}
      <FormSheet
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        title={editing ? `Edit ${editing.name}` : "Add animal"}
        description="Rescue profile shown on the public Angel Paws page."
        onSubmit={save}
        submitLabel={editing ? "Save changes" : "Add animal"}
        loading={saving}
        dirty={dirty}
        size="lg"
        footerExtra={
          errorCount > 0 ? (
            <span className="font-medium text-destructive">{errorCount} field(s) need attention</span>
          ) : null
        }
      >
        <FormSection title="Profile" description="Identity and basic facts about this resident.">
          <FieldGrid>
            <TextField
              label="Name"
              required
              value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="Simba"
              error={errors.name}
            />
            <SelectField
              label="Species"
              value={form.species}
              onChange={(v) => setForm((f) => ({ ...f, species: v }))}
              options={speciesOptions.options.length > 0 ? speciesOptions.options : [{ value: "OTHER", label: "Other" }]}
              placeholder="Select species"
            />
          </FieldGrid>
          <FieldGrid>
            <TextField
              label="Breed"
              value={form.breed}
              onChange={(v) => setForm((f) => ({ ...f, breed: v }))}
              placeholder="Indie / mix"
            />
            <TextField
              label="Age (months)"
              type="number"
              min="0"
              value={form.ageMonths}
              onChange={(v) => setForm((f) => ({ ...f, ageMonths: v }))}
              placeholder="12"
              error={errors.ageMonths}
            />
          </FieldGrid>
          <SelectField
            label="Gender"
            value={form.gender}
            onChange={(v) => setForm((f) => ({ ...f, gender: v }))}
            options={[
              { value: "MALE", label: "Male" },
              { value: "FEMALE", label: "Female" },
              { value: "UNKNOWN", label: "Unknown" },
            ]}
          />
        </FormSection>

        <FormSection title="Health & care" description="Medical flags and the monthly cost of care.">
          <TextField
            label="Health status"
            value={form.healthStatus}
            onChange={(v) => setForm((f) => ({ ...f, healthStatus: v }))}
            placeholder="Recovering from mange"
            hint="Leave blank if there are no issues."
          />
          <FieldGrid>
            <SwitchField
              label="Vaccinated"
              hint="Rabies and core vaccines"
              checked={form.vaccinated}
              onChange={(v) => setForm((f) => ({ ...f, vaccinated: v }))}
            />
            <SwitchField
              label="Sterilized"
              hint="Spayed or neutered"
              checked={form.sterilized}
              onChange={(v) => setForm((f) => ({ ...f, sterilized: v }))}
            />
          </FieldGrid>
          <FieldGrid>
            <TextField
              label="Location"
              required
              value={form.location}
              onChange={(v) => setForm((f) => ({ ...f, location: v }))}
              placeholder="UAR shelter, Hebbal"
              error={errors.location}
            />
            <TextField
              label="Monthly food cost"
              type="number"
              min="0"
              prefix="₹"
              value={form.monthlyFood}
              onChange={(v) => setForm((f) => ({ ...f, monthlyFood: v }))}
              placeholder="1500"
              hint="₹0 if not yet known."
              error={errors.monthlyFood}
            />
          </FieldGrid>
        </FormSection>

        <FormSection title="Story" description="The rescue journey — shown on the public adoption page.">
          <TextareaField
            label="Story"
            required
            rows={4}
            value={form.story}
            onChange={(v) => setForm((f) => ({ ...f, story: v }))}
            placeholder="Rescued from a busy junction with an injured leg…"
            error={errors.story}
          />
        </FormSection>
      </FormSheet>

      {/* ============================ DELETE CONFIRM ============================ */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Remove ${deleteTarget?.name ?? "resident"}?`}
        recordName={deleteTarget ? `${deleteTarget.name} · ${labelOf(speciesOptions.options, deleteTarget.species)}` : null}
        description="This deletes the rescue profile and its pledge history permanently."
        confirmLabel="Delete resident"
        loading={saving}
        onConfirm={remove}
      />

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard unsaved changes?"
        description="Your edits to this resident haven't been saved yet. Closing now will lose them."
        confirmLabel="Discard"
        onConfirm={() => {
          setFormOpen(false);
          setConfirmDiscard(false);
        }}
      />
    </div>
  );
}
