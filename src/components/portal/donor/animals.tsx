"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  Bird,
  Cat,
  Dog,
  Home,
  Mail,
  MapPin,
  PawPrint,
  ShieldCheck,
  Syringe,
  Utensils,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, post } from "@/lib/api-client";
import { formatINR, titleCase } from "@/lib/format";
import { StatCard } from "@/components/shared/stat-card";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  TextField,
} from "@/components/shared/form-fields";
import { amountRule, fieldError, required } from "@/lib/validators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { asArray } from "./portal-utils";

interface Animal {
  id: string;
  name: string;
  species: string; // DOG | CAT | COW | BIRD | OTHER
  breed?: string | null;
  ageMonths: number;
  gender: string;
  story: string;
  healthStatus?: string | null;
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

interface SponsorForm {
  amount: string;
  kind: string;
  frequency: string;
}

const KIND_OPTIONS = [
  { value: "FOOD", label: "Food & feed" },
  { value: "MEDICAL", label: "Medical care" },
  { value: "VACCINATION", label: "Vaccination" },
  { value: "SHELTER", label: "Shelter upkeep" },
];

const FREQUENCY_OPTIONS = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "ONE_TIME", label: "One time" },
];

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

export default function DonorAnimals({ user }: { user: SessionUser }) {
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [pledges, setPledges] = useState<AnimalPledge[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);

  // Sponsor FormSheet
  const [sponsorAnimal, setSponsorAnimal] = useState<Animal | null>(null);
  const [form, setForm] = useState<SponsorForm>({ amount: "500", kind: "FOOD", frequency: "MONTHLY" });
  const [errors, setErrors] = useState<Partial<Record<keyof SponsorForm, string | null>>>({});
  const [sponsoring, setSponsoring] = useState(false);

  // Adopt-interest FormSheet
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

  const openSponsor = (a: Animal) => {
    setSponsorAnimal(a);
    setErrors({});
    setForm({
      amount: String(Math.max(1, Math.round(a.monthlyFood || 500))),
      kind: "FOOD",
      frequency: "MONTHLY",
    });
  };

  const submitSponsorship = async () => {
    if (!sponsorAnimal) return;
    const errs = {
      amount: fieldError(form.amount, [
        required("Sponsorship amount"),
        amountRule({ min: 1, max: 1_000_000, label: "Sponsorship amount" }),
      ]),
      kind: fieldError(form.kind, [required("Support kind")]),
      frequency: fieldError(form.frequency, [required("Frequency")]),
    };
    setErrors(errs);
    if (errs.amount || errs.kind || errs.frequency) return;

    setSponsoring(true);
    try {
      await post("/api/animals/pledges", {
        animalId: sponsorAnimal.id,
        kind: form.kind,
        amount: Number(form.amount),
        frequency: form.frequency,
      });
      toast.success(
        `Thank you! You're covering ${sponsorAnimal.name}'s ${form.kind.toLowerCase()} at ${formatINR(Number(form.amount))}${form.frequency === "MONTHLY" ? "/month" : " one time"}.`
      );
      setSponsorAnimal(null);
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

  const browsable = useMemo(() => animals.filter((a) => a.status !== "ADOPTED"), [animals]);
  const myAdoptions = useMemo(() => animals.filter((a) => a.adoptedByName === user.name), [animals, user.name]);
  const activeSponsorships = useMemo(() => pledges.filter((p) => p.status === "ACTIVE"), [pledges]);
  const monthlyTotal = activeSponsorships
    .filter((p) => p.frequency === "MONTHLY")
    .reduce((s, p) => s + (p.amount || 0), 0);

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Animal sponsorship"
        description="Feed, heal and shelter rescued animals at the UAR shelter — sponsor in one tap, or register to adopt."
        icon={<PawPrint className="size-5" />}
      />

      {/* ---------- My sponsorships summary strip ---------- */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Active sponsorships"
          value={loading ? "" : String(activeSponsorships.length)}
          hint="Food, medical, vaccination & shelter"
          icon={<PawPrint className="size-5" />}
          accent="lime"
          loading={loading}
        />
        <StatCard
          label="Monthly commitment"
          value={loading ? "" : `${formatINR(monthlyTotal)}/mo`}
          hint={monthlyTotal > 0 ? "Keeps bowls full at the shelter" : "Sponsor a friend below"}
          icon={<Wallet className="size-5" />}
          accent="emerald"
          loading={loading}
        />
        <StatCard
          label="Shelter friends"
          value={loading ? "" : String(browsable.length)}
          hint="Waiting for a sponsor or home"
          icon={<Home className="size-5" />}
          accent="teal"
          loading={loading}
        />
      </div>

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
              const myMonthly = activeSponsorships
                .filter((p) => p.animal?.name === a.name && p.frequency === "MONTHLY")
                .reduce((s, p) => s + (p.amount || 0), 0);
              const foodPct =
                a.monthlyFood > 0
                  ? Math.min(100, Math.round((myMonthly / a.monthlyFood) * 100))
                  : 0;
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
                    <StatusBadge status={a.status} />
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
                    {myMonthly > 0 && (
                      <Badge
                        variant="outline"
                        className="gap-1 rounded-full border-primary/30 bg-primary/10 text-[10px] text-primary"
                      >
                        <Utensils className="size-3" aria-hidden="true" /> You give {formatINR(myMonthly)}/mo
                      </Badge>
                    )}
                  </div>

                  {/* Sponsorship progress — how much of this friend's monthly
                      food cost your active support already covers */}
                  <div className="mt-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm">
                        <span className="font-bold text-primary">{formatINR(a.monthlyFood)}</span>
                        <span className="text-muted-foreground">/mo food</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {foodPct > 0 ? `${foodPct}% covered by you` : "Not covered yet"}
                      </p>
                    </div>
                    <div
                      role="progressbar"
                      aria-valuenow={foodPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${a.name} monthly food coverage`}
                      className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className="h-full rounded-full bg-lime-500 transition-all"
                        style={{ width: `${foodPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3" aria-hidden="true" />
                      <span className="truncate">{a.location}</span>
                    </p>
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
                        onClick={() => openSponsor(a)}
                        aria-label={`Sponsor ${a.name}`}
                      >
                        <Utensils className="size-4" aria-hidden="true" />
                        Sponsor
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

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
          <SectionCard title="Sponsorships" icon={<PawPrint className="size-5" />}>
            <EmptyState
              icon={<PawPrint className="size-5" />}
              title="No sponsorships yet"
              hint="Pick a friend above — sponsoring a month of meals starts at their monthly food cost."
            />
          </SectionCard>
        ) : (
          <ul className="max-h-96 space-y-0 divide-y overflow-y-auto pr-1 scrollbar-thin">
            {pledges.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Utensils className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold">
                      {p.animal?.name ?? "Shelter fund"}
                      {p.animal?.species ? ` · ${titleCase(p.animal.species)}` : ""}
                    </p>
                    <Badge variant="outline" className="rounded-full text-[10px] text-muted-foreground">
                      {titleCase(p.kind)}
                    </Badge>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatINR(p.amount)} · {titleCase(p.frequency)}
                  </p>
                </div>
              </li>
            ))}
            <li className="flex items-start gap-1.5 py-3 text-xs text-muted-foreground">
              <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              To pause or change a sponsorship, mail the shelter team at
              shelter@unitedangelreach.org — they action requests the same day.
            </li>
          </ul>
        )}
      </section>

      {/* ---------- Sponsor FormSheet ---------- */}
      <FormSheet
        open={sponsorAnimal !== null}
        onOpenChange={(o) => !o && setSponsorAnimal(null)}
        title={sponsorAnimal ? `Sponsor ${sponsorAnimal.name}` : "Sponsor a shelter friend"}
        description={
          sponsorAnimal
            ? `${titleCase(sponsorAnimal.species)} · ${sponsorAnimal.location} · food cost ${formatINR(sponsorAnimal.monthlyFood)}/month`
            : undefined
        }
        submitLabel="Confirm sponsorship"
        loading={sponsoring}
        dirty={Boolean(sponsorAnimal)}
        size="sm"
        onSubmit={submitSponsorship}
        footerExtra={<span className="hidden sm:inline">Managed by the shelter team</span>}
      >
        {sponsorAnimal && (
          <FormSection
            title="Sponsorship details"
            description="Bowls, feed and the occasional birthday egg — every rupee is tracked to the animal."
          >
            <FieldGrid>
              <TextField
                label="Amount"
                required
                prefix="₹"
                inputMode="numeric"
                value={form.amount}
                onChange={(v) => setForm((f) => ({ ...f, amount: v.replace(/[^\d]/g, "") }))}
                error={errors.amount}
                hint={`Full monthly food cost is ${formatINR(sponsorAnimal.monthlyFood)}`}
              />
              <SelectField
                label="Support kind"
                required
                value={form.kind}
                onChange={(v) => setForm((f) => ({ ...f, kind: v }))}
                options={KIND_OPTIONS}
              />
            </FieldGrid>
            <SelectField
              label="Frequency"
              required
              value={form.frequency}
              onChange={(v) => setForm((f) => ({ ...f, frequency: v }))}
              options={FREQUENCY_OPTIONS}
            />
          </FormSection>
        )}
      </FormSheet>

      {/* ---------- Adopt interest FormSheet (confirmation only) ---------- */}
      <FormSheet
        open={adoptAnimal !== null}
        onOpenChange={(o) => !o && setAdoptAnimal(null)}
        title={adoptAnimal ? `Adopt ${adoptAnimal.name}` : "Adopt"}
        description={
          adoptAnimal
            ? `${titleCase(adoptAnimal.species)} · ${ageLabel(adoptAnimal.ageMonths)} · ${adoptAnimal.location}`
            : undefined
        }
        submitLabel="Register interest"
        loading={registering}
        size="sm"
        onSubmit={registerAdoptionInterest}
        footerExtra={<span className="hidden sm:inline">Shelter follow-up visit required</span>}
      >
        {adoptAnimal && (
          <FormSection
            title="How adoption works"
            description="Adoption is confirmed through a shelter follow-up visit — our team checks the home match, shares care notes and completes the handover."
          >
            <p className="text-sm leading-relaxed text-muted-foreground">
              Registering your interest reserves <strong className="text-foreground">{adoptAnimal.name}</strong>{" "}
              while the visit is arranged. Registering uses your account contact —
              no payment is taken at this step.
            </p>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              We&apos;ll use <strong>{user.email}</strong>
              {user.phone ? ` and ${user.phone}` : ""} to reach you within 2 working days.
            </div>
          </FormSection>
        )}
      </FormSheet>
    </div>
  );
}
