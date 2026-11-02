"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { get, post } from "@/lib/api-client";
import { cn, formatINR, formatNumber, titleCase } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
  Section,
  Stat,
  StepFlow,
  ChartBox,
  EmptyState,
  CheckItem,
  CampaignIcon,
  accentClasses,
  askAngel,
} from "@/components/public/shared";
import { LiveCorridorDemo } from "@/components/public/green-corridor";
import { CAMPAIGN_CONTENT } from "@/components/public/campaign-data";
import {
  Ban,
  BookOpenCheck,
  Check,
  CheckCircle2,
  Dog,
  ExternalLink,
  Heart,
  HeartPulse,
  Link2,
  Phone,
  Sparkles,
  Syringe,
  X,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Live data types                                                     */
/* ------------------------------------------------------------------ */

interface LiveCampaign {
  id: string;
  title: string;
  slug?: string | null;
  tagline?: string | null;
  description?: string | null;
  targetAmount: number;
  raisedAmount: number;
  beneficiaries: number;
  volunteersEngaged: number;
  helpline?: string | null;
  icon?: string | null;
  accent?: string | null;
  status?: string | null;
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
}

/* ------------------------------------------------------------------ */
/* Status badge colours                                                */
/* ------------------------------------------------------------------ */

const CAUSE_STATUS: Record<string, string> = {
  SEEKING: "bg-amber-100 text-amber-700",
  PARTIAL: "bg-orange-100 text-orange-700",
  ADOPTED: "bg-emerald-100 text-emerald-700",
  PAUSED: "bg-zinc-100 text-zinc-600",
};

const ANIMAL_STATUS: Record<string, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-700",
  FOSTERED: "bg-amber-100 text-amber-700",
  ADOPTED: "bg-zinc-100 text-zinc-600",
  CRITICAL: "bg-red-100 text-red-700",
};

const SPECIES_BADGE: Record<string, string> = {
  DOG: "bg-lime-100 text-lime-700",
  CAT: "bg-amber-100 text-amber-700",
  COW: "bg-orange-100 text-orange-700",
  BIRD: "bg-cyan-100 text-cyan-700",
  OTHER: "bg-zinc-100 text-zinc-600",
};

/* ================================================================== */
/* Main page                                                          */
/* ================================================================== */

export function CampaignDetailPage({ slug }: { slug: string }) {
  const content = CAMPAIGN_CONTENT[slug];
  const [live, setLive] = useState<LiveCampaign | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    get<LiveCampaign[]>("/api/campaigns")
      .then((d) => {
        if (!alive) return;
        const list = Array.isArray(d) ? d : [];
        setLive(list.find((c) => c.slug === slug) ?? null);
      })
      .catch(() => alive && setLive(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [slug]);

  if (!content) {
    return (
      <Section>
        <EmptyState
          icon={BookOpenCheck}
          title="Programme not found"
          hint={`We couldn't find “${slug}”. It may have been renamed — browse all programmes instead.`}
          action={
            <Button asChild>
              <Link href="/campaigns">Browse programmes</Link>
            </Button>
          }
        />
      </Section>
    );
  }

  const a = accentClasses(content.accent);
  const accent = content.accent;
  const pct =
    live && live.targetAmount > 0
      ? Math.min(100, Math.round((live.raisedAmount / live.targetAmount) * 100))
      : 0;

  return (
    <>
      {/* ================= HERO ================= */}
      <section className={cn("text-white", a.bg600)}>
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-4">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
                  <CampaignIcon icon={content.icon} className="size-8" />
                </span>
                <div>
                  <h1 className="text-2xl font-extrabold tracking-tight sm:text-4xl">
                    {content.title}
                  </h1>
                  <p className="mt-1 text-sm font-medium text-white/85 sm:text-base">
                    {content.heroTag}
                  </p>
                </div>
              </div>

              {/* Helpline pill */}
              {content.helpline && (
                <a
                  href={`tel:${content.helpline}`}
                  className="mt-6 inline-flex min-h-[44px] items-center gap-2.5 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold ring-1 ring-white/25 transition hover:bg-white/25"
                >
                  <Phone className="size-4" aria-hidden />
                  24×7 helpline: {content.helpline}
                </a>
              )}

              {/* CTAs */}
              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  size="lg"
                  className="border-0 bg-white text-zinc-900 hover:bg-white/90"
                  asChild
                >
                  <Link href={`/donate?campaign=${content.slug}`}>
                    <Heart className="size-5" aria-hidden /> Donate
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white bg-transparent text-white hover:bg-white/10"
                  asChild
                >
                  <Link href="/volunteer">Volunteer</Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white bg-transparent text-white hover:bg-white/10"
                  onClick={askAngel}
                >
                  <Sparkles className="size-5" aria-hidden /> Ask Angel
                </Button>
              </div>
            </div>

            {/* Live progress card */}
            <Card className="w-full max-w-sm shrink-0 p-5 text-foreground">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-2 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : live ? (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Live campaign numbers
                  </p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{formatINR(live.raisedAmount)}</span>
                    <span className="text-sm text-muted-foreground">
                      raised of {formatINR(live.targetAmount)}
                    </span>
                  </div>
                  <Progress value={pct} className="mt-2 h-2" aria-label={`${pct}% raised`} />
                  <p className="mt-1 text-xs text-muted-foreground">{pct}% funded</p>
                  <Separator className="my-4" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-lg font-bold">{formatNumber(live.beneficiaries)}</p>
                      <p className="text-xs text-muted-foreground">Beneficiaries</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{formatNumber(live.volunteersEngaged)}</p>
                      <p className="text-xs text-muted-foreground">Volunteers engaged</p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Live numbers are syncing. The editorial content below is always current.
                </p>
              )}
            </Card>
          </div>
        </div>
      </section>

      {/* ================= OVERVIEW ================= */}
      <Section title="Understanding the problem">
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="space-y-4">
            {content.overview.map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                {p}
              </p>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 self-start">
            {content.keyFacts.map((f, i) => (
              <Card
                key={i}
                className={cn("col-span-1 p-4", i === 0 && "col-span-2")}
              >
                <p className={cn("text-2xl font-extrabold tracking-tight", a.text700)}>
                  {f.value}
                  <span className="text-sm font-bold">{f.suffix}</span>
                </p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{f.label}</p>
              </Card>
            ))}
          </div>
        </div>
      </Section>

      {/* ================= CHARTS ================= */}
      <Section
        title="The data"
        subtitle="Real India-context datasets behind this programme."
        className="bg-muted/40"
      >
        <div className={cn("grid gap-4", content.charts.length > 1 && "lg:grid-cols-2")}>
          {content.charts.map((ch, i) => (
            <ChartBox
              key={i}
              title={ch.title}
              desc={ch.desc}
              type={ch.type}
              data={ch.data}
              xKey={ch.xKey}
              nameKey={ch.nameKey}
              valueKey={ch.valueKey}
              colors={ch.colors}
            />
          ))}
        </div>
      </Section>

      {/* ================= SPECIAL EMBEDS ================= */}
      {slug === "medicine-adoption" && <MedicineAdoptionEmbed />}
      {slug === "animal-welfare" && <AnimalWelfareEmbed />}
      {slug === "green-corridor" && (
        <Section
          title="Live corridor demo"
          subtitle="Run a simulated Hebbal → Tin Factory mission. Watch the four-layer mesh clear the road in real time."
        >
          <LiveCorridorDemo />
        </Section>
      )}

      {/* ================= WHY IT MATTERS ================= */}
      <Section title="Why this matters">
        <div className="grid gap-3 sm:grid-cols-2">
          {content.whyItMatters.map((w, i) => (
            <Card key={i} className="flex gap-3 p-4">
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                  a.bg100,
                  a.text700
                )}
              >
                <Check className="size-4" aria-hidden />
              </span>
              <p className="text-sm leading-relaxed text-muted-foreground">{w}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* ================= PLAYBOOK ================= */}
      <Section
        title="The playbook"
        subtitle="What actually works — step by step, exactly as our field volunteers teach it."
        className="bg-muted/40"
      >
        <div className="mx-auto max-w-3xl">
          <StepFlow steps={content.playbook} accent={accent} />
        </div>
      </Section>

      {/* ================= DOS & DON'TS ================= */}
      <Section title="Do this, not that">
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-emerald-200 bg-emerald-50/60 p-5">
            <h3 className="flex items-center gap-2 font-semibold text-emerald-800">
              <CheckCircle2 className="size-5 text-emerald-600" aria-hidden /> Do
            </h3>
            <ul className="mt-4 space-y-3">
              {content.dosDonts.dos.map((d, i) => (
                <li key={i}>
                  <CheckItem done={false}>{d}</CheckItem>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="border-red-200 bg-red-50/60 p-5">
            <h3 className="flex items-center gap-2 font-semibold text-red-800">
              <Ban className="size-5 text-red-600" aria-hidden /> Don&rsquo;t
            </h3>
            <ul className="mt-4 space-y-3">
              {content.dosDonts.donts.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                  <X className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      {/* ================= MYTHS vs FACTS ================= */}
      <Section title="Myths vs facts" className="bg-muted/40">
        <Accordion type="single" collapsible className="mx-auto max-w-3xl">
          {content.mythsFacts.map((m, i) => (
            <AccordionItem key={i} value={`myth-${i}`}>
              <AccordionTrigger className="text-left text-sm sm:text-base">
                <span className="flex items-start gap-2">
                  <Badge className="mt-0.5 shrink-0 border-0 bg-red-100 text-[10px] uppercase text-red-700 hover:bg-red-100">
                    Myth
                  </Badge>
                  {m.myth}
                </span>
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                <span className="flex items-start gap-2">
                  <Badge className="mt-0.5 shrink-0 border-0 bg-emerald-100 text-[10px] uppercase text-emerald-700 hover:bg-emerald-100">
                    Fact
                  </Badge>
                  {m.fact}
                </span>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Section>

      {/* ================= TOOLKIT ================= */}
      <ToolkitSection accent={accent} toolkit={content.toolkit} />

      {/* ================= FAQS ================= */}
      <Section title="Frequently asked questions" className="bg-muted/40">
        <Accordion type="single" collapsible className="mx-auto max-w-3xl">
          {content.faqs.map((f, i) => (
            <AccordionItem key={i} value={`faq-${i}`}>
              <AccordionTrigger className="text-left text-sm sm:text-base">{f.q}</AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Section>

      {/* ================= LINKS BAND ================= */}
      <Section>
        <Card className={cn("flex flex-col gap-4 border p-6 sm:flex-row sm:items-center sm:justify-between", a.border200, a.bg50)}>
          <div>
            <h3 className="flex items-center gap-2 font-semibold">
              <Link2 className={cn("size-5", a.text700)} aria-hidden /> Official links & further reading
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Verified government and institutional resources for this programme.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {content.links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border bg-white px-3.5 py-2 text-xs font-semibold transition hover:shadow-sm",
                  a.border200,
                  a.text700
                )}
              >
                {l.label}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ))}
          </div>
        </Card>
      </Section>
    </>
  );
}

/* ================================================================== */
/* Toolkit — interactive checklists with progress                      */
/* ================================================================== */

function ToolkitSection({
  accent,
  toolkit,
}: {
  accent: string;
  toolkit: { title: string; items: string[] }[];
}) {
  const a = accentClasses(accent);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const total = toolkit.reduce((n, g) => n + g.items.length, 0);
  const done = checked.size;

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Section
      title="Your toolkit"
      subtitle="Tick items off as you secure your home, family or workplace. Progress is saved as you go."
    >
      <div className="mb-5 flex items-center gap-3">
        <Progress
          value={total ? (done / total) * 100 : 0}
          className="h-2.5 max-w-xs"
          aria-label={`${done} of ${total} checklist items done`}
        />
        <span className="text-sm font-semibold text-muted-foreground">
          {done}/{total}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {toolkit.map((g, gi) => {
          const groupDone = g.items.filter((_, ii) => checked.has(`${gi}-${ii}`)).length;
          return (
            <Card key={gi} className="flex flex-col p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold leading-snug">{g.title}</h3>
                <Badge variant="outline" className={cn("shrink-0", a.border200, a.text700)}>
                  {groupDone}/{g.items.length}
                </Badge>
              </div>
              <ul className="mt-4 space-y-3">
                {g.items.map((item, ii) => {
                  const key = `${gi}-${ii}`;
                  return (
                    <li key={key}>
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <Checkbox
                          checked={checked.has(key)}
                          onCheckedChange={() => toggle(key)}
                          className="mt-0.5"
                          aria-label={item}
                        />
                        <span
                          className={cn(
                            "text-sm leading-relaxed",
                            checked.has(key) && "text-muted-foreground line-through"
                          )}
                        >
                          {item}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

/* ================================================================== */
/* Special embed: medicine-adoption → /api/causes                      */
/* ================================================================== */

function MedicineAdoptionEmbed() {
  const [causes, setCauses] = useState<Cause[] | null>(null);
  const [adopting, setAdopting] = useState<Cause | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await get<Cause[]>("/api/causes");
      setCauses(Array.isArray(d) ? d : []);
    } catch {
      setCauses([]);
    }
  }, []);

   
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <Section
      title="Patients waiting for adoption"
      subtitle="Pharmacist-verified prescriptions, Jan Aushadhi pricing, QR'd doorstep delivery. Adopt fully or share a pledge."
    >
      {causes === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : causes.length === 0 ? (
        <EmptyState
          icon={HeartPulse}
          title="No open causes right now"
          hint="Every listed patient has been adopted. New verified causes appear within a week — or donate to the general medicine fund."
          action={
            <Button asChild className="bg-teal-600 hover:bg-teal-700">
              <Link href="/donate?campaign=medicine-adoption">Fund medicines generally</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {causes.map((cause) => {
            const needed = cause.monthlyCost * cause.durationMonths;
            const pct = needed > 0 ? Math.min(100, Math.round((cause.raised / needed) * 100)) : 0;
            return (
              <Card key={cause.id} className="flex flex-col p-5">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {cause.code}
                  </Badge>
                  <Badge
                    className={cn(
                      "border-0 text-[10px] hover:opacity-90",
                      CAUSE_STATUS[cause.status] ?? "bg-zinc-100 text-zinc-600"
                    )}
                  >
                    {titleCase(cause.status)}
                  </Badge>
                </div>
                <h3 className="mt-3 font-semibold">{cause.patientName}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {cause.age} yrs · {titleCase(cause.condition)} · {cause.city}
                </p>
                <p className="mt-2 line-clamp-3 flex-1 text-sm text-muted-foreground">
                  {cause.story}
                </p>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-xl font-bold text-teal-700">
                    {formatINR(cause.monthlyCost)}
                  </span>
                  <span className="text-xs text-muted-foreground">/ month</span>
                </div>
                <Progress value={pct} className="mt-2 h-2" aria-label={`${pct}% raised`} />
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatINR(cause.raised)} raised of {formatINR(needed)} ({pct}%)
                </p>
                <Button
                  className="mt-4 bg-teal-600 text-white hover:bg-teal-700"
                  onClick={() => setAdopting(cause)}
                  disabled={cause.status === "ADOPTED" || cause.status === "PAUSED"}
                >
                  <Heart className="size-4" aria-hidden /> Adopt
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <AdoptDialog cause={adopting} onClose={() => setAdopting(null)} onDone={load} />
    </Section>
  );
}

function AdoptDialog({
  cause,
  onClose,
  onDone,
}: {
  cause: Cause | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [months, setMonths] = useState("6");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cause) {
      setAmount(String(Math.round(cause.monthlyCost)));
      setMonths("6");
      setName("");
      setBusy(false);
    }
  }, [cause]);

  const submit = async () => {
    if (!cause) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("Enter a valid monthly amount");
      return;
    }
    if (!name.trim()) {
      toast.error("Please enter your name");
      return;
    }
    setBusy(true);
    try {
      await post(`/api/causes/${cause.id}/pledges`, {
        amountPerMonth: amt,
        months: Number(months) || 6,
        donorName: name.trim(),
      });
      toast.success(
        `Adoption pledged for ${cause.patientName} — our team will call you within 48 hours.`
      );
      onClose();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create pledge");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!cause} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {cause && (
          <>
            <DialogHeader>
              <DialogTitle>
                Adopt {cause.patientName}&rsquo;s medicines
              </DialogTitle>
              <DialogDescription>
                {cause.code} · {titleCase(cause.condition)} · {cause.city} · needs{" "}
                {formatINR(cause.monthlyCost)}/mo for {cause.durationMonths} months
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="pledge-amount">Amount per month (₹)</Label>
                <Input
                  id="pledge-amount"
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Full cost is {formatINR(cause.monthlyCost)} — partial adoptions are welcome.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Commitment</Label>
                <Select value={months} onValueChange={setMonths}>
                  <SelectTrigger aria-label="Months">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3 months</SelectItem>
                    <SelectItem value="6">6 months</SelectItem>
                    <SelectItem value="12">12 months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pledge-name">Your name</Label>
                <Input
                  id="pledge-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="As you'd like to be known"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy} className="bg-teal-600 hover:bg-teal-700">
                {busy ? "Pledging…" : "Confirm adoption"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/* Special embed: animal-welfare → /api/animals                        */
/* ================================================================== */

function AnimalWelfareEmbed() {
  const [animals, setAnimals] = useState<Animal[] | null>(null);
  const [sponsoring, setSponsoring] = useState<Animal | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await get<Animal[]>("/api/animals");
      setAnimals(Array.isArray(d) ? d : []);
    } catch {
      setAnimals([]);
    }
  }, []);

   
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const ageLabel = (m: number) => {
    const y = Math.floor(m / 12);
    const rest = m % 12;
    if (y <= 0) return `${rest} mo`;
    return rest ? `${y}y ${rest}m` : `${y} yrs`;
  };

  const speciesIcon = (species: string) => {
    if (species === "DOG") return <Dog className="size-4" aria-hidden />;
    return <PawGlyph className="size-4" />;
  };

  return (
    <Section
      title="Animals ready for sponsorship & adoption"
      subtitle="Vaccinated, sterilised, and fed by trained volunteers. Sponsor food monthly or open your home."
    >
      {animals === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : animals.length === 0 ? (
        <EmptyState
          icon={Dog}
          title="No animals listed right now"
          hint="Our rescue partners are updating the board. Sponsor the general food fund meanwhile."
          action={
            <Button asChild className="bg-lime-600 hover:bg-lime-700">
              <Link href="/donate?campaign=animal-welfare">Fund animal food</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {animals.map((an) => (
            <Card key={an.id} className="flex flex-col p-5">
              <div className="flex items-center justify-between gap-2">
                <Badge className={cn("border-0 text-xs capitalize hover:opacity-90", SPECIES_BADGE[an.species] ?? "bg-zinc-100 text-zinc-600")}>
                  {speciesIcon(an.species)}
                  <span className="ml-1">{titleCase(an.species)}</span>
                </Badge>
                <Badge
                  className={cn(
                    "border-0 text-[10px] hover:opacity-90",
                    ANIMAL_STATUS[an.status] ?? "bg-zinc-100 text-zinc-600"
                  )}
                >
                  {titleCase(an.status)}
                </Badge>
              </div>
              <h3 className="mt-3 font-semibold">{an.name}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {ageLabel(an.ageMonths)} · {titleCase(an.gender)}
                {an.breed ? ` · ${an.breed}` : ""} · {an.location}
              </p>
              <p className="mt-2 line-clamp-3 flex-1 text-sm text-muted-foreground">{an.story}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1 text-[10px]",
                    an.vaccinated ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "text-muted-foreground"
                  )}
                >
                  <Syringe className="size-3" aria-hidden />
                  {an.vaccinated ? "Vaccinated" : "Vaccination due"}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1 text-[10px]",
                    an.sterilized ? "border-teal-200 bg-teal-50 text-teal-700" : "text-muted-foreground"
                  )}
                >
                  <Check className="size-3" aria-hidden />
                  {an.sterilized ? "Sterilised" : "Sterilisation pending"}
                </Badge>
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-lg font-bold text-lime-700">{formatINR(an.monthlyFood)}</span>
                <span className="text-xs text-muted-foreground">/ month of food</span>
              </div>
              <Button
                className="mt-4 bg-lime-600 text-white hover:bg-lime-700"
                onClick={() => setSponsoring(an)}
                disabled={an.status === "ADOPTED"}
              >
                <Heart className="size-4" aria-hidden /> Sponsor food
              </Button>
            </Card>
          ))}
        </div>
      )}

      <SponsorDialog animal={sponsoring} onClose={() => setSponsoring(null)} onDone={load} />
    </Section>
  );
}

function PawGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <ellipse cx="6" cy="9" rx="2" ry="2.6" />
      <ellipse cx="18" cy="9" rx="2" ry="2.6" />
      <ellipse cx="10" cy="5.5" rx="2" ry="2.6" />
      <ellipse cx="14" cy="5.5" rx="2" ry="2.6" />
      <path d="M12 11c-3.5 0-6.5 3.2-6.5 6 0 1.8 1.4 3 3.2 3 1.2 0 2.1-.5 3.3-.5s2.1.5 3.3.5c1.8 0 3.2-1.2 3.2-3 0-2.8-3-6-6.5-6z" />
    </svg>
  );
}

function SponsorDialog({
  animal,
  onClose,
  onDone,
}: {
  animal: Animal | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (animal) {
      setName("");
      setBusy(false);
    }
  }, [animal]);

  const submit = async () => {
    if (!animal) return;
    if (!name.trim()) {
      toast.error("Please enter your name");
      return;
    }
    setBusy(true);
    try {
      await post("/api/animals/pledges", {
        animalId: animal.id,
        kind: "FOOD",
        amount: animal.monthlyFood,
        frequency: "MONTHLY",
        donorName: name.trim(),
      });
      toast.success(`Thank you — ${animal.name}'s food is sponsored this month.`);
      onClose();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create sponsorship");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!animal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {animal && (
          <>
            <DialogHeader>
              <DialogTitle>Sponsor food for {animal.name}</DialogTitle>
              <DialogDescription>
                {formatINR(animal.monthlyFood)}/month · {titleCase(animal.species)} ·{" "}
                {animal.location}. Volunteers buy from verified suppliers and log every feeding.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-2">
              <Label htmlFor="sponsor-name">Your name</Label>
              <Input
                id="sponsor-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="As you'd like to be known"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy} className="bg-lime-600 hover:bg-lime-700">
                {busy ? "Sponsoring…" : "Confirm sponsorship"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
