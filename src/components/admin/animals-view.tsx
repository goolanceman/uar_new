"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HandCoins, HeartPulse, MapPin, MoreHorizontal, PawPrint, Pencil, Plus,
  RefreshCw, Scissors, Syringe, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { labelOf, useMasters } from "@/hooks/use-masters";
import { cn, formatINR, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

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

const SPECIES_EMOJI: Record<string, string> = {
  DOG: "🐕",
  CAT: "🐈",
  COW: "🐄",
  BIRD: "🐦",
  OTHER: "🐾",
};

const ANIMAL_STATUS: Record<string, { label: string; cls: string }> = {
  AVAILABLE: { label: "Available", cls: "border-lime-200 bg-lime-50 text-lime-800" },
  FOSTERED: { label: "Fostered", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  ADOPTED: { label: "Adopted", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  CRITICAL: { label: "Critical", cls: "border-red-200 bg-red-50 text-red-800 animate-pulse" },
};

const PLEDGE_KIND_CLS: Record<string, string> = {
  FOOD: "border-lime-200 bg-lime-50 text-lime-800",
  MEDICAL: "border-teal-200 bg-teal-50 text-teal-800",
  VACCINATION: "border-emerald-200 bg-emerald-50 text-emerald-800",
  SHELTER: "border-amber-200 bg-amber-50 text-amber-800",
};

const PLEDGE_STATUS_CLS: Record<string, string> = {
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-800",
  COMPLETED: "border-teal-200 bg-teal-50 text-teal-800",
  CANCELLED: "border-zinc-200 bg-zinc-100 text-zinc-600",
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
  if (!months && months !== 0) return "—";
  if (months < 12) return `${months} mo`;
  return `${Math.floor(months / 12)}y ${months % 12}m`;
}

export default function AnimalsView() {
  const [tab, setTab] = useState("animals");
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Animal | null>(null);
  const [form, setForm] = useState<AnimalForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Animal | null>(null);

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
    if (!form.name.trim() || !form.location.trim()) {
      toast.error("Name and location are required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        species: form.species,
        breed: form.breed.trim(),
        ageMonths: Number(form.ageMonths) || 0,
        gender: form.gender,
        story: form.story.trim(),
        healthStatus: form.healthStatus.trim(),
        vaccinated: form.vaccinated,
        sterilized: form.sterilized,
        location: form.location.trim(),
        monthlyFood: Number(form.monthlyFood) || 0,
      };
      if (editing) {
        await patch(`/api/animals/${editing.id}`, body);
        toast.success(`${editing.name} updated`);
      } else {
        await post("/api/animals", body);
        toast.success(`${body.name} added to Angel Paws`);
      }
      setDialogOpen(false);
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
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await del(`/api/animals/${deleteTarget.id}`);
      toast.success(`${deleteTarget.name} removed`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const cancelPledge = async (p: AnimalPledge) => {
    try {
      await patch(`/api/animal-pledges/${p.id}`, { status: "CANCELLED" });
      toast.success(`Pledge by ${p.donorName} cancelled`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    }
  };

  const pledges = useMemo(
    () =>
      animals.flatMap((a) =>
        (a.pledges ?? []).map((p) => ({
          ...p,
          target: p.animalId ? a.name : (p.shelterFund ?? "Shelter fund"),
        }))
      ),
    [animals]
  );

  const counts = useMemo(
    () => ({
      available: animals.filter((a) => a.status === "AVAILABLE").length,
      critical: animals.filter((a) => a.status === "CRITICAL").length,
      adopted: animals.filter((a) => a.status === "ADOPTED").length,
    }),
    [animals]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-lime-200 bg-lime-50 text-lime-800">
          {counts.available} available
        </Badge>
        <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">
          {counts.critical} critical
        </Badge>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
          {counts.adopted} adopted
        </Badge>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="icon" onClick={load} aria-label="Refresh animals">
            <RefreshCw className="size-4" />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Add animal
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="animals">Residents</TabsTrigger>
          <TabsTrigger value="pledges">Pledges ({pledges.length})</TabsTrigger>
        </TabsList>

        {/* ================= ANIMALS ================= */}
        <TabsContent value="animals" className="mt-4">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-64 rounded-xl" />
              ))}
            </div>
          ) : animals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
              <PawPrint className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No residents yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Add rescued animals so donors can sponsor food and medical care.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {animals.map((a) => {
                const st = ANIMAL_STATUS[a.status] ?? ANIMAL_STATUS.AVAILABLE;
                const pledgeCount = (a.pledges ?? []).length;
                return (
                  <Card key={a.id} className="flex flex-col">
                    <CardContent className="flex flex-1 flex-col gap-3 p-4">
                      <div className="flex items-start gap-3">
                        <span
                          className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-xl"
                          aria-hidden="true"
                        >
                          {SPECIES_EMOJI[a.species] ?? "🐾"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold leading-tight">{a.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {labelOf(speciesOptions.options, a.species)}
                            {a.breed ? ` · ${a.breed}` : ""} · {ageText(a.ageMonths)}
                          </p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", st.cls)}>
                          {st.label}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline">
                          {a.gender === "FEMALE" ? "♀ Female" : "♂ Male"}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            a.vaccinated
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "text-zinc-500"
                          }
                        >
                          <Syringe className="size-3" />
                          {a.vaccinated ? "Vaccinated" : "Not vaccinated"}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            a.sterilized
                              ? "border-teal-200 bg-teal-50 text-teal-800"
                              : "text-zinc-500"
                          }
                        >
                          <Scissors className="size-3" />
                          {a.sterilized ? "Sterilized" : "Not sterilized"}
                        </Badge>
                        {a.healthStatus ? (
                          <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">
                            <HeartPulse className="size-3" />
                            {a.healthStatus}
                          </Badge>
                        ) : null}
                      </div>

                      <p className="line-clamp-2 text-xs text-muted-foreground">{a.story}</p>

                      <div className="mt-auto space-y-2">
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span className="flex min-w-0 items-center gap-1">
                            <MapPin className="size-3.5 shrink-0" />
                            <span className="truncate">{a.location}</span>
                          </span>
                          <span className="whitespace-nowrap font-medium text-foreground">
                            {formatINR(a.monthlyFood)}/mo food
                          </span>
                        </div>
                        {pledgeCount > 0 ? (
                          <Badge variant="outline" className="border-lime-200 bg-lime-50 text-lime-800">
                            <HandCoins className="size-3" />
                            {pledgeCount} pledge{pledgeCount === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="flex gap-1.5 border-t pt-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label={`Change status of ${a.name}`}
                            >
                              <MoreHorizontal className="size-3.5" /> Status
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuLabel>Set status</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setStatus(a, "AVAILABLE")}>
                              <span className="size-2 rounded-full bg-lime-500" /> Available
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setStatus(a, "FOSTERED")}>
                              <span className="size-2 rounded-full bg-amber-500" /> Fostered
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setStatus(a, "ADOPTED")}>
                              <span className="size-2 rounded-full bg-emerald-500" /> Adopted
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setStatus(a, "CRITICAL")}
                              className="text-red-600 focus:text-red-700"
                            >
                              <span className="size-2 rounded-full bg-red-500" /> Critical
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(a)}
                          aria-label={`Edit ${a.name}`}
                        >
                          <Pencil className="size-3.5" /> Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setDeleteTarget(a)}
                          aria-label={`Delete ${a.name}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ================= PLEDGES ================= */}
        <TabsContent value="pledges" className="mt-4">
          {loading ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : pledges.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
              <HandCoins className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No animal pledges yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Donor pledges for food, medical care and shelter appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Donor</TableHead>
                    <TableHead>For</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pledges.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.donorName}</TableCell>
                      <TableCell>{p.target}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("whitespace-nowrap", PLEDGE_KIND_CLS[p.kind] ?? "")}>
                          {titleCase(p.kind)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatINR(p.amount)}</TableCell>
                      <TableCell>{titleCase(p.frequency)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("whitespace-nowrap", PLEDGE_STATUS_CLS[p.status] ?? "")}
                        >
                          {titleCase(p.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {p.status === "ACTIVE" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => cancelPledge(p)}
                            aria-label={`Cancel pledge by ${p.donorName}`}
                          >
                            Cancel
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ============ CREATE / EDIT DIALOG ============ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add animal"}</DialogTitle>
            <DialogDescription>
              Angel Paws resident profile — donors sponsor food and care.
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
                <Select
                  value={form.species}
                  onValueChange={(v) => setForm({ ...form, species: v })}
                >
                  <SelectTrigger aria-label="Species">
                    <SelectValue placeholder="Select species" />
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
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="an-breed">Breed</Label>
                <Input
                  id="an-breed"
                  value={form.breed}
                  onChange={(e) => setForm({ ...form, breed: e.target.value })}
                  placeholder="Indie"
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
              <div className="grid gap-2">
                <Label>Gender</Label>
                <Select
                  value={form.gender}
                  onValueChange={(v) => setForm({ ...form, gender: v })}
                >
                  <SelectTrigger aria-label="Gender">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="FEMALE">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="an-location">Location *</Label>
                <Input
                  id="an-location"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Jayanagar shelter"
                />
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
              <Label htmlFor="an-health">Health status</Label>
              <Input
                id="an-health"
                value={form.healthStatus}
                onChange={(e) => setForm({ ...form, healthStatus: e.target.value })}
                placeholder="Recovering from mange"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="an-story">Story</Label>
              <Textarea
                id="an-story"
                rows={3}
                value={form.story}
                onChange={(e) => setForm({ ...form, story: e.target.value })}
                placeholder="Rescued from a highway median with a fractured leg…"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="an-vaccinated" className="cursor-pointer">
                  Vaccinated
                </Label>
                <Switch
                  id="an-vaccinated"
                  checked={form.vaccinated}
                  onCheckedChange={(v) => setForm({ ...form, vaccinated: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="an-sterilized" className="cursor-pointer">
                  Sterilized
                </Label>
                <Switch
                  id="an-sterilized"
                  checked={form.sterilized}
                  onCheckedChange={(v) => setForm({ ...form, sterilized: v })}
                />
              </div>
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

      {/* ============ DELETE CONFIRM ============ */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the resident and its pledge records.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Keep
            </Button>
            <Button variant="destructive" onClick={remove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
