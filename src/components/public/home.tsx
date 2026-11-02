"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { get } from "@/lib/api-client";
import { cn, formatINR, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Section,
  Stat,
  StepFlow,
  HelplineCard,
  EmptyState,
  CampaignIcon,
  accentClasses,
  askAngel,
  pickStats,
} from "@/components/public/shared";
import { CAMPAIGN_CONTENT } from "@/components/public/campaign-data";
import {
  ArrowRight,
  CalendarDays,
  HandHeart,
  Heart,
  MapPinned,
  Megaphone,
  SearchX,
  Sparkles,
  Star,
  Users,
} from "lucide-react";

interface LiveCampaign {
  id: string;
  title: string;
  slug?: string | null;
  tagline?: string | null;
  description?: string | null;
  category?: string | null;
  targetAmount: number;
  raisedAmount: number;
  beneficiaries: number;
  volunteersEngaged: number;
  icon?: string | null;
  accent?: string | null;
  featured?: boolean;
  status?: string | null;
}

interface Testimonial {
  id?: string;
  name: string;
  role: string;
  message: string;
  rating?: number;
}

const SAFETY_SPOTLIGHT = [
  {
    slug: "anti-drug",
    number: "14446",
    blurb: "Free, confidential de-addiction help — recovery starts with one call.",
  },
  {
    slug: "cyber-crime",
    number: "1930",
    blurb: "Money stolen online can be frozen in the golden hour. Call fast.",
  },
  {
    slug: "women-safety",
    number: "181",
    blurb: "Sakhi One-Stop Centres: medical, legal, shelter — under one roof.",
  },
  {
    slug: "child-safety",
    number: "1098",
    blurb: "CHILDLINE: every adult is a mandated protector under POCSO.",
  },
];

const CORE_HELPLINES = [
  { name: "Police & Fire", number: "112", desc: "Any emergency, 24×7", accent: "red" },
  { name: "Ambulance", number: "108", desc: "Free emergency response", accent: "emerald" },
  { name: "Cyber Fraud", number: "1930", desc: "Freeze stolen money", accent: "cyan" },
  { name: "Women (Sakhi)", number: "181", desc: "Support & shelter", accent: "fuchsia" },
  { name: "CHILDLINE", number: "1098", desc: "Any child in distress", accent: "amber" },
  { name: "De-addiction", number: "14446", desc: "Free, confidential", accent: "orange" },
];

export function HomePage() {
  const [stats, setStats] = useState<ReturnType<typeof pickStats> | null>(null);
  const [campaigns, setCampaigns] = useState<LiveCampaign[] | null>(null);
  const [testimonials, setTestimonials] = useState<Testimonial[] | null>(null);

  useEffect(() => {
    let alive = true;
    get<unknown>("/api/stats")
      .then((d) => alive && setStats(pickStats(d)))
      .catch(() => alive && setStats(pickStats(null)));
    get<LiveCampaign[]>("/api/campaigns")
      .then((d) => alive && setCampaigns(Array.isArray(d) ? d : []))
      .catch(() => alive && setCampaigns([]));
    get<Testimonial[]>("/api/testimonials")
      .then((d) => alive && setTestimonials(Array.isArray(d) ? d : []))
      .catch(() => alive && setTestimonials([]));
    return () => {
      alive = false;
    };
  }, []);

  const sorted = React.useMemo(() => {
    const list = [...(campaigns ?? [])];
    list.sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false));
    return list;
  }, [campaigns]);

  return (
    <>
      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden bg-gradient-to-b from-emerald-50 via-emerald-50/70 to-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-emerald-200/40 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 top-32 size-80 rounded-full bg-teal-100/50 blur-3xl"
        />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
            <MapPinned className="mr-1 size-3" aria-hidden /> Bengaluru trust · serving all of India
          </Badge>
          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            Compassion, <span className="text-emerald-600">organised.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            United Angel Reach turns everyday kindness into nine proof-first programmes —
            de-addiction help, cyber-fraud rescue, women and child safety, adopted medicines,
            animal welfare, green-corridor ambulances, QR-traced ration kits and menstrual
            health. Built in Bengaluru. Made for India.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" className="h-12 bg-emerald-600 px-6 hover:bg-emerald-700" asChild>
              <Link href="/donate">
                <Heart className="size-5" aria-hidden /> Donate now
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-6" asChild>
              <Link href="/campaigns">
                Explore campaigns <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button size="lg" variant="ghost" className="h-12 px-6" onClick={askAngel}>
              <Sparkles className="size-5 text-emerald-600" aria-hidden /> Ask Angel
            </Button>
          </div>
        </div>
      </section>

      {/* ================= IMPACT STRIP ================= */}
      <Section className="pb-4 pt-2 sm:pb-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {stats === null ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[74px] rounded-xl" />
            ))
          ) : (
            <>
              <Stat icon={Heart} value={formatINR(stats.raised)} label="Raised for communities" accent="emerald" />
              <Stat icon={Users} value={formatNumber(stats.beneficiaries)} label="Beneficiaries reached" accent="orange" />
              <Stat icon={HandHeart} value={formatNumber(stats.volunteers)} label="Volunteers engaged" accent="teal" />
              <Stat icon={CalendarDays} value={formatNumber(stats.campaigns)} label="Active programmes" accent="fuchsia" />
            </>
          )}
        </div>
      </Section>

      {/* ================= 9 PROGRAMMES ================= */}
      <Section
        title="Nine programmes, one promise: proof"
        subtitle="Every programme page carries real India data, a step-by-step playbook, and live numbers you can audit. Pick a cause — or start with the ones our donors love most."
      >
        {campaigns === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Campaigns are warming up"
            hint="Our programme pages are live with full playbooks meanwhile — explore any of the nine."
            action={
              <Button asChild variant="outline">
                <Link href="/campaigns">Browse all programmes</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.slice(0, 9).map((c) => {
              const content = CAMPAIGN_CONTENT[c.slug ?? ""];
              const accent = c.accent ?? content?.accent ?? "emerald";
              const icon = c.icon ?? content?.icon ?? "heart";
              const a = accentClasses(accent);
              const pct =
                c.targetAmount > 0
                  ? Math.min(100, Math.round((c.raisedAmount / c.targetAmount) * 100))
                  : 0;
              return (
                <Card key={c.id} className="flex flex-col gap-3 p-5">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-xl",
                        a.bg100,
                        a.text700
                      )}
                    >
                      <CampaignIcon icon={icon} className="size-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="min-w-0 truncate font-semibold leading-snug">{c.title}</h3>
                        {c.featured && (
                          <Badge className={cn("shrink-0 border-0 text-[10px]", a.bg500, "text-white")}>
                            Featured
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {c.tagline ?? content?.short ?? c.description}
                      </p>
                    </div>
                  </div>
                  <div>
                    <Progress value={pct} className="h-2" aria-label={`${pct}% of target raised`} />
                    <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{formatINR(c.raisedAmount)} raised</span>
                      <span>of {formatINR(c.targetAmount)}</span>
                    </div>
                  </div>
                  <div className="mt-auto flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" asChild>
                      <Link href={`/campaigns/${c.slug}`}>Learn more</Link>
                    </Button>
                    <Button
                      size="sm"
                      className={cn("flex-1 text-white", a.bg500, "hover:opacity-90")}
                      asChild
                    >
                      <Link href={`/donate?campaign=${c.slug}`}>Donate</Link>
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {/* ================= HOW WE WORK ================= */}
      <Section
        title="How we work"
        subtitle="Four steps, one unbroken chain of custody — from need to proof."
        className="bg-muted/40"
      >
        <StepFlow
          accent="emerald"
          steps={[
            {
              title: "Find the need",
              desc: "Volunteers, helpline calls and anganwadi/school referrals surface real families — each verified by a named field volunteer before anything is promised.",
            },
            {
              title: "Mobilise within 24 hours",
              desc: "Donations, kits, medicines or ambulance dispatch are triggered from a single ops desk. Emergencies skip the queue; everything else keeps a fair, audited order.",
            },
            {
              title: "Deliver with QR proof",
              desc: "Ration kits, pad banks and medicines carry a QR that is scanned at the doorstep — family, time, photo. No scan, no closure; exceptions are re-run.",
            },
            {
              title: "Report and scale",
              desc: "Monthly public reports reconcile money vs scans vs outcomes. What works in one Bengaluru ward becomes a playbook for the next hundred cities.",
            },
          ]}
        />
      </Section>

      {/* ================= EMERGENCY HELPLINES ================= */}
      <Section
        title="Emergency numbers that matter"
        subtitle="Save these before you need them. Every card dials straight away."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CORE_HELPLINES.map((h) => (
            <HelplineCard key={h.number} {...h} />
          ))}
        </div>
      </Section>

      {/* ================= SAFETY SPOTLIGHT ================= */}
      <Section
        title="Safety spotlight — know before the crisis"
        subtitle="Four of our programmes are rescue services in disguise. Two minutes on each page could save a family."
        className="bg-muted/40"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SAFETY_SPOTLIGHT.map((s) => {
            const c = CAMPAIGN_CONTENT[s.slug];
            if (!c) return null;
            const a = accentClasses(c.accent);
            return (
              <Link
                key={s.slug}
                href={`/campaigns/${s.slug}`}
                className={cn(
                  "group flex flex-col rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-md",
                  a.border200
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex size-10 items-center justify-center rounded-lg",
                      a.bg100,
                      a.text700
                    )}
                  >
                    <CampaignIcon icon={c.icon} className="size-5" />
                  </span>
                  <span className={cn("text-2xl font-extrabold tracking-tight", a.text700)}>
                    {s.number}
                  </span>
                </div>
                <h3 className="mt-3 font-semibold leading-snug">{c.title}</h3>
                <p className="mt-1 flex-1 text-sm text-muted-foreground">{s.blurb}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 group-hover:underline">
                  Get help <ArrowRight className="size-4" aria-hidden />
                </span>
              </Link>
            );
          })}
        </div>
      </Section>

      {/* ================= TESTIMONIALS ================= */}
      <Section
        title="Voices from the ground"
        subtitle="Volunteers, donors and families — in their own words."
      >
        {testimonials === null ? (
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-52 w-[320px] shrink-0 rounded-xl" />
            ))}
          </div>
        ) : testimonials.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No stories published yet"
            hint="Our first cohort of field volunteers is writing them now. Come back soon."
          />
        ) : (
          <div
            className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 scrollbar-thin"
            role="list"
            aria-label="Testimonials"
          >
            {testimonials.map((t, i) => (
              <Card
                key={t.id ?? i}
                className="flex w-[300px] shrink-0 snap-start flex-col p-5 sm:w-[360px]"
                role="listitem"
              >
                <div className="flex gap-0.5" aria-label={`${t.rating ?? 5} out of 5 stars`}>
                  {Array.from({ length: 5 }).map((_, s) => (
                    <Star
                      key={s}
                      className={cn(
                        "size-4",
                        s < (t.rating ?? 5) ? "fill-amber-400 text-amber-400" : "text-zinc-300"
                      )}
                      aria-hidden
                    />
                  ))}
                </div>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-foreground">
                  &ldquo;{t.message}&rdquo;
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                    {t.name?.[0]?.toUpperCase() ?? "?"}
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.role}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* ================= CTA BAND ================= */}
      <Section className="pb-16">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-emerald-600 p-8 text-white sm:p-12 md:flex-row md:items-center">
          <div className="max-w-xl">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Two hours a month changes a life.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-emerald-50/90 sm:text-base">
              Volunteer for a distribution lane, host an awareness session, or fund a month of
              medicines. Angel-trained, background-verified, always accompanied.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button size="lg" variant="outline" className="border-0 bg-white text-emerald-700 hover:bg-emerald-50" asChild>
              <Link href="/volunteer">
                <HandHeart className="size-5" aria-hidden /> Volunteer
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white bg-transparent text-white hover:bg-white/10"
              asChild
            >
              <Link href="/donate">Donate</Link>
            </Button>
          </div>
        </div>
      </Section>

    </>
  );
}
