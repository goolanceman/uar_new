"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  Bird,
  Cat,
  Milk,
  Dog,
  HeartPulse,
  MapPin,
  PawPrint,
  Pencil,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  Syringe,
  Trash2,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { formatINR, initials, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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

/* ---------------------------------- view ----------------------------------- */

export default function AnimalsView() {
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [loading, setLoading] = useState(true);
  const [speciesFilter, setSpeciesFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [sheet, setSheet] = useState<Animal | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Animal | null>(null);
  const [form, setForm] = useState<AnimalForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
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

  const filtered = useMemo(
    () =>
      animals.filter((a) => {
        if (speciesFilter !== "ALL" && a.species !== speciesFilter) return false;
        if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
        return true;
      }),
    [animals, speciesFilter, statusFilter]
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

  /* ------------------------------ form actions ----------------------------- */

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (a: Animal) => {
    setEditing(a);
    setForm({
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
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!form.story.trim()) {
      toast.error("Story is required");
      return;
    }
    if (!form.location.trim()) {
      toast.error("Location is required");
      return;
    }
    const age = Number(form.ageMonths);
    if (!Number.isFinite(age) || age < 0) {
      toast.error("Age (months) must be 0 or more");
      return;
    }
    const food = Number(form.monthlyFood);
    if (!Number.isFinite(food) || food < 0) {
      toast.error("Monthly food cost must be 0 or more");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        species: form.species,
        breed: form.breed.trim(),
        ageMonths: Math.trunc(age),
        gender: form.gender,
        story: form.story.trim(),
        healthStatus: form.healthStatus.trim(),
        vaccinated: form.vaccinated,
        sterilized: form.sterilized,
        location: form.location.trim(),
        monthlyFood: food,
      };
      if (editing) {
        await patch(`/api/animals/${editing.id}`, body);
        toast.success(`${editing.name} updated`);
      } else {
        await post("/api/animals", body);
        toast.success(`${body.name} added to Angel Paws`);
      }
      setDialogOpen(false);
      setSheet(null);
      load();
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
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  /* ------------------------------ adopt dialog ------------------------------ */

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
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Adoption failed");
    } finally {
      setAdopting(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await del(`/api/animals/${deleteTarget.id}`);
      toast.success(`${deleteTarget.name} removed`);
      setDeleteTarget(null);
      setSheet(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <PageHeader
        title="Animal Welfare"
        description="Angel Paws — rescue residents, foster families and adoptions."
        icon={<PawPrint className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={load} aria-label="Refresh animals">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" /> Add animal
            </Button>
          </>
        }
      />

      {/* stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Residents" value={counts.total} accent="lime" icon={<PawPrint className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Available" value={counts.available} accent="emerald" icon={<HeartPulse className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Adopted" value={counts.adopted} accent="teal" icon={<UserCheck className="size-5" aria-hidden="true" />} loading={loading} />
        <StatCard label="Critical rescues" value={counts.critical} accent="red" icon={<HeartPulse className="size-5" aria-hidden="true" />} loading={loading} hint="Need urgent care" />
      </div>

      {/* filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={speciesFilter} onValueChange={setSpeciesFilter}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by species">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All species</SelectItem>
            {speciesOptions.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="AVAILABLE">Available</SelectItem>
            <SelectItem value="FOSTERED">Fostered</SelectItem>
            <SelectItem value="ADOPTED">Adopted</SelectItem>
            <SelectItem value="CRITICAL">Critical</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground sm:ml-auto">
          {filtered.length} of {animals.length} residents
        </p>
      </div>

      {/* cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<PawPrint className="size-8" aria-hidden="true" />}
          title={animals.length === 0 ? "No residents yet" : "No animals match the filters"}
          hint={
            animals.length === 0
              ? "Add rescued animals so donors can sponsor food and medical care."
              : "Try a different species or status filter."
          }
        >
          {animals.length === 0 && (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" /> Add animal
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((a) => {
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
      )}

      {/* ============================== DETAIL SHEET ============================= */}
      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
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
                <Button variant="outline" size="sm" onClick={() => openAdopt(sheet)}>
                  <UserCheck className="size-3.5" aria-hidden="true" /> Mark adopted
                </Button>
                {sheet.status === "FOSTERED" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatus(sheet, "AVAILABLE")}
                    aria-label={`Return ${sheet.name} from foster care`}
                  >
                    End foster
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatus(sheet, "FOSTERED")}
                    aria-label={`Send ${sheet.name} to foster care`}
                  >
                    Foster
                  </Button>
                )}
                {sheet.status === "CRITICAL" ? (
                  <Button variant="outline" size="sm" onClick={() => setStatus(sheet, "AVAILABLE")}>
                    Mark stable
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-400"
                    onClick={() => setStatus(sheet, "CRITICAL")}
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
                      searchUsers();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="icon" onClick={searchUsers} aria-label="Search users" disabled={searchingUsers}>
                  {searchingUsers ? (
                    <Search className="size-4 animate-pulse" aria-hidden="true" />
                  ) : (
                    <Search className="size-4" aria-hidden="true" />
                  )}
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
            <Button onClick={confirmAdopt} disabled={adopting}>
              {adopting ? "Confirming…" : "Confirm adoption"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================ CREATE / EDIT ============================= */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add animal"}</DialogTitle>
            <DialogDescription>
              Rescue profile shown on the public Angel Paws page.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="an-name">Name *</Label>
                <Input
                  id="an-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Simba"
                />
              </div>
              <div className="grid gap-2">
                <Label>Species</Label>
                <Select value={form.species} onValueChange={(v) => setForm({ ...form, species: v })}>
                  <SelectTrigger aria-label="Species">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {speciesOptions.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="an-breed">Breed</Label>
                <Input
                  id="an-breed"
                  value={form.breed}
                  onChange={(e) => setForm({ ...form, breed: e.target.value })}
                  placeholder="Indie / mix"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="an-age">Age (months)</Label>
                <Input
                  id="an-age"
                  type="number"
                  min={0}
                  value={form.ageMonths}
                  onChange={(e) => setForm({ ...form, ageMonths: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Gender</Label>
                <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
                  <SelectTrigger aria-label="Gender">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="FEMALE">Female</SelectItem>
                    <SelectItem value="UNKNOWN">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="an-food">Monthly food (₹)</Label>
                <Input
                  id="an-food"
                  type="number"
                  min={0}
                  value={form.monthlyFood}
                  onChange={(e) => setForm({ ...form, monthlyFood: e.target.value })}
                  placeholder="1500"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="an-location">Location *</Label>
              <Input
                id="an-location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="UAR shelter, Hebbal"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="an-health">Health status</Label>
              <Input
                id="an-health"
                value={form.healthStatus}
                onChange={(e) => setForm({ ...form, healthStatus: e.target.value })}
                placeholder="Recovering from mange"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
                <Label htmlFor="an-vacc" className="text-xs">
                  Vaccinated
                </Label>
                <Switch
                  id="an-vacc"
                  checked={form.vaccinated}
                  onCheckedChange={(v) => setForm({ ...form, vaccinated: v })}
                  aria-label="Vaccinated"
                />
              </div>
              <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
                <Label htmlFor="an-ster" className="text-xs">
                  Sterilized
                </Label>
                <Switch
                  id="an-ster"
                  checked={form.sterilized}
                  onCheckedChange={(v) => setForm({ ...form, sterilized: v })}
                  aria-label="Sterilized"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="an-story">Story *</Label>
              <Textarea
                id="an-story"
                rows={3}
                value={form.story}
                onChange={(e) => setForm({ ...form, story: e.target.value })}
                placeholder="Rescued from a busy junction with a injured leg…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add animal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================ DELETE CONFIRM ============================ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the rescue profile and its pledge history permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep resident</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                remove();
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
