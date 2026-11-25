"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  Bird,
  Cat,
  Dog,
  Heart,
  HeartHandshake,
  Home,
  Mail,
  MapPin,
  PawPrint,
  Receipt,
  ShieldCheck,
  Sparkles,
  Syringe,
  TrendingUp,
  Utensils,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, post } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatINR, titleCase } from "@/lib/format";
import { StatCard } from "@/components/shared/stat-card";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormSheet } from "@/components/shared/form-sheet";
import { HowItWorksDialog } from "@/components/shared/how-it-works-dialog";
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
import { Textarea } from "@/components/ui/textarea";
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

interface AnimalReaction {
  id: string;
  animalId: string;
  userName: string;
  emoji: string;
  message?: string | null;
  createdAt: string;
  animal?: { name: string; species: string } | null;
}

interface ReactionCount {
  animalId: string;
  emoji: string;
  _count: { emoji: number };
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

const REACTION_EMOJIS = ["❤️", "🙏", "🎉", "🐾", "✨"];

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

  // Adopt-interest: explainer dialog first, then the FormSheet
  const [howItWorksAnimal, setHowItWorksAnimal] = useState<Animal | null>(null);
  const [adoptAnimal, setAdoptAnimal] = useState<Animal | null>(null);
  const [registering, setRegistering] = useState(false);

  // Sponsor-interest: explain how tracking/consent works before the sponsor FormSheet opens
  const [howSponsorWorksAnimal, setHowSponsorWorksAnimal] = useState<Animal | null>(null);

  // Adopted family wall — reactions & blessings
  const [reactions, setReactions] = useState<AnimalReaction[]>([]);
  const [reactionCounts, setReactionCounts] = useState<ReactionCount[]>([]);
  const [blessingAnimal, setBlessingAnimal] = useState<Animal | null>(null);
  const [blessingEmoji, setBlessingEmoji] = useState("❤️");
  const [blessingMessage, setBlessingMessage] = useState("");
  const [sendingBlessing, setSendingBlessing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, p, c, r] = await Promise.all([
        get<unknown>("/api/animals"),
        get<unknown>("/api/animals/pledges?mine=1"),
        get<unknown>("/api/certificates?limit=50").catch(() => []),
        get<{ reactions: AnimalReaction[]; counts: ReactionCount[] }>("/api/animals/reactions?limit=100").catch(
          () => ({ reactions: [], counts: [] })
        ),
      ]);
      setAnimals(asArray<Animal>(a));
      setPledges(asArray<AnimalPledge>(p));
      setCertificates(asArray<Certificate>(c));
      setReactions(r.reactions ?? []);
      setReactionCounts(r.counts ?? []);
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
  const adoptedFamily = useMemo(() => animals.filter((a) => a.status === "ADOPTED"), [animals]);
  const activeSponsorships = useMemo(() => pledges.filter((p) => p.status === "ACTIVE"), [pledges]);
  const monthlyTotal = activeSponsorships
    .filter((p) => p.frequency === "MONTHLY")
    .reduce((s, p) => s + (p.amount || 0), 0);
  const lifetimeGiven = pledges.reduce((s, p) => s + (p.amount || 0), 0);

  /** Community-wide impact so every donor feels the ripple of their support. */
  const communityImpact = useMemo(() => {
    const monthlyFoodCovered = animals.reduce((s, a) => s + (a.monthlyFood || 0), 0);
    return {
      sponsoredCount: animals.filter((a) => a.status !== "AVAILABLE" || a.monthlyFood > 0).length,
      adoptedCount: adoptedFamily.length,
      mealsPerMonth: Math.round(monthlyFoodCovered / 15) || 0, // ~₹15/meal estimate
      blessingsCount: reactions.length,
    };
  }, [animals, adoptedFamily, reactions]);

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

  const countsFor = useCallback(
    (animalId: string) => reactionCounts.filter((c) => c.animalId === animalId),
    [reactionCounts]
  );
  const messagesFor = useCallback(
    (animalId: string) => reactions.filter((r) => r.animalId === animalId && r.message),
    [reactions]
  );

  const openBlessing = (a: Animal) => {
    setBlessingAnimal(a);
    setBlessingEmoji("❤️");
    setBlessingMessage("");
  };

  const submitBlessing = async () => {
    if (!blessingAnimal) return;
    setSendingBlessing(true);
    try {
      await post("/api/animals/reactions", {
        animalId: blessingAnimal.id,
        emoji: blessingEmoji,
        message: blessingMessage.trim() || undefined,
        userName: user.name,
      });
      toast.success(`Your blessing for ${blessingAnimal.name} was sent 💛`);
      setBlessingAnimal(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send your reaction");
    } finally {
      setSendingBlessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Animal sponsorship"
        description="Feed, heal and shelter rescued animals at the UAR shelter — sponsor in one tap, or register to adopt."
        icon={<PawPrint className="size-5" />}
      />

      {/* ---------- My sponsorships summary strip (your personal tracker) ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          label="Lifetime given"
          value={loading ? "" : formatINR(lifetimeGiven)}
          hint="Tracked across every gift you've made"
          icon={<TrendingUp className="size-5" />}
          accent="amber"
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

      {/* ---------- Community impact (so every donor feels the ripple) ---------- */}
      <SectionCard
        title="Our community's impact"
        description="Every sponsorship, adoption and blessing here is made by people like you."
        icon={<Sparkles className="size-5" />}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-gradient-to-br from-emerald-500/10 to-transparent p-4 text-center">
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
              {loading ? "—" : communityImpact.sponsoredCount}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">animals with active support</p>
          </div>
          <div className="rounded-xl border bg-gradient-to-br from-teal-500/10 to-transparent p-4 text-center">
            <p className="text-2xl font-bold text-teal-700 dark:text-teal-400">
              {loading ? "—" : communityImpact.adoptedCount}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">forever homes found</p>
          </div>
          <div className="rounded-xl border bg-gradient-to-br from-lime-500/10 to-transparent p-4 text-center">
            <p className="text-2xl font-bold text-lime-700 dark:text-lime-500">
              {loading ? "—" : communityImpact.mealsPerMonth.toLocaleString("en-IN")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">meals funded every month</p>
          </div>
          <div className="rounded-xl border bg-gradient-to-br from-rose-500/10 to-transparent p-4 text-center">
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">
              {loading ? "—" : communityImpact.blessingsCount}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">blessings &amp; reactions sent</p>
          </div>
        </div>
      </SectionCard>

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

                  <div className="mt-4 space-y-2">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{a.location}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="min-h-11 flex-1 gap-1.5 sm:min-h-9"
                        onClick={() => setHowItWorksAnimal(a)}
                        aria-label={`Learn how adoption works and register interest for ${a.name}`}
                      >
                        <Home className="size-4 shrink-0" aria-hidden="true" />
                        Adopt
                      </Button>
                      <Button
                        className="min-h-11 flex-1 gap-1.5 sm:min-h-9"
                        onClick={() => setHowSponsorWorksAnimal(a)}
                        aria-label={`Learn how sponsorship works and sponsor ${a.name}`}
                      >
                        <Utensils className="size-4 shrink-0" aria-hidden="true" />
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

      {/* ---------- Adopted family wall — celebrate every forever home, leave a blessing ---------- */}
      <section aria-label="Adopted family wall">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Heart className="size-3.5 text-rose-500" aria-hidden="true" />
          Our adopted family
        </h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : adoptedFamily.length === 0 ? (
          <SectionCard title="Adopted family" icon={<Heart className="size-5" />}>
            <EmptyState
              icon={<Heart className="size-5" />}
              title="No forever homes yet — be the first!"
              hint="Once an animal is adopted, they'll appear here for the whole community to celebrate."
            />
          </SectionCard>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {adoptedFamily.map((a) => {
              const SpeciesIcon = SPECIES_ICONS[a.species] ?? PawPrint;
              const counts = countsFor(a.id);
              const blessings = messagesFor(a.id).slice(0, 2);
              return (
                <div
                  key={a.id}
                  className="flex flex-col rounded-xl border border-rose-500/20 bg-gradient-to-br from-rose-500/5 to-transparent p-4"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400">
                      <SpeciesIcon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{a.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {titleCase(a.species)} · forever home found
                        {a.adoptedByName ? ` · ${a.adoptedByName}` : ""}
                      </p>
                    </div>
                  </div>

                  {blessings.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {blessings.map((r) => (
                        <li key={r.id} className="truncate text-xs text-muted-foreground">
                          <span aria-hidden="true">{r.emoji}</span> &ldquo;{r.message}&rdquo;{" "}
                          <span className="text-muted-foreground/70">— {r.userName}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {counts.map((c) => (
                      <Badge
                        key={c.emoji}
                        variant="outline"
                        className="gap-1 rounded-full text-[11px]"
                      >
                        <span aria-hidden="true">{c.emoji}</span> {c._count.emoji}
                      </Badge>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto min-h-9 gap-1.5"
                      onClick={() => openBlessing(a)}
                      aria-label={`Send a blessing or reaction to ${a.name}`}
                    >
                      <Heart className="size-3.5" aria-hidden="true" />
                      Bless
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- My sponsorships (track your giving) ---------- */}
      <section aria-label="My sponsorships">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            My sponsorships · track your giving
          </h2>
          {pledges.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 text-xs"
              onClick={() => navigate("/donor/receipts")}
            >
              <Receipt className="size-3.5" aria-hidden="true" />
              View receipts
            </Button>
          )}
        </div>
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

      {/* ---------- How sponsorship works (explain → consent → track) ---------- */}
      <HowItWorksDialog
        open={howSponsorWorksAnimal !== null}
        onOpenChange={(o) => !o && setHowSponsorWorksAnimal(null)}
        icon={HeartHandshake}
        title={howSponsorWorksAnimal ? `Sponsoring ${howSponsorWorksAnimal.name}` : "How sponsorship works"}
        description="Every rupee is tracked to this animal, and you can watch the impact grow."
        steps={[
          {
            title: "Choose what you cover",
            detail: "Pick food, medical, vaccination or shelter upkeep, and how much you want to give — monthly or one time.",
          },
          {
            title: "Your gift is tracked to this animal",
            detail: `${howSponsorWorksAnimal?.name ?? "This friend"}'s profile shows exactly how much of their monthly ${formatINR(howSponsorWorksAnimal?.monthlyFood ?? 0)} food cost your support covers — visible to you any time on this page.`,
          },
          {
            title: "Receipts & updates land in your account",
            detail: "Every sponsorship appears under “My sponsorships” below with a receipt, and monthly gifts renew automatically until you pause them.",
          },
          {
            title: "Pause or change anytime",
            detail: "Email shelter@unitedangelreach.org and the team actions pause/cancel requests the same day — no lock-in.",
          },
        ]}
        note="Sponsorship does not transfer ownership — it funds care while the animal stays safe at the shelter. You can track your running impact on this page at any time."
        continueLabel="I understand, continue to sponsor"
        onContinue={() => {
          const a = howSponsorWorksAnimal;
          setHowSponsorWorksAnimal(null);
          if (a) openSponsor(a);
        }}
      />

      {/* ---------- How adoption works (explain → agree → proceed) ---------- */}
      <HowItWorksDialog
        open={howItWorksAnimal !== null}
        onOpenChange={(o) => !o && setHowItWorksAnimal(null)}
        icon={Home}
        title={howItWorksAnimal ? `Adopting ${howItWorksAnimal.name}` : "How adoption works"}
        description="Four simple steps from interest to a forever home."
        steps={[
          {
            title: "Register your interest",
            detail: "Tap continue and confirm — no payment is taken. We reserve this animal for you while your visit is arranged.",
          },
          {
            title: "Shelter follow-up call",
            detail: "Our team calls you within 2 working days to understand your home and family situation.",
          },
          {
            title: "Home-match visit",
            detail: "A shelter volunteer visits (or video-calls) to check the home is safe and ready, and shares care notes.",
          },
          {
            title: "Handover & certificate",
            detail: "Once approved, the animal is handed over and an adoption certificate is issued to your account.",
          },
        ]}
        note="Registering interest does not guarantee adoption — it starts the shelter's verification process."
        continueLabel="I understand, register interest"
        onContinue={() => {
          const a = howItWorksAnimal;
          setHowItWorksAnimal(null);
          if (a) setAdoptAnimal(a);
        }}
      />

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

      {/* ---------- Blessing / reaction FormSheet (for the adopted family wall) ---------- */}
      <FormSheet
        open={blessingAnimal !== null}
        onOpenChange={(o) => !o && setBlessingAnimal(null)}
        title={blessingAnimal ? `Send a blessing to ${blessingAnimal.name}` : "Send a blessing"}
        description="A kind word for the animal and their new family — visible to everyone on the adopted family wall."
        submitLabel="Send blessing"
        loading={sendingBlessing}
        size="sm"
        onSubmit={submitBlessing}
      >
        <FormSection title="Your reaction">
          <div className="flex flex-wrap gap-2">
            {REACTION_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setBlessingEmoji(e)}
                aria-pressed={blessingEmoji === e}
                aria-label={`React with ${e}`}
                className={`flex size-11 items-center justify-center rounded-full border text-xl transition-colors ${
                  blessingEmoji === e ? "border-primary bg-primary/10" : "border-border bg-background"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-1.5">
            <label htmlFor="blessing-message" className="text-sm font-medium">
              Blessing message (optional)
            </label>
            <Textarea
              id="blessing-message"
              value={blessingMessage}
              onChange={(e) => setBlessingMessage(e.target.value.slice(0, 240))}
              placeholder={`May ${blessingAnimal?.name ?? "this friend"} have a long, happy life full of love ❤️`}
              rows={3}
              maxLength={240}
            />
            <p className="text-right text-xs text-muted-foreground">{blessingMessage.length}/240</p>
          </div>
        </FormSection>
      </FormSheet>
    </div>
  );
}
