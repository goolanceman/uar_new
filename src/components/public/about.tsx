"use client";

import { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { get } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Section, StepFlow } from "@/components/public/shared";
import { ORG_DEFAULTS, orgWithFallbacks, type OrgFallbacks } from "@/components/public/campaign-data";
import {
  ArrowRight,
  BadgeIndianRupee,
  Eye,
  FileText,
  HandHeart,
  Heart,
  Landmark,
  MapPinned,
  QrCode,
  ShieldCheck,
  Target,
  Zap,
} from "lucide-react";

/* ------------------------------------------------------------------ */

const VALUES = [
  {
    icon: Eye,
    title: "Transparency first",
    desc: "Every rupee is traceable to a scan, a delivery or an audit line. If we can't evidence it, we don't claim it.",
  },
  {
    icon: HandHeart,
    title: "Dignity always",
    desc: "No faces without consent, no registers that label the needy, no queues for cameras. Help arrives like a neighbour, not a photo-op.",
  },
  {
    icon: Zap,
    title: "Speed saves",
    desc: "Golden hours are real: fraud money, cardiac arrests, disclosures. Our processes are designed around minutes, not quarters.",
  },
  {
    icon: BadgeIndianRupee,
    title: "Every rupee accountable",
    desc: "Under 8% administration, wholesale procurement, and audited books — donor money buys outcomes, not overheads.",
  },
];

const TIMELINE = [
  {
    title: "2019 — Founded in Bengaluru",
    desc: "A volunteer collective in Indiranagar starts running anti-drug campus drives across four colleges — with one rule from day one: every claim needs proof.",
  },
  {
    title: "2021 — Trust registered · kits programme",
    desc: "UAR is registered as a charitable trust (80G · 12A) and launches QR-coded ration kits — each unit scanned at the beneficiary's door, no scan, no closure.",
  },
  {
    title: "2024 — Health, safety & animals",
    desc: "Adopt-a-Medicine goes live at Jan Aushadhi pricing; school pad banks open; women and child safety programmes join the 181/1098 referral network; the animal welfare desk starts ABC drives.",
  },
  {
    title: "2025 — Green corridor R&D",
    desc: "The AI Green Corridor is prototyped on Bengaluru traffic: a four-layer alert mesh (V2X/5G → cell broadcast → offline BLE → FM-RDS) with every event logged to the second.",
  },
  {
    title: "2026 — Statewide expansion",
    desc: "Nine field-tested playbooks are packaged for replication — Mysuru, Hubballi and Mangaluru first, then every state capital. Bengaluru → India.",
  },
];

const WHERE_WE_WORK = [
  { name: "Bengaluru", tag: "HQ" },
  { name: "Mysuru" },
  { name: "Hubballi" },
  { name: "Mangaluru" },
  { name: "Davanagere" },
  { name: "Next: every state capital" },
];

/* ================================================================== */

export function AboutPage() {
  const [org, setOrg] = useState<OrgFallbacks | null>(null);

  useEffect(() => {
    let alive = true;
    get<Partial<OrgFallbacks>>("/api/settings/public")
      .then((d) => alive && setOrg(orgWithFallbacks(d)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const o = org ?? ORG_DEFAULTS;

  const registrations = [
    { label: "80G registration", value: o.org80g },
    { label: "PAN", value: o.orgPan, mono: true },
    { label: "12A registration", value: o.orgReg12a },
    { label: "NGO Darpan ID", value: o.orgDarpan, mono: true },
  ];

  return (
    <>
      {/* Mission / Vision */}
      <Section
        title="Who we are"
        subtitle="A Bengaluru charitable trust built on one stubborn idea: help should be provable."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-6">
            <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Target className="size-6" aria-hidden />
            </span>
            <h2 className="mt-4 text-xl font-bold tracking-tight">Our mission</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Turn everyday kindness into nine proof-first programmes — de-addiction help,
              cyber-fraud rescue, women and child safety, adopted medicines, animal welfare,
              green-corridor ambulances, QR-traced ration kits and menstrual health — each with
              a verified need, a published playbook and an audited delivery trail.
            </p>
          </Card>
          <Card className="border-emerald-500/25 bg-emerald-500/10 p-6">
            <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <MapPinned className="size-6" aria-hidden />
            </span>
            <h2 className="mt-4 text-xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400">
              Our vision
            </h2>
            {org === null ? (
              <div className="mt-2 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-foreground/90 sm:text-base">
                {o.vision}
              </p>
            )}
            <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              <ArrowRight className="size-4" aria-hidden />
              Bengaluru → India
            </div>
          </Card>
        </div>
      </Section>

      {/* Story + timeline */}
      <Section title="Our story" className="bg-muted/40">
        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
            <p>
              United Angel Reach began in 2019 with a simple frustration: Bengaluru has enormous
              kindness and enormous need, and almost no plumbing between them. Volunteers wanted
              to help; families needed specific things at specific hours; and nobody could prove
              where the money in the middle actually went.
            </p>
            <p>
              So we built the plumbing. Nine programmes — from de-addiction accompaniment to
              green-corridor ambulances — each with the same skeleton: a verified need, a
              published playbook, a QR-traced delivery, and a monthly public report. What started
              in Indiranagar now runs lanes, schools, pad banks and rescue rosters across
              Karnataka, with replication kits ready for every state.
            </p>
            <p>
              We remain a Bengaluru trust — registered, audited, 80G-eligible — but our ambition
              is written in our caption:{" "}
              <strong className="text-foreground">Bengaluru → India</strong>. Every system that
              works in one ward becomes a playbook for the next hundred cities.
            </p>
          </div>
          <div className="mx-auto w-full max-w-md lg:max-w-none">
            <StepFlow accent="emerald" steps={TIMELINE} />
          </div>
        </div>
      </Section>

      {/* Values */}
      <Section title="What we refuse to compromise" subtitle="Four values, printed on every volunteer ID card.">
        <div className="grid gap-4 sm:grid-cols-2">
          {VALUES.map((v) => (
            <Card key={v.title} className="flex gap-4 p-5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <v.icon className="size-6" aria-hidden />
              </span>
              <div>
                <h3 className="font-semibold">{v.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{v.desc}</p>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* Governance & transparency */}
      <Section
        title="Governance & transparency"
        subtitle="Registrations are public; accounts are audited annually; the annual report is shared on request."
        className="bg-muted/40"
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-6 lg:col-span-2">
            <h3 className="flex items-center gap-2 font-semibold">
              <Landmark className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />{" "}
              Registrations
            </h3>
            {org === null ? (
              <div className="mt-4 space-y-2.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 rounded-lg" />
                ))}
              </div>
            ) : (
              <dl className="mt-4 space-y-2.5">
                {registrations.map((r) => (
                  <div
                    key={r.label}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3.5 py-2.5"
                  >
                    <dt className="text-sm text-muted-foreground">{r.label}</dt>
                    <dd
                      className={cnValue(r.mono)}
                      aria-label={r.value ? `${r.label}: ${r.value}` : `${r.label} available on request`}
                    >
                      {r.value || <span className="text-muted-foreground/70">Available on request</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="outline" className="gap-1">
                <FileText className="size-3" aria-hidden /> Annual report on request
              </Badge>
              <Badge variant="outline" className="gap-1">
                <ShieldCheck className="size-3" aria-hidden /> Audited accounts, published yearly
              </Badge>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Write to{" "}
              <a
                href={`mailto:${o.orgEmail}`}
                className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
              >
                {o.orgEmail}
              </a>{" "}
              with “Annual report” in the subject and we&rsquo;ll send the latest audited
              statement within five working days.
            </p>
          </Card>

          <Card className="p-6">
            <QrCode className="size-6 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <h3 className="mt-3 font-semibold">QR chain of custody</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Kits, pads and medicines carry a printed QR that is scanned at the
              beneficiary&rsquo;s door. Batches reconcile against scans monthly — leakage would
              be a number, not a rumour.
            </p>
            <div className="mt-5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">Administration cost</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">&lt; 8%</span>
              </div>
              <Progress value={8} className="mt-2 h-2" aria-label="Under 8 percent administration" />
            </div>
          </Card>
        </div>
      </Section>

      {/* Where we work */}
      <Section
        title="Where we work"
        subtitle="Karnataka first, then India — one playbook, one audit trail at a time."
      >
        <div className="flex flex-wrap gap-2" aria-label="Cities where UAR works">
          {WHERE_WE_WORK.map((c, i) => (
            <span
              key={c.name}
              className={
                i === 0
                  ? "inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white"
                  : "inline-flex items-center rounded-full border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground"
              }
            >
              {i === 0 && <MapPinned className="size-3" aria-hidden />}
              {c.name}
            </span>
          ))}
          <span
            aria-hidden
            className="inline-flex items-center rounded-full border border-dashed px-3.5 py-1.5 text-xs font-semibold text-muted-foreground/70"
          >
            → and the rest of India
          </span>
        </div>
      </Section>

      {/* CTA join */}
      <Section className="pb-16">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-emerald-600 p-8 text-white sm:p-12 md:flex-row md:items-center">
          <div className="max-w-xl">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Join the proof-first movement.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-emerald-50/90 sm:text-base">
              Fund a programme with an 80G receipt, or give two hours a month as a
              background-verified volunteer. Both leave the same thing behind: evidence.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button
              size="lg"
              variant="outline"
              className="border-0 bg-white text-emerald-700 hover:bg-emerald-50"
              asChild
            >
              <Link href="/donate">
                <Heart className="size-5" aria-hidden /> Donate
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white bg-transparent text-white hover:bg-white/10"
              asChild
            >
              <Link href="/volunteer">
                <HandHeart className="size-5" aria-hidden /> Volunteer
              </Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}

function cnValue(mono?: boolean): string {
  return mono
    ? "font-mono text-sm font-semibold tracking-wide"
    : "text-sm font-semibold";
}
