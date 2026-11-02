"use client";

import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Section, StepFlow } from "@/components/public/shared";
import {
  ArrowRight,
  BadgeIndianRupee,
  Eye,
  HandHeart,
  Heart,
  Landmark,
  MapPinned,
  QrCode,
  ShieldCheck,
  Zap,
} from "lucide-react";

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
    title: "2023 — Founded in Bengaluru",
    desc: "A dozen volunteers, one rented office in Indiranagar, and the first anti-drug campus drives across four colleges.",
  },
  {
    title: "2024 — Proof-first systems",
    desc: "QR-coded ration kits launched; partnerships with 181 Sakhi centres and CHILDLINE volunteers; first 10,000 beneficiaries.",
  },
  {
    title: "2025 — Health & animals",
    desc: "Adopt-a-Medicine goes live with Jan Aushadhi pricing; animal welfare desk opens with ABC drives and a 24×7 rescue roster.",
  },
  {
    title: "2026 — Bengaluru → India",
    desc: "The AI Green Corridor pilots on Bengaluru traffic; nine programmes run playbooks ready for replication in every state.",
  },
];

export function AboutPage() {
  return (
    <>
      {/* Story */}
      <Section title="Our story">
        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
            <p>
              United Angel Reach began in 2023 with a simple frustration: Bengaluru has enormous
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
              is written in our caption: <strong className="text-foreground">Bengaluru → India</strong>.
              Every system that works in one ward becomes a playbook for the next hundred cities.
            </p>
          </div>
          <Card className="h-fit bg-emerald-50 p-6">
            <Badge className="border-0 bg-emerald-600 text-white">
              <MapPinned className="mr-1 size-3" aria-hidden /> Our vision
            </Badge>
            <h3 className="mt-3 text-xl font-bold tracking-tight text-emerald-900">
              A country where help is one call away — and provable.
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-emerald-900/80">
              Bengaluru is our laboratory; India is the mission. By 2030, we aim for UAR playbooks
              running in 25 cities, audited by the same QR chain of custody.
            </p>
            <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-emerald-800">
              <ArrowRight className="size-4" aria-hidden />
              Bengaluru → India
            </div>
          </Card>
        </div>
      </Section>

      {/* Values */}
      <Section
        title="What we refuse to compromise"
        subtitle="Four values, printed on every volunteer ID card."
        className="bg-muted/40"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {VALUES.map((v) => (
            <Card key={v.title} className="flex gap-4 p-5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
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

      {/* Timeline */}
      <Section title="The road so far">
        <div className="mx-auto max-w-3xl">
          <StepFlow accent="emerald" steps={TIMELINE} />
        </div>
      </Section>

      {/* Financial promise */}
      <Section title="Our financial promise" className="bg-muted/40">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-6">
            <QrCode className="size-6 text-emerald-600" aria-hidden />
            <h3 className="mt-3 font-semibold">QR chain of custody</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Kits, pads and medicines carry a printed QR that is scanned at the beneficiary&rsquo;s
              door. Batches reconcile against scans monthly — leakage would be a number, not a rumour.
            </p>
          </Card>
          <Card className="p-6">
            <Progress value={8} className="h-2" aria-label="Under 8 percent administration" />
            <h3 className="mt-3 font-semibold">&lt; 8% administration</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Wholesale procurement, volunteer-first operations and a lean ops desk keep overheads
              under eight percent — audited annually and published.
            </p>
          </Card>
          <Card className="border-emerald-200 bg-emerald-50/60 p-6">
            <Landmark className="size-6 text-emerald-700" aria-hidden />
            <h3 className="mt-3 font-semibold text-emerald-900">80G · 12A registered</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-emerald-900/80">
              Donations are eligible for deduction under Section 80G of the Income-tax Act. Share
              your PAN while donating and the receipt reaches your inbox automatically.
            </p>
            <Button className="mt-4 bg-emerald-600 hover:bg-emerald-700" asChild>
              <Link href="/donate">
                <Heart className="size-4" aria-hidden /> Donate with 80G receipt
              </Link>
            </Button>
          </Card>
        </div>
        <p className="mx-auto mt-6 flex max-w-2xl items-start justify-center gap-2 text-center text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          United Angel Reach Trust · Bengaluru, Karnataka · Registered charitable trust serving all
          of India · care@unitedangelreach.org · Mon–Sat 9:30–6:30
        </p>
      </Section>
    </>
  );
}
