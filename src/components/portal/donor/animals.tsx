"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bird,
  Cat,
  Dog,
  HeartHandshake,
  Home,
  Info,
  MapPin,
  PawPrint,
  ShieldCheck,
  Stethoscope,
  Syringe,
  Utensils,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch, post } from "@/lib/api-client";
import { cn, formatINR, titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface Animal {
  id: string;
  name: string;
  species: string; // DOG | CAT | COW | BIRD | OTHER
  breed?: string | null;
  ageMonths: number;
  gender: string;
  story: string;
  vaccinated: boolean;
  sterilized: boolean;
  location: string;
  status: string; // AVAILABLE | FOSTERED | ADOPTED | CRITICAL
  monthlyFood: number;
}

interface AnimalPledge {
  id: string;
  kind: string; // FOOD | MEDICAL | VACCINATION | SHELTER
  amount: number;
  frequency: string; // ONE_TIME | MONTHLY
  status: string;
  animal?: { name: string; species: string } | null;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

const SPECIES_ICONS: Record<string, LucideIcon> = {
  DOG: Dog,
  CAT: Cat,
  BIRD: Bird,
  COW: PawPrint,
  OTHER: PawPrint,
};

const KIND_ICONS: Record<string, LucideIcon> = {
  FOOD: Utensils,
  MEDICAL: Stethoscope,
  VACCINATION: Syringe,
  SHELTER: Home,
};

function AnimalStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        status === "AVAILABLE" && "border-lime-200 bg-lime-50 text-lime-700",
        status === "FOSTERED" && "border-amber-200 bg-amber-50 text-amber-700",
        status === "ADOPTED" && "border-teal-200 bg-teal-50 text-teal-700",
        status === "CRITICAL" && "border-red-200 bg-red-50 text-red-700"
      )}
    >
      {titleCase(status)}
    </Badge>
  );
}

export default function DonorAnimals(_props: { user: SessionUser }) {
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [pledges, setPledges] = useState<AnimalPledge[]>([]);
  const [loading, setLoading] = useState(true);

  const [sponsorAnimal, setSponsorAnimal] = useState<Animal | null>(null);
  const [kind, setKind] = useState("FOOD");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [submitting, setSubmitting] = useState(false);

  const [cancelPledge, setCancelPledge] = useState<AnimalPledge | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, p] = await Promise.all([
        get<unknown>("/api/animals"),
        get<unknown>("/api/animals/pledges?mine=1"),
      ]);
      setAnimals(asArray<Animal>(a));
      setPledges(asArray<AnimalPledge>(p));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load animals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const defaultAmountFor = (a: Animal, k: string) => {
    if (k === "FOOD") return String(Math.round(a.monthlyFood || 500));
    if (k === "MEDICAL") return "500";
    if (k === "VACCINATION") return "300";
    return "400"; // SHELTER
  };

  const openSponsor = (a: Animal) => {
    setSponsorAnimal(a);
    setKind("FOOD");
    setAmount(defaultAmountFor(a, "FOOD"));
    setFrequency("MONTHLY");
  };

  const changeKind = (k: string) => {
    setKind(k);
    if (sponsorAnimal) setAmount(defaultAmountFor(sponsorAnimal, k));
  };

  const submitSponsor = async () => {
    if (!sponsorAnimal) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 50) {
      toast.error("Minimum sponsorship is ₹50");
      return;
    }
    setSubmitting(true);
    try {
      await post("/api/animals/pledges", {
        animalId: sponsorAnimal.id,
        kind,
        amount: amt,
        frequency,
      });
      toast.success(
        `Thank you! Your ${frequency === "MONTHLY" ? "monthly" : "one-time"} ${kind.toLowerCase()} sponsorship for ${sponsorAnimal.name} is recorded.`
      );
      setSponsorAnimal(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create sponsorship");
    } finally {
      setSubmitting(false);
    }
  };

  const submitCancel = async () => {
    if (!cancelPledge) return;
    setCancelling(true);
    try {
      await patch(`/api/animal-pledges/${cancelPledge.id}`, {
        status: "CANCELLED",
      });
      toast.success("Sponsorship cancelled.");
      setCancelPledge(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel sponsorship");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Animal sponsorship
        </h1>
        <p className="text-sm text-muted-foreground">
          Feed, heal and shelter rescued animals at the UAR shelter.
        </p>
      </div>

      {/* ---------- Meet the animals ---------- */}
      <section aria-label="Meet the animals">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <PawPrint className="size-4" aria-hidden="true" /> Meet the animals
        </h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-60 rounded-xl" />
            ))}
          </div>
        ) : animals.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <PawPrint className="size-8 text-primary/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                The shelter roster is being updated — check back soon.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {animals.map((a) => {
              const SpeciesIcon = SPECIES_ICONS[a.species] ?? PawPrint;
              return (
                <Card key={a.id} className="flex flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lime-100 text-lime-700">
                        <SpeciesIcon className="size-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{a.name}</CardTitle>
                        <CardDescription className="truncate text-xs">
                          {titleCase(a.species)}
                          {a.breed ? ` · ${a.breed}` : ""} ·{" "}
                          {a.ageMonths < 12
                            ? `${a.ageMonths} mo`
                            : `${Math.floor(a.ageMonths / 12)} yr${a.ageMonths >= 24 ? "s" : ""}`}
                        </CardDescription>
                      </div>
                    </div>
                    <AnimalStatusBadge status={a.status} />
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                    {a.story}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {a.vaccinated && (
                      <Badge
                        variant="outline"
                        className="gap-1 rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700"
                      >
                        <ShieldCheck className="size-3" aria-hidden="true" /> Vaccinated
                      </Badge>
                    )}
                    {a.sterilized && (
                      <Badge
                        variant="outline"
                        className="gap-1 rounded-full border-teal-200 bg-teal-50 text-[10px] text-teal-700"
                      >
                        <Syringe className="size-3" aria-hidden="true" /> Sterilized
                      </Badge>
                    )}
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-bold text-primary">
                          {formatINR(a.monthlyFood)}
                        </span>
                        <span className="text-muted-foreground">/mo food</span>
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" aria-hidden="true" />
                        <span className="truncate">{a.location}</span>
                      </p>
                    </div>
                    <Button
                      className="min-h-11 gap-1.5 sm:min-h-9"
                      onClick={() => openSponsor(a)}
                    >
                      <HeartHandshake className="size-4" aria-hidden="true" />
                      Sponsor
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Separator />

      {/* ---------- My sponsorships ---------- */}
      <section aria-label="My sponsorships">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          My sponsorships
        </h2>
        {loading ? (
          <Skeleton className="h-28 w-full rounded-xl" />
        ) : pledges.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No sponsorships yet. Pick a friend above — even ₹50/mo feeds a tail.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {pledges.map((p) => {
              const KindIcon = KIND_ICONS[p.kind] ?? PawPrint;
              return (
                <Card key={p.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <KindIcon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold">
                          {p.animal?.name ?? "Shelter fund"}
                          {p.animal?.species ? ` · ${titleCase(p.animal.species)}` : ""}
                        </p>
                        <Badge
                          variant="outline"
                          className="rounded-full text-[10px] text-muted-foreground"
                        >
                          {titleCase(p.kind)}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full text-[10px]",
                            p.status === "ACTIVE" &&
                              "border-emerald-200 bg-emerald-50 text-emerald-700",
                            p.status === "COMPLETED" &&
                              "border-teal-200 bg-teal-50 text-teal-700",
                            p.status === "CANCELLED" &&
                              "border-zinc-200 bg-zinc-50 text-zinc-600"
                          )}
                        >
                          {p.status}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatINR(p.amount)} · {titleCase(p.frequency)}
                      </p>
                    </div>
                    {p.status === "ACTIVE" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 sm:min-h-9"
                        onClick={() => setCancelPledge(p)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- Sponsor dialog ---------- */}
      <Dialog
        open={sponsorAnimal !== null}
        onOpenChange={(open) => !open && setSponsorAnimal(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sponsor {sponsorAnimal?.name}</DialogTitle>
            <DialogDescription>
              {sponsorAnimal &&
                `${titleCase(sponsorAnimal.species)} at ${sponsorAnimal.location} · food cost ${formatINR(sponsorAnimal.monthlyFood)}/mo`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sponsor-kind">What are you covering?</Label>
              <Select value={kind} onValueChange={changeKind}>
                <SelectTrigger id="sponsor-kind" className="w-full">
                  <SelectValue placeholder="Select kind" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FOOD">Food</SelectItem>
                  <SelectItem value="MEDICAL">Medical care</SelectItem>
                  <SelectItem value="VACCINATION">Vaccination</SelectItem>
                  <SelectItem value="SHELTER">Shelter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sponsor-amount">Amount (₹)</Label>
                <Input
                  id="sponsor-amount"
                  type="number"
                  min={50}
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sponsor-freq">Frequency</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger id="sponsor-freq" className="w-full">
                    <SelectValue placeholder="Frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                    <SelectItem value="ONE_TIME">One time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
              <p>
                Want to adopt {sponsorAnimal?.name ?? "them"} home? Adoption is
                confirmed via a <strong>shelter follow-up visit</strong> — our team
                marks your interest and contacts you.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setSponsorAnimal(null)}
            >
              Cancel
            </Button>
            <Button
              className="min-h-11"
              onClick={submitSponsor}
              disabled={submitting}
            >
              {submitting ? "Recording…" : "Confirm sponsorship"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Cancel sponsorship dialog ---------- */}
      <Dialog
        open={cancelPledge !== null}
        onOpenChange={(open) => !open && setCancelPledge(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel this sponsorship?</DialogTitle>
            <DialogDescription>
              {cancelPledge &&
                `Your ${cancelPledge.frequency === "MONTHLY" ? "monthly" : "one-time"} ${cancelPledge.kind.toLowerCase()} support of ${formatINR(cancelPledge.amount)} for ${cancelPledge.animal?.name ?? "the shelter"} will stop.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setCancelPledge(null)}
            >
              Keep sponsoring
            </Button>
            <Button
              variant="destructive"
              className="min-h-11"
              onClick={submitCancel}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling…" : "Yes, cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
