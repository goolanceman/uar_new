"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  Bird,
  Cat,
  Dog,
  HeartHandshake,
  Home,
  Mail,
  MapPin,
  PawPrint,
  ShieldCheck,
  Syringe,
  Utensils,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, post } from "@/lib/api-client";
import { formatINR, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  adoptedByName?: string | null;
}

interface AnimalPledge {
  id: string;
  kind: string; // FOOD | MEDICAL | VACCINATION | SHELTER
  amount: number;
  frequency: string; // ONE_TIME | MONTHLY
  status: string;
  animal?: { name: string; species: string } | null;
}

interface Certificate {
  id: string;
  code: string;
  type: string;
  title: string;
  meta?: string | null;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  if (data && typeof data === "object" && Array.isArray((data as { certificates?: unknown }).certificates))
    return (data as { certificates: T[] }).certificates;
  return [];
}

const SPECIES_ICONS: Record<string, LucideIcon> = {
  DOG: Dog,
  CAT: Cat,
  BIRD: Bird,
  COW: PawPrint,
  OTHER: PawPrint,
};

function ageLabel(months: number): string {
  if (months < 12) return `${months} mo`;
  const yrs = Math.floor(months / 12);
  return `${yrs} yr${yrs >= 2 ? "s" : ""}`;
}

function AnimalStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        status === "AVAILABLE" &&
          "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-400",
        status === "FOSTERED" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        status === "ADOPTED" &&
          "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
        status === "CRITICAL" &&
          "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
      )}
    >
      {titleCase(status)}
    </Badge>
  );
}

export default function DonorAnimals({ user }: { user: SessionUser }) {
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [pledges, setPledges] = useState<AnimalPledge[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);

  // Sponsor-food dialog
  const [foodAnimal, setFoodAnimal] = useState<Animal | null>(null);
  const [sponsoring, setSponsoring] = useState(false);

  // Adopt-interest dialog
  const [adoptAnimal, setAdoptAnimal] = useState<Animal | null>(null);
  const [registering, setRegistering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, p, c] = await Promise.all([
        get<unknown>("/api/animals"),
        get<unknown>("/api/animals/pledges?mine=1"),
        get<unknown>("/api/certificates?limit=50").catch(() => []),
      ]);
      setAnimals(asArray<Animal>(a));
      setPledges(asArray<AnimalPledge>(p));
      setCertificates(asArray<Certificate>(c));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load animals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submitFoodSponsorship = async () => {
    if (!foodAnimal) return;
    setSponsoring(true);
    try {
      await post("/api/animals/pledges", {
        animalId: foodAnimal.id,
        kind: "FOOD",
        amount: Math.max(1, Math.round(foodAnimal.monthlyFood || 500)),
        frequency: "MONTHLY",
      });
      toast.success(
        `Thank you! You're covering ${foodAnimal.name}'s food at ${formatINR(foodAnimal.monthlyFood)}/month.`
      );
      setFoodAnimal(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record sponsorship");
    } finally {
      setSponsoring(false);
    }
  };

  const registerAdoptionInterest = async () => {
    if (!adoptAnimal) return;
    setRegistering(true);
    try {
      await post("/api/contact-queries", {
        name: user.name,
        email: user.email,
        phone: user.phone || undefined,
        subject: `Adoption interest — ${adoptAnimal.name} (${titleCase(adoptAnimal.species)})`,
        message: `I would like to adopt ${adoptAnimal.name}, the ${titleCase(adoptAnimal.species)} at ${adoptAnimal.location}. Please arrange the shelter follow-up visit. — ${user.name}`,
      });
      toast.success(
        `Interest registered for ${adoptAnimal.name}! Our shelter team will call you to arrange the follow-up visit.`
      );
      setAdoptAnimal(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not register interest");
    } finally {
      setRegistering(false);
    }
  };

  const openCertificate = (code: string) => {
    window.open(`/api/certificates/${encodeURIComponent(code)}/html`, "_blank", "noopener");
  };

  const browsable = animals.filter((a) => a.status !== "ADOPTED");
  const myAdoptions = animals.filter((a) => a.adoptedByName === user.name);

  /** Certificate matching an adopted animal by name mention in title/meta. */
  const certForAnimal = useCallback(
    (animalName: string) =>
      certificates.find(
        (c) =>
          c.type === "ANIMAL_ADOPTION" &&
          `${c.title} ${c.meta ?? ""}`.toLowerCase().includes(animalName.toLowerCase())
      ) ?? null,
    [certificates]
  );

  const activeSponsorships = useMemo(
    () => pledges.filter((p) => p.status === "ACTIVE"),
    [pledges]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Animal sponsorship"
        description="Feed, heal and shelter rescued animals at the UAR shelter — sponsor food in one tap, or register to adopt."
        icon={<PawPrint className="size-5" />}
      />

      {/* ---------- Meet the animals ---------- */}
      <section aria-label="Meet the animals">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Meet the animals
        </h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-60 rounded-xl" />
            ))}
          </div>
        ) : browsable.length === 0 ? (
          <SectionCard title="Shelter roster" icon={<PawPrint className="size-5" />}>
            <EmptyState
              icon={<PawPrint className="size-5" />}
              title="The shelter roster is being updated"
              hint="New rescues are added after their health checks — check back soon."
            />
          </SectionCard>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {browsable.map((a) => {
              const SpeciesIcon = SPECIES_ICONS[a.species] ?? PawPrint;
              const sponsoredKinds = activeSponsorships
                .filter((p) => p.animal?.name === a.name)
                .map((p) => p.kind);
              return (
                <div key={a.id} className="flex flex-col rounded-xl border bg-card p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lime-500/15 text-lime-700 dark:text-lime-400">
                        <SpeciesIcon className="size-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold">{a.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {titleCase(a.species)}
                          {a.breed ? ` · ${a.breed}` : ""} · {ageLabel(a.ageMonths)}
                        </p>
                      </div>
                    </div>
                    <AnimalStatusBadge status={a.status} />
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{a.story}</p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {a.vaccinated && (
                      <Badge
                        variant="outline"
                        className="gap-1 rounded-full border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400"
                      >
                        <ShieldCheck className="size-3" aria-hidden="true" /> Vaccinated
                      </Badge>
                    )}
                    {a.sterilized && (
                      <Badge
                        variant="outline"
                        className="gap-1 rounded-full border-teal-500/30 bg-teal-500/10 text-[10px] text-teal-700 dark:text-teal-400"
                      >
                        <Syringe className="size-3" aria-hidden="true" /> Sterilized
                      </Badge>
                    )}
                    {sponsoredKinds.includes("FOOD") && (
                      <Badge
                        variant="outline"
                        className="gap-1 rounded-full border-primary/30 bg-primary/10 text-[10px] text-primary"
                      >
                        <Utensils className="size-3" aria-hidden="true" /> You feed {a.name}
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-bold text-primary">{formatINR(a.monthlyFood)}</span>
                        <span className="text-muted-foreground">/mo food</span>
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" aria-hidden="true" />
                        <span className="truncate">{a.location}</span>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="min-h-11 gap-1.5 sm:min-h-9"
                        onClick={() => setAdoptAnimal(a)}
                        aria-label={`Register adoption interest for ${a.name}`}
                      >
                        <Home className="size-4" aria-hidden="true" />
                        Adopt
                      </Button>
                      <Button
                        className="min-h-11 gap-1.5 sm:min-h-9"
                        onClick={() => setFoodAnimal(a)}
                        aria-label={`Sponsor food for ${a.name}`}
                      >
                        <Utensils className="size-4" aria-hidden="true" />
                        Sponsor food
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Separator />

      {/* ---------- Adoption confirmations ---------- */}
      {myAdoptions.length > 0 && (
        <section aria-label="My adoptions">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            My adoptions
          </h2>
          <div className="grid gap-3">
            {myAdoptions.map((a) => {
              const cert = certForAnimal(a.name);
              return (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-teal-500/30 bg-teal-500/10 p-4"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-400">
                    <Award className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">
                      {a.name} is officially adopted by you
                    </p>
                    <p className="text-xs text-teal-800/80 dark:text-teal-300/80">
                      {titleCase(a.species)} · {a.location}
                    </p>
                  </div>
                  {cert ? (
                    <Button
                      size="sm"
                      className="min-h-11 gap-1.5 sm:min-h-9"
                      onClick={() => openCertificate(cert.code)}
                      aria-label={`Open adoption certificate for ${a.name}`}
                    >
                      <Award className="size-4" aria-hidden="true" />
                      Adoption certificate
                    </Button>
                  ) : (
                    <p className="text-xs text-teal-900/80 dark:text-teal-200/80">
                      Adoption certificate will appear here once issued by the team.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------- My sponsorships ---------- */}
      <section aria-label="My sponsorships">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          My sponsorships
        </h2>
        {loading ? (
          <Skeleton className="h-28 w-full rounded-xl" />
        ) : pledges.length === 0 ? (
          <SectionCard title="Sponsorships" icon={<HeartHandshake className="size-5" />}>
            <EmptyState
              icon={<PawPrint className="size-5" />}
              title="No sponsorships yet"
              hint="Pick a friend above — sponsoring a month of meals starts at their monthly food cost."
            />
          </SectionCard>
        ) : (
          <div className="grid gap-3">
            {pledges.map((p) => {
              const KindIcon =
                p.kind === "FOOD"
                  ? Utensils
                  : p.kind === "MEDICAL"
                    ? HeartHandshake
                    : p.kind === "VACCINATION"
                      ? Syringe
                      : Home;
              return (
                <div key={p.id} className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
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
                              "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                            p.status === "COMPLETED" &&
                              "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
                            p.status === "CANCELLED" &&
                              "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
                          )}
                        >
                          {titleCase(p.status)}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatINR(p.amount)} · {titleCase(p.frequency)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              To pause or change a sponsorship, mail the shelter team at
              shelter@unitedangelreach.org — they action requests the same day.
            </p>
          </div>
        )}
      </section>

      {/* ---------- Sponsor food dialog ---------- */}
      <Dialog
        open={foodAnimal !== null}
        onOpenChange={(openDlg) => !openDlg && setFoodAnimal(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sponsor {foodAnimal?.name}&apos;s food</DialogTitle>
            <DialogDescription>
              {foodAnimal &&
                `${titleCase(foodAnimal.species)} at ${foodAnimal.location} · ${formatINR(foodAnimal.monthlyFood)}/month food cost`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Your monthly sponsorship of{" "}
              <span className="font-semibold text-foreground">
                {formatINR(foodAnimal?.monthlyFood ?? 0)}
              </span>{" "}
              covers this friend&apos;s meals for a month — bowls, feed and the
              occasional birthday egg.
            </p>
            <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
              Frequency: <strong className="text-foreground">MONTHLY</strong> · Kind:{" "}
              <strong className="text-foreground">FOOD</strong> — managed by the
              shelter team; you&apos;ll see it under &quot;My sponsorships&quot;.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setFoodAnimal(null)}
            >
              Cancel
            </Button>
            <Button
              className="min-h-11"
              onClick={submitFoodSponsorship}
              disabled={sponsoring}
            >
              {sponsoring ? "Recording…" : "Confirm monthly food"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Adopt interest dialog ---------- */}
      <Dialog
        open={adoptAnimal !== null}
        onOpenChange={(openDlg) => !openDlg && setAdoptAnimal(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Adopt {adoptAnimal?.name}</DialogTitle>
            <DialogDescription>
              {adoptAnimal &&
                `${titleCase(adoptAnimal.species)} · ${ageLabel(adoptAnimal.ageMonths)} · ${adoptAnimal.location}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Adoption is confirmed through a <strong>shelter follow-up visit</strong>{" "}
              — our team checks the home match, shares care notes and completes the
              handover. Registering your interest reserves {adoptAnimal?.name} while
              the visit is arranged.
            </p>
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              We&apos;ll use <strong>{user.email}</strong>
              {user.phone ? ` and ${user.phone}` : ""} to reach you within 2 working
              days.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setAdoptAnimal(null)}
            >
              Not now
            </Button>
            <Button
              className="min-h-11"
              onClick={registerAdoptionInterest}
              disabled={registering}
            >
              {registering ? "Registering…" : "Register interest"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
