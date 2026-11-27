"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/lib/router";
import { get } from "@/lib/api-client";
import { parseGallery, coverImageOf } from "@/lib/campaign-image";
import { cn, formatNumber } from "@/lib/utils";
import { formatINRCompact } from "@/lib/format";
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Section,
  Stat,
  HelplineCard,
  EmptyState,
  CampaignIcon,
  askAngel,
  pickStats,
} from "@/components/public/shared";
import {
  CAMPAIGN_CONTENT,
  ORG_DEFAULTS,
  accentSoft,
  type OrgFallbacks,
} from "@/components/public/campaign-data";
import {
  ArrowRight,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  HandHeart,
  Heart,
  Landmark,
  MapPinned,
  Megaphone,
  Package,
  Quote,
  SearchX,
  Siren,
  Sparkles,
  Star,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

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
  urgent?: boolean | null;
  status?: string | null;
  startDate?: string | null;
  gallery?: string | null;
  images?: string | null;
  coverImage?: string | null;
}

/** Parses the JSON-array `gallery` column; returns [] on anything else. */
interface Testimonial {
  id?: string;
  name: string;
  role: string;
  message: string;
  rating?: number;
}

const CORE_HELPLINES = [
  { name: "Police & Fire", number: "112", desc: "Any emergency, 24×7", accent: "red" },
  { name: "Ambulance", number: "108", desc: "Free emergency response", accent: "emerald" },
  { name: "Cyber Fraud", number: "1930", desc: "Freeze stolen money", accent: "cyan" },
  { name: "Women (Sakhi)", number: "181", desc: "Support & shelter", accent: "fuchsia" },
  { name: "CHILDLINE", number: "1098", desc: "Any child in distress", accent: "amber" },
  { name: "De-addiction", number: "14446", desc: "Free, confidential", accent: "orange" },
];

const GROWTH_CITIES = [
  { name: "Bengaluru", tag: "HQ" },
  { name: "Mysuru" },
  { name: "Hubballi" },
  { name: "Mangaluru" },
  { name: "Mumbai" },
  { name: "Hyderabad" },
  { name: "Delhi" },
  { name: "Kolkata" },
  { name: "Guwahati" },
  { name: "Chennai" },
  { name: "Pune" },
  { name: "Patna" },
];

const JOURNEY = [
  {
    icon: Wallet,
    title: "You give",
    desc: "A one-time or monthly gift lands in the audited fund — 80G receipt in your inbox within seconds.",
  },
  {
    icon: Package,
    title: "We assemble",
    desc: "Kits are packed, medicines bought at Jan Aushadhi rates, corridor beacons mapped — every unit gets a QR.",
  },
  {
    icon: Truck,
    title: "Volunteers deliver",
    desc: "Background-verified volunteers deliver to the door and scan the QR. No scan, no closure — an audit instead.",
  },
  {
    icon: ClipboardCheck,
    title: "Proof comes back",
    desc: "The monthly public report reconciles money against scans — and the playbook ships to the next city.",
  },
];

/* ------------------------------------------------------------------ */
/* Count-up (framer-motion, reduced-motion aware)                      */
/* ------------------------------------------------------------------ */

function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(0, value, {
      duration: 1.3,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, value, reduce]);

  const shown = reduce ? value : display;

  return (
    <span ref={ref} className={className}>
      {format ? format(shown) : formatNumber(Math.round(shown))}
    </span>
  );
}

/* ================================================================== */
/* HomePage                                                            */
/* ================================================================== */

export function HomePage() {
  const reduce = useReducedMotion();
  const [stats, setStats] = useState<ReturnType<typeof pickStats> | null>(null);
  const [campaigns, setCampaigns] = useState<LiveCampaign[] | null>(null);
  const [testimonials, setTestimonials] = useState<Testimonial[] | null>(null);
  const [org, setOrg] = useState<OrgFallbacks | null>(null);
  const [tIndex, setTIndex] = useState(0);
  const [paused, setPaused] = useState(false);

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
    get<OrgFallbacks>("/api/settings/public")
      .then((d) => alive && setOrg(d ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /* Featured = urgent first, then flagged campaigns, then top funded */
  const featured = useMemo(() => {
    const list = [...(campaigns ?? [])].filter((c) => c.status !== "CANCELLED");
    list.sort(
      (a, b) =>
        Number(b.urgent ?? false) - Number(a.urgent ?? false) ||
        Number(b.featured ?? false) - Number(a.featured ?? false) ||
        b.raisedAmount - a.raisedAmount
    );
    return list.slice(0, 3);
  }, [campaigns]);

  /* Urgent appeals = flagged urgent, not cancelled; strip shows only when any exist */
  const urgent = useMemo(
    () =>
      (campaigns ?? []).filter(
        (c) => c.urgent === true && c.status !== "CANCELLED"
      ),
    [campaigns]
  );

  /* Testimonial carousel auto-advance */
  useEffect(() => {
    const count = testimonials?.length ?? 0;
    if (count <= 1 || paused) return;
    const t = setInterval(() => setTIndex((i) => (i + 1) % count), 6000);
    return () => clearInterval(t);
  }, [testimonials, paused]);

  const current = testimonials && testimonials.length > 0
    ? testimonials[((tIndex % testimonials.length) + testimonials.length) % testimonials.length]
    : null;

  return (
    <>
      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden border-b bg-gradient-to-b from-emerald-500/10 via-transparent to-transparent">
        {/* Animated gradient blobs — dark-safe */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-emerald-500/20 blur-3xl"
          animate={reduce ? undefined : { x: [0, 30, 0], y: [0, 20, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-16 top-24 size-96 rounded-full bg-teal-500/15 blur-3xl"
          animate={reduce ? undefined : { x: [0, -24, 0], y: [0, 16, 0] }}
          transition={{ duration: 17, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-1/3 size-64 rounded-full bg-lime-500/10 blur-3xl"
          animate={reduce ? undefined : { x: [0, 18, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="relative mx-auto w-full max-w-screen-2xl px-4 py-16 sm:px-6 sm:py-24">
          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
            <MapPinned className="mr-1 size-3" aria-hidden /> Bengaluru trust · serving all of India
          </Badge>
          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            From Bengaluru,{" "}
            <span className="text-emerald-600 dark:text-emerald-400">for all of India.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {org?.vision || ORG_DEFAULTS.vision}
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
              <Sparkles className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden /> Ask Angel
            </Button>
          </div>

          {/* Hero stats strip — live */}
          <div className="mt-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats === null ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[74px] rounded-xl" />
              ))
            ) : (
              <>
                <Stat
                  icon={Heart}
                  value={<CountUp value={stats.raised} format={(n) => formatINRCompact(n)} />}
                  label="Raised for communities"
                  accent="emerald"
                />
                <Stat
                  icon={Users}
                  value={<CountUp value={stats.beneficiaries} />}
                  label="Beneficiaries reached"
                  accent="orange"
                />
                <Stat
                  icon={HandHeart}
                  value={<CountUp value={stats.volunteers} />}
                  label="Volunteers engaged"
                  accent="teal"
                />
                <Stat
                  icon={BadgeCheck}
                  value={<CountUp value={stats.donations} />}
                  label="Donations recorded"
                  accent="pink"
                />
              </>
            )}
          </div>
        </div>
      </section>

      {/* ================= URGENT APPEALS ================= */}
      {urgent.length > 0 && (
        <section
          aria-label="Urgent appeals"
          className="border-b bg-red-500/[0.06] dark:bg-red-500/[0.08]"
        >
          <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="relative flex size-2.5" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-red-600" />
              </span>
              <h2 className="text-sm font-bold uppercase tracking-wide text-red-700 dark:text-red-400">
                Urgent appeals
              </h2>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Disaster response needs donors now — every hour counts.
              </p>
            </div>
            <div
              className="mt-3 flex gap-4 overflow-x-auto pb-1 [scrollbar-width:thin]"
              role="list"
            >
              {urgent.map((c) => {
                const content = CAMPAIGN_CONTENT[c.slug ?? ""];
                const pct =
                  c.targetAmount > 0
                    ? Math.min(100, Math.round((c.raisedAmount / c.targetAmount) * 100))
                    : 0;
                return (
                  <Card
                    key={c.id}
                    role="listitem"
                    className="flex w-[300px] shrink-0 flex-col border-red-500/30 bg-red-500/10 p-4 sm:w-[360px]"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-600 dark:text-red-400">
                        <CampaignIcon
                          icon={c.icon ?? content?.icon ?? "siren"}
                          className="size-5"
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold leading-snug">
                          {c.title}
                        </h3>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {c.tagline ?? content?.heroTag ?? c.description}
                        </p>
                      </div>
                    </div>
                    <Progress
                      value={pct}
                      className="mt-3 h-2"
                      aria-label={`${pct}% of target raised`}
                    />
                    <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {formatINRCompact(c.raisedAmount)} raised
                      </span>
                      <span>
                        of {formatINRCompact(c.targetAmount)} · {pct}%
                      </span>
                    </div>
                    <Button
                      className="mt-3 h-11 w-full bg-red-500 text-white hover:bg-red-600"
                      asChild
                    >
                      <Link href={`/campaigns/${c.slug}`}>
                        <Heart className="size-4" aria-hidden /> Donate now
                      </Link>
                    </Button>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ================= FEATURED CAMPAIGNS ================= */}
      <Section
        title="Featured campaigns"
        subtitle="Where donors are putting their money to work right now — every rupee QR-traced to a doorstep."
      >
        {campaigns === null ? (
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : featured.length === 0 ? (
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
          <div className="grid gap-4 md:grid-cols-3">
            {featured.map((c) => {
              const content = CAMPAIGN_CONTENT[c.slug ?? ""];
              const a = accentSoft(c.accent ?? content?.accent);
              const pct =
                c.targetAmount > 0
                  ? Math.min(100, Math.round((c.raisedAmount / c.targetAmount) * 100))
                  : 0;
              const cover = coverImageOf(c);
              return (
                <Card
                  key={c.id}
                  className={cn(
                    "flex min-w-0 flex-col overflow-hidden border p-0 transition-all hover:-translate-y-0.5 hover:shadow-md",
                    a.border
                  )}
                >
                  {cover ? (
                    <img
                      src={cover}
                      alt={`${c.title} — campaign cover photo`}
                      loading="lazy"
                      className="h-36 w-full object-cover"
                    />
                  ) : (
                    <div className={cn("h-1.5 w-full", a.chip)} aria-hidden />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-xl",
                        a.chip,
                        a.text
                      )}
                    >
                      <CampaignIcon
                        icon={c.icon ?? content?.icon ?? "heart"}
                        className="size-6"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="min-w-0 truncate font-semibold leading-snug">
                          {c.title}
                        </h3>
                        {c.featured && (
                          <Badge className="shrink-0 border-0 bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400">
                            <Star className="mr-0.5 size-2.5 fill-current" aria-hidden /> Featured
                          </Badge>
                        )}
                        {c.urgent && (
                          <Badge className="shrink-0 border-0 bg-red-500/15 text-[10px] text-red-600 dark:text-red-400">
                            <Siren className="mr-0.5 size-2.5" aria-hidden /> Urgent
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {c.tagline ?? content?.heroTag ?? c.description}
                      </p>
                    </div>
                  </div>
                  <div>
                    <Progress value={pct} className="h-2" aria-label={`${pct}% of target raised`} />
                    <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {formatINRCompact(c.raisedAmount)} raised
                      </span>
                      <span>of {formatINRCompact(c.targetAmount)} · {pct}%</span>
                    </div>
                  </div>
                  <div className="mt-auto flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" asChild>
                      <Link href={`/campaigns/${c.slug}`}>Learn more</Link>
                    </Button>
                    <Button
                      size="sm"
                      className={cn("flex-1 text-white", a.solid)}
                      asChild
                    >
                      <Link href={`/donate?campaign=${c.slug}`}>
                        <Heart className="size-3.5" aria-hidden /> Donate
                      </Link>
                    </Button>
                  </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {/* ================= HOW YOUR GIFT TRAVELS ================= */}
      <Section
        title="How your gift travels"
        subtitle="Four steps, one unbroken chain of custody — from your UPI pin to a doorstep scan."
        className="bg-muted/40"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {JOURNEY.map((s, i) => (
            <div key={s.title} className="relative flex flex-col">
              <Card className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <s.icon className="size-6" aria-hidden />
                  </span>
                  <span className="text-3xl font-extrabold text-muted-foreground/25">
                    {i + 1}
                  </span>
                </div>
                <h3 className="font-semibold leading-snug">{s.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
              </Card>
              {i < JOURNEY.length - 1 && (
                <ArrowRight
                  aria-hidden
                  className="absolute -right-3.5 top-1/2 z-10 hidden size-5 -translate-y-1/2 text-emerald-500/60 lg:block"
                />
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ================= IMPACT COUNTERS ================= */}
      <Section
        title="Impact, counted live"
        subtitle="Numbers move as donations land and kits get scanned — nothing here is a stock photo."
      >
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {stats === null ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))
          ) : (
            <>
              {[
                { label: "Raised for communities", value: stats.raised, money: true, accent: "text-emerald-600 dark:text-emerald-400" },
                { label: "Beneficiaries reached", value: stats.beneficiaries, money: false, accent: "text-orange-600 dark:text-orange-400" },
                { label: "Volunteers engaged", value: stats.volunteers, money: false, accent: "text-teal-600 dark:text-teal-400" },
                { label: "Donations recorded", value: stats.donations, money: false, accent: "text-pink-600 dark:text-pink-400" },
              ].map((c) => (
                <Card key={c.label} className="p-5 text-center sm:p-6">
                  <CountUp
                    value={c.value}
                    format={c.money ? (n) => formatINRCompact(n) : undefined}
                    className={cn("text-3xl font-extrabold tracking-tight sm:text-4xl", c.accent)}
                  />
                  <p className="mt-1.5 text-xs font-medium text-muted-foreground sm:text-sm">
                    {c.label}
                  </p>
                </Card>
              ))}
            </>
          )}
        </div>
      </Section>

      {/* ================= TESTIMONIAL CAROUSEL ================= */}
      <Section
        title="Voices from the ground"
        subtitle="Volunteers, donors and families — in their own words."
        className="bg-muted/40"
      >
        {testimonials === null ? (
          <Skeleton className="mx-auto h-60 max-w-2xl rounded-xl" />
        ) : testimonials.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No stories published yet"
            hint="Our first cohort of field volunteers is writing them now. Come back soon."
          />
        ) : (
          <div
            className="relative mx-auto max-w-2xl"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <Card className="min-h-[240px] p-6 sm:p-8">
              <Quote
                className="size-8 text-emerald-500/30"
                aria-hidden
              />
              <AnimatePresence mode="wait" initial={false}>
                {current && (
                  <motion.figure
                    key={current.id ?? tIndex}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                  >
                    <div
                      className="mt-3 flex gap-0.5"
                      aria-label={`${current.rating ?? 5} out of 5 stars`}
                    >
                      {Array.from({ length: 5 }).map((_, s) => (
                        <Star
                          key={s}
                          className={cn(
                            "size-4",
                            s < (current.rating ?? 5)
                              ? "fill-amber-400 text-amber-400"
                              : "text-muted-foreground/30"
                          )}
                          aria-hidden
                        />
                      ))}
                    </div>
                    <blockquote className="mt-3 text-sm leading-relaxed text-foreground sm:text-base">
                      &ldquo;{current.message}&rdquo;
                    </blockquote>
                    <figcaption className="mt-4 flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {current.name?.[0]?.toUpperCase() ?? "?"}
                      </span>
                      <div>
                        <p className="text-sm font-semibold">{current.name}</p>
                        <p className="text-xs text-muted-foreground">{current.role}</p>
                      </div>
                    </figcaption>
                  </motion.figure>
                )}
              </AnimatePresence>
            </Card>

            {/* Controls */}
            <div className="mt-4 flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="icon"
                className="size-10"
                aria-label="Previous testimonial"
                onClick={() =>
                  setTIndex((i) => (i - 1 + (testimonials?.length || 1)) % (testimonials?.length || 1))
                }
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <div className="flex gap-1.5" role="tablist" aria-label="Testimonial selector">
                {testimonials.map((t, i) => (
                  <button
                    key={t.id ?? i}
                    role="tab"
                    aria-selected={i === tIndex}
                    aria-label={`Testimonial ${i + 1} of ${testimonials.length}`}
                    onClick={() => setTIndex(i)}
                    className={cn(
                      "h-2 rounded-full transition-all",
                      i === tIndex ? "w-6 bg-emerald-500" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                    )}
                  />
                ))}
              </div>
              <Button
                variant="outline"
                size="icon"
                className="size-10"
                aria-label="Next testimonial"
                onClick={() => setTIndex((i) => (i + 1) % (testimonials?.length || 1))}
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </Section>

      {/* ================= 9 PROGRAMMES GRID ================= */}
      <Section
        title="Nine programmes, one promise: proof"
        subtitle="Every programme is an educational resource, a rescue service and a funding pipeline at once."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.values(CAMPAIGN_CONTENT).map((c) => {
            const live = campaigns?.find((x) => x.slug === c.slug);
            const a = accentSoft(c.accent);
            const pct =
              live && live.targetAmount > 0
                ? Math.min(100, Math.round((live.raisedAmount / live.targetAmount) * 100))
                : 0;
            return (
              <Link
                key={c.slug}
                href={`/campaigns/${c.slug}`}
                className={cn(
                  "group flex min-h-[44px] min-w-0 items-start gap-3 overflow-hidden rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-md",
                  a.border
                )}
                aria-label={`${c.title} — open programme page`}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-lg",
                    a.chip,
                    a.text
                  )}
                >
                  <CampaignIcon icon={c.icon} className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold leading-snug">{c.title}</span>
                    <ArrowRight
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                    {c.heroTag}
                  </span>
                  {live && (
                    <span className="mt-2 block">
                      <Progress value={pct} className="h-1.5" aria-label={`${pct}% raised`} />
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {formatINRCompact(live.raisedAmount)}
                        </span>{" "}
                        raised of {formatINRCompact(live.targetAmount)}
                      </span>
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      </Section>

      {/* ================= HELPLINES ================= */}
      <Section
        title="Emergency numbers that matter"
        subtitle="Save these before you need them. Every card dials straight away."
        className="bg-muted/40"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CORE_HELPLINES.map((h) => (
            <HelplineCard key={h.number} {...h} />
          ))}
        </div>
      </Section>

      {/* ================= BENGALURU → INDIA GROWTH BANNER ================= */}
      <Section className="pb-16">
        <div className="overflow-hidden rounded-3xl bg-emerald-600 p-8 text-white sm:p-12">
          <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
            <div className="max-w-xl">
              <Badge className="border-0 bg-white/15 text-white">
                <MapPinned className="mr-1 size-3" aria-hidden /> The plan
              </Badge>
              <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
                Bengaluru is the pilot. India is the mission.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-emerald-50/90 sm:text-base">
                Every playbook that proves itself in one Bengaluru ward — kit lanes, pad
                banks, corridor drills — is packaged for the next city. Same QR chain of
                custody, same audited numbers, state after state.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="outline" className="border-white/30 bg-white/10 text-white">
                  <Landmark className="mr-1 size-3" aria-hidden /> 80G tax exempt
                </Badge>
                <Badge variant="outline" className="border-white/30 bg-white/10 text-white">
                  12A registered
                </Badge>
              </div>
            </div>
            <div className="shrink-0">
              <Button size="lg" className="border-0 bg-white text-emerald-700 hover:bg-emerald-50" asChild>
                <Link href="/donate">
                  <Heart className="size-5" aria-hidden /> Fund the next city
                </Link>
              </Button>
            </div>
          </div>

          {/* City chips */}
          <div className="mt-8 flex flex-wrap items-center gap-2" aria-label="Expansion cities">
            {GROWTH_CITIES.map((city, i) => (
              <span
                key={city.name}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-white/25",
                  i === 0 ? "bg-white text-emerald-700" : "bg-white/10 text-white/90"
                )}
              >
                {city.name}
                {city.tag && <span className="ml-1 font-normal opacity-80">· {city.tag}</span>}
              </span>
            ))}
            <span
              aria-hidden
              className="bg-gradient-to-r from-transparent to-emerald-600 bg-clip-text px-2 text-xs font-bold text-white/40"
            >
              …and the rest of India
            </span>
          </div>
        </div>
      </Section>
    </>
  );
}
