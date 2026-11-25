"use client";

/**
 * Public Food Security programme page (/#/programs/food-security).
 * Real, verified impact statistics from /api/food/public, upcoming approved
 * distributions, programme categories, transparency, volunteering, partners
 * and FAQ. No beneficiary-identifying information is ever rendered here.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Apple, ArrowRight, Building2, CalendarDays, Clock, HandHeart, Heart,
  HelpCircle, MapPin, PackageCheck, ScanLine, ShieldCheck, Soup, Users, UtensilsCrossed,
} from "lucide-react";
import { get } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Section, EmptyState } from "@/components/public/shared";
import { StatusBadge } from "@/components/shared/status-badge";
import { FoodPledgeSection } from "./food-pledge";

interface PublicStats {
  stats: {
    familiesSupported: number;
    individualsReached: number;
    kitsDistributed: number;
    mealsServed: number;
    distributionLocations: number;
    eventsCompleted: number;
    eventsOpen: number;
    activeProgrammes: number;
    activeVolunteers: number;
    totalDonations: number;
  };
  reportingPeriod?: string;
  lastUpdated: string;
}

interface PublicEvent {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  eventDate: string;
  startTime?: string | null;
  endTime?: string | null;
  venue: string;
  city?: string | null;
  eventType: string;
  status: string;
  registrationOpen: boolean;
  registrationDeadline?: string | null;
  specialInstructions?: string | null;
  coordinatorName?: string | null;
  coordinatorPhone?: string | null;
  programme?: { title: string; slug: string; category: string; eligibilityCriteria: string | null } | null;
  registeredCount?: number | null;
  maxCapacity?: number | null;
}

const PROGRAMMES: Array<{ title: string; description: string; icon: React.ReactNode }> = [
  { title: "Family Grocery Kits", description: "Rice, atta, dal, oil and essentials packed as a family ration kit — sized to the household.", icon: <PackageCheck className="size-5" /> },
  { title: "Free Cooked Meals", description: "Hot, hygienic meals served at community points and through partner kitchens.", icon: <Soup className="size-5" /> },
  { title: "Monthly Food Assistance", description: "Recurring ration support for registered families on fixed monthly cycles.", icon: <CalendarDays className="size-5" /> },
  { title: "Children's Nutrition", description: "Age-appropriate nutrition support for growing children through schools and anganwadis.", icon: <Heart className="size-5" /> },
  { title: "Senior Citizen Food Support", description: "Easy-to-prepare essentials delivered to elders living alone or with limited mobility.", icon: <Heart className="size-5" /> },
  { title: "Emergency Food Relief", description: "Fast-response food packets for floods, fires, job loss and sudden crises.", icon: <ShieldCheck className="size-5" /> },
  { title: "Community Kitchen", description: "Neighbourhood kitchens where volunteers cook and serve together every week.", icon: <UtensilsCrossed className="size-5" /> },
  { title: "Festival Food Distribution", description: "Ramadan, Deepavali and festival kits so celebration never skips a household.", icon: <Soup className="size-5" /> },
  { title: "Rural Food Assistance", description: "Reaching villages far from city supply chains with packed rations and mobile points.", icon: <MapPin className="size-5" /> },
  { title: "Surplus Food Recovery", description: "Safe, inspected surplus from wholesalers and caterers redirected to plates, not bins.", icon: <ScanLine className="size-5" /> },
];

const FAQS: Array<{ q: string; a: string }> = [
  { q: "Who can receive food assistance?", a: "Families and individuals facing financial hardship, homeless neighbours, senior citizens, daily-wage workers in crisis and anyone referred by a partner organisation. A short eligibility review keeps assistance fair." },
  { q: "How do I register?", a: "Apply on this page with your details — you get a reference number immediately and can check your status anytime with your mobile number. No documents are needed to apply." },
  { q: "Is food assistance really free?", a: "Yes. Every kit, meal and grocery pack from UAR is completely free. Nobody will ever ask you to pay." },
  { q: "How can I sponsor a food distribution?", a: "Choose an upcoming distribution below and sponsor it — a complete event, a number of families, or cooked meals. You receive a verified impact report after the event." },
  { q: "Can I donate groceries instead of money?", a: "Yes — use the “Donate groceries” form on this page. Packaged groceries with intact seals and valid expiry are accepted; our logistics team picks them up, inspects them and issues them into tracked stock batches." },
  { q: "How can I volunteer?", a: "Register through the volunteer page — packing, queue management, serving, delivery and coordination roles are all needed." },
  { q: "How does UAR ensure food quality?", a: "Every batch is logged with expiry dates, inspected by trained staff before distribution, and stored per its temperature requirements. Expired or quarantined stock is blocked by the system — it cannot be distributed." },
  { q: "How can an organisation partner with UAR?", a: "Restaurants, grocery stores, wholesalers, hotels, CSR teams and community organisations can write to us — we onboard food partners with a simple verification process." },
];

export function FoodSecurityPage() {
  const [data, setData] = useState<PublicStats | null>(null);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      get<PublicStats>("/api/food/public"),
      get<PublicEvent[]>("/api/food/events?public=1"),
    ]).then(([s, e]) => {
      if (!alive) return;
      if (s.status === "fulfilled") setData(s.value);
      if (e.status === "fulfilled") setEvents(e.value);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const s = data?.stats;
  const upcoming = events.filter((e) => !["COMPLETED", "RECONCILED", "CLOSED"].includes(e.status));
  const recent = events.filter((e) => ["COMPLETED", "RECONCILED", "CLOSED"].includes(e.status));

  return (
    <div>
      {/* ── hero ── */}
      <section className="relative overflow-hidden border-b bg-gradient-to-b from-emerald-500/10 via-transparent to-transparent">
        <div className="relative mx-auto w-full max-w-screen-2xl px-4 py-16 sm:px-6 sm:py-20">
          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
            <Apple className="mr-1 size-3" aria-hidden /> UAR Food Security & Community Nutrition Initiative
          </Badge>
          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            No Family Should{" "}
            <span className="text-emerald-600 dark:text-emerald-400">Go Hungry.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            United Angel Reach works with donors, volunteers, food suppliers, community
            organisations and local partners to provide essential food assistance to
            families and individuals facing hardship.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" className="h-12 bg-emerald-600 px-6 hover:bg-emerald-700" asChild>
              <Link href="/donate">
                <HandHeart className="size-5" aria-hidden /> Donate now
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-6" asChild>
              <Link href="/food-assistance/apply">Request food assistance</Link>
            </Button>
            <Button size="lg" variant="ghost" className="h-12 px-6" asChild>
              <Link href="/volunteer">Become a volunteer</Link>
            </Button>
            <Button size="lg" variant="ghost" className="h-12 px-6" asChild>
              <a href="#distributions">Sponsor a distribution <ArrowRight className="size-4" aria-hidden /></a>
            </Button>
          </div>
        </div>
      </section>

      {/* ── impact statistics — computed from live platform data ── */}
      <Section
        className="border-b bg-muted/30"
        title="Verified, live figures — never estimates"
        subtitle="Every number below is computed from actual platform records at the moment you open this page."
      >
          {loading || !s ? (
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : (
            <>
              <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {[
                  ["Families supported", s.familiesSupported],
                  ["Individuals reached", s.individualsReached],
                  ["Food kits distributed", s.kitsDistributed],
                  ["Meals served", s.mealsServed],
                  ["Distribution locations", s.distributionLocations],
                  ["Completed distributions", s.eventsCompleted],
                  ["Open for registration", s.eventsOpen],
                  ["Active food programmes", s.activeProgrammes],
                  ["Active volunteers", s.activeVolunteers],
                  ["Food donations received", s.totalDonations],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-xl border bg-card p-4 text-center">
                    <dd className="text-2xl font-bold tracking-tight">
                      {(value as number) === 0 ? "—"
                        : label === "Food donations received" ? formatINR(value as number)
                        : formatNumber(value as number)}
                    </dd>
                    <dt className="mt-1 text-xs font-medium text-muted-foreground">{label}</dt>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Reporting period: {data?.reportingPeriod ?? "All time"} · Last updated {formatDate(data?.lastUpdated)} · Aggregate figures only — no beneficiary information is public.
              </p>
            </>
          )}
      </Section>

      {/* ── upcoming distributions ── */}
      <Section
        id="distributions"
        title="Come to a distribution point near you"
        subtitle="Publicly approved distributions. Registration is free and assisted registration is available on site."
      >
          {loading ? (
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}
            </div>
          ) : upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No distributions published right now"
            hint="New events are announced here as soon as they are approved. Apply for assistance below and we will invite you to the next one."
            className="mt-8"
          />
          ) : (
            <ul className="mt-8 grid gap-4 md:grid-cols-3">
              {upcoming.map((e) => {
                const spotsLeft = e.maxCapacity && e.registeredCount != null ? Math.max(0, e.maxCapacity - e.registeredCount) : null;
                return (
                  <li key={e.id} className="flex flex-col rounded-2xl border bg-card p-5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {e.programme?.category?.replace(/_/g, " ").toLowerCase() ?? "food distribution"}
                      </span>
                      <StatusBadge status={e.status} />
                    </div>
                    <h3 className="mt-3 font-semibold leading-snug">{e.title}</h3>
                    <dl className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2"><CalendarDays className="size-4 shrink-0" /><dd>{formatDate(e.eventDate)}{e.startTime ? ` · ${e.startTime}${e.endTime ? `–${e.endTime}` : ""}` : ""}</dd></div>
                      <div className="flex items-center gap-2"><MapPin className="size-4 shrink-0" /><dd>{e.venue}{e.city ? `, ${e.city}` : ""}</dd></div>
                      {spotsLeft != null && (
                        <div className="flex items-center gap-2"><Users className="size-4 shrink-0" /><dd>{spotsLeft} spots left{e.registeredCount ? ` · ${e.registeredCount} registered` : ""}</dd></div>
                      )}
                      {e.registrationDeadline && (
                        <div className="flex items-center gap-2"><Clock className="size-4 shrink-0" /><dd>Register by {formatDate(e.registrationDeadline)}</dd></div>
                      )}
                    </dl>
                    {e.programme?.eligibilityCriteria && (
                      <p className="mt-2 text-xs text-muted-foreground">Eligibility: {e.programme.eligibilityCriteria}</p>
                    )}
                    <div className="mt-4 flex gap-2">
                      {e.registrationOpen && e.status === "REGISTRATION_OPEN" ? (
                        <Button size="sm" className="flex-1" onClick={() => navigate("/food-assistance/apply")}>
                          Register interest
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate(`/donate?event=${e.id}`)}>
                        <HandHeart className="size-4" /> Sponsor
                      </Button>
                    </div>
                    {e.coordinatorPhone && (
                      <p className="mt-3 text-xs text-muted-foreground">Questions? {e.coordinatorName ?? "Coordinator"} · {e.coordinatorPhone}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
      </Section>

      {/* ── our food programmes ── */}
      <Section
        className="border-y bg-muted/30"
        title="Ten ways we make sure food reaches plates"
        subtitle="Programme categories are configurable — new food programmes launch without rebuilding the system."
      >
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PROGRAMMES.map((p) => (
              <li key={p.title} className="group rounded-xl border bg-card p-4 transition-shadow hover:shadow-md">
                <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">{p.icon}</span>
                <h3 className="mt-3 text-sm font-semibold">{p.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.description}</p>
              </li>
            ))}
          </ul>
      </Section>

      {/* ── how it works ── */}
      <Section
        title="From donation to plate, fully tracked"
        subtitle="Every kit is verified at handover with a QR scan — the same discipline as our medicine programme."
      >
          <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Identify", "Communities needing food assistance are identified through applications, referrals and outreach."],
              ["Receive", "Donations of money, groceries and surplus food arrive — every batch is logged with expiry dates."],
              ["Prepare", "Volunteers pack grocery kits and cook meals under food-safety checks."],
              ["Coordinate", "Distribution events are planned, beneficiaries registered, volunteers assigned."],
              ["Verify", "Each handover is verified with a QR code — right person, right package, no duplicates."],
              ["Deliver", "Food reaches families at distribution points or through home delivery."],
              ["Track", "Every kit is tracked from batch to beneficiary — nothing disappears."],
              ["Report", "Verified impact is published here so donors see exactly what their gifts did."],
            ].map(([title, text], i) => (
              <li key={title} className="rounded-xl border bg-card p-4">
                <span className="flex size-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{i + 1}</span>
                <h3 className="mt-2 text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
      </Section>

      {/* ── transparency ── */}
      <Section
        className="border-y bg-muted/30"
        title="Transparency"
        subtitle="Aggregate, verified outcomes — confidential financial detail and beneficiary identities stay private."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border bg-card p-6"><h3 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="size-4 text-emerald-600" /> Campaign transparency</h3><p className="mt-1 text-sm text-muted-foreground">Fundraising progress and utilisation — aggregate only.</p>
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex justify-between"><span>Food donations received</span><strong>{s ? formatINR(s.totalDonations) : "—"}</strong></li>
              <li className="flex justify-between"><span>Completed distributions</span><strong>{s ? s.eventsCompleted : "—"}</strong></li>
              <li className="flex justify-between"><span>Kits delivered</span><strong>{s ? formatNumber(s.kitsDistributed) : "—"}</strong></li>
              <li className="flex justify-between"><span>Meals served</span><strong>{s ? formatNumber(s.mealsServed) : "—"}</strong></li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Detailed financials are shared in approved impact reports and donor statements — never raw beneficiary or payment data.
            </p>
          </div>
          <div className="rounded-2xl border bg-card p-6"><h3 className="flex items-center gap-2 text-base font-semibold"><PackageCheck className="size-4 text-emerald-600" /> Recently served</h3><p className="mt-1 text-sm text-muted-foreground">Aggregate outcomes of completed distributions.</p>
            {recent.length === 0 ? (
              <EmptyState icon={PackageCheck} title="No completed distributions yet" className="border-0" />
            ) : (
              <ul className="mt-4 divide-y">
                {recent.slice(0, 4).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{e.title}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(e.eventDate)} · {e.city ?? e.venue}</p>
                    </div>
                    <StatusBadge status={e.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      {/* ── volunteer + partner + donate food ── */}
      <Section title="Volunteer and partner with us">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border bg-card p-6">
            <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600"><Heart className="size-5" /></span>
            <h2 className="mt-3 text-lg font-semibold">Volunteer with the food programme</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pack kits, manage queues, serve meals, deliver to homebound neighbours or coordinate camps. Register once — pick shifts that fit your week.
            </p>
            <Button className="mt-4" onClick={() => navigate("/volunteer")}>
              Become a volunteer <ArrowRight className="size-4" />
            </Button>
          </div>
          <div className="rounded-2xl border bg-card p-6">
            <span className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"><Building2 className="size-5" /></span>
            <h2 className="mt-3 text-lg font-semibold">Partner with us</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Restaurants, grocery stores, supermarkets, food manufacturers, wholesalers, hotels, corporate CSR teams and community organisations — your surplus and sponsorship become meals with dignity.
            </p>
            <Button variant="outline" className="mt-4" onClick={() => navigate("/contact")}>
              Talk to our team <ArrowRight className="size-4" />
            </Button>
          </div>
          <div className="lg:col-span-2">
            <FoodPledgeSection />
          </div>
        </div>
      </Section>

      {/* ── FAQ ── */}
      <Section
        className="border-t bg-muted/30"
        title="Questions people ask before their first kit"
        subtitle="Everything most applicants and donors want to know."
      >
        <div className="mx-auto max-w-3xl">
          <ul className="mt-8 space-y-2">
            {FAQS.map((f, i) => (
              <li key={f.q} className="overflow-hidden rounded-xl border bg-card">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 p-4 text-left text-sm font-medium"
                  aria-expanded={openFaq === i}
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="flex items-center gap-2"><HelpCircle className="size-4 shrink-0 text-emerald-600" />{f.q}</span>
                  <span aria-hidden="true" className="text-muted-foreground">{openFaq === i ? "−" : "+"}</span>
                </button>
                {openFaq === i && <p className="border-t p-4 text-sm leading-relaxed text-muted-foreground">{f.a}</p>}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button onClick={() => navigate("/food-assistance/apply")}>
              <Apple className="size-4" /> Request food assistance
            </Button>
            <Button variant="outline" onClick={() => navigate("/donate")}>
              <HandHeart className="size-4" /> Donate
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}
