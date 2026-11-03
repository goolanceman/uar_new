"use client";

/**
 * PolicyPage — one component rendering the trust's legal & policy pages
 * by slug: privacy | terms | refunds | tax-exemption | faq.
 *
 * India-specific, trust-branded content (80G / 12A / FCRA notes), a shared
 * grievance-officer block (IT Rules 2011 & DPDP Act 2023 style) and an
 * accordion FAQ. Routes are registered in public-site.tsx.
 */

import * as React from "react";
import { Link } from "@/lib/router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Section } from "@/components/public/shared";
import {
  BadgeCheck,
  FileText,
  HandHeart,
  Heart,
  Landmark,
  LifeBuoy,
  Mail,
  MapPin,
  Phone,
  Receipt,
  ScrollText,
  ShieldCheck,
  Undo2,
  UserCheck,
  type LucideIcon,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

const CARE_EMAIL = "care@unitedangelreach.org";
const LAST_UPDATED = "January 2026";

const LEGAL_LINKS: { slug: string; label: string; icon: LucideIcon }[] = [
  { slug: "privacy", label: "Privacy policy", icon: ShieldCheck },
  { slug: "terms", label: "Terms of use", icon: ScrollText },
  { slug: "refunds", label: "Refund policy", icon: Undo2 },
  { slug: "tax-exemption", label: "Tax exemption (80G)", icon: Landmark },
  { slug: "faq", label: "FAQ", icon: LifeBuoy },
];

/** Grievance officer block — required notice style under IT Rules / DPDP. */
function GrievanceOfficer({ note }: { note?: string }) {
  return (
    <Card className="border-emerald-500/25 bg-emerald-500/10 p-6">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
          <UserCheck className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 text-sm">
          <h3 className="font-semibold text-emerald-800 dark:text-emerald-300">
            Grievance Officer
          </h3>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            Under the Information Technology (Reasonable Security Practices) Rules
            and the Digital Personal Data Protection Act, 2023, United Angel Reach
            Trust has a designated Grievance Officer for complaints and data
            requests.
          </p>
          <ul className="mt-3 space-y-1.5">
            <li className="flex items-center gap-2">
              <Mail className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <a
                href={`mailto:${CARE_EMAIL}?subject=Grievance`}
                className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
              >
                {CARE_EMAIL}
              </a>
            </li>
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <span>
                Grievance Officer, United Angel Reach Trust,
                <br />
                Bengaluru, Karnataka, India
              </span>
            </li>
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            We acknowledge every grievance within 48 hours and resolve it within
            seven working days. {note ?? "Escalations go to the Managing Trustee."}
          </p>
        </div>
      </div>
    </Card>
  );
}

function PolicyProse({ children }: { children: React.ReactNode }) {
  return <div className="max-w-3xl space-y-4 text-sm leading-relaxed text-muted-foreground sm:text-base">{children}</div>;
}

function PolicyHeading({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5 pt-4 text-lg font-bold tracking-tight text-foreground sm:text-xl">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Icon className="size-4" aria-hidden />
      </span>
      {children}
    </h2>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-500" />
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

function LastUpdated() {
  return (
    <p className="text-xs font-medium uppercase tracking-wide text-emerald-100/80">
      Last updated · {LAST_UPDATED}
    </p>
  );
}

/** Cross-links to the other Trust & Legal pages + helpline note. */
function PolicyCrossLinks({ current }: { current: string }) {
  return (
    <Section className="pt-0">
      <Card className="p-5 sm:p-6">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Trust &amp; Legal
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {LEGAL_LINKS.filter((l) => l.slug !== current).map((l) => {
            const Icon = l.icon;
            return (
              <Button key={l.slug} variant="outline" size="sm" className="min-h-[40px]" asChild>
                <Link href={`/${l.slug}`}>
                  <Icon className="size-4" aria-hidden /> {l.label}
                </Link>
              </Button>
            );
          })}
          <Button variant="outline" size="sm" className="min-h-[40px]" asChild>
            <Link href="/contact">
              <Mail className="size-4" aria-hidden /> Contact the care desk
            </Link>
          </Button>
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Phone className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Emergencies are always handled by national helplines first —{" "}
          <a href="tel:112" className="font-semibold hover:underline">112</a> ·{" "}
          <a href="tel:108" className="font-semibold hover:underline">108</a> ·{" "}
          <a href="tel:1098" className="font-semibold hover:underline">1098</a>.
        </p>
      </Card>
    </Section>
  );
}

function PolicyHero({
  icon: Icon,
  title,
  intro,
  chips,
}: {
  icon: LucideIcon;
  title: string;
  intro: string;
  chips: string[];
}) {
  return (
    <section className="bg-emerald-600 text-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <Badge className="border-0 bg-white/15 text-white">
          <Icon className="mr-1 size-3" aria-hidden /> Trust &amp; Legal
        </Badge>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-emerald-50/90 sm:text-base">{intro}</p>
        <div className="mt-4">
          <LastUpdated />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/25"
            >
              {c}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* PRIVACY POLICY                                                      */
/* ------------------------------------------------------------------ */

function PrivacyContent() {
  return (
    <PolicyProse>
      <p>
        United Angel Reach Trust (&ldquo;UAR&rdquo;, &ldquo;we&rdquo;) is a charitable trust
        headquartered in Bengaluru, Karnataka. This policy explains what personal
        information we collect when you donate, volunteer, request support or simply
        browse this website — and exactly what we do with it. The short version:
        <Strong>we collect the minimum needed to deliver help, and we never sell your data.</Strong>
      </p>

      <PolicyHeading icon={FileText}>1. What we collect</PolicyHeading>
      <ul className="space-y-2">
        <Bullet><Strong>Donors:</Strong> name, email, phone, PAN (only if you share it for an 80G receipt), donation amount, payment method and campaign preference. Card and UPI credentials are handled by our payment partners — they are never stored on our servers.</Bullet>
        <Bullet><Strong>Beneficiaries:</Strong> name, contact, family details, category of need, urgency and case notes you share with our verification team. Case records are visible only to authorised case workers and admins.</Bullet>
        <Bullet><Strong>Volunteers &amp; applicants:</Strong> profile details, skills, availability, task attendance and ID verification status shared during onboarding.</Bullet>
        <Bullet><Strong>Everyone:</Strong> technical logs (IP, browser type, pages visited) kept briefly for security and to fix bugs.</Bullet>
      </ul>

      <PolicyHeading icon={ShieldCheck}>2. How we use it</PolicyHeading>
      <ul className="space-y-2">
        <Bullet>Issuing receipts, processing donations and reconciling payments.</Bullet>
        <Bullet>Verifying beneficiary requests and calling you back about the help you asked for.</Bullet>
        <Bullet>Scheduling volunteers, running programmes and reporting audited impact (always in aggregate).</Bullet>
        <Bullet>Legal compliance — Income Tax Act record-keeping, FCRA reporting where applicable, and lawful requests from courts or government agencies.</Bullet>
      </ul>

      <PolicyHeading icon={UserCheck}>3. What we never do</PolicyHeading>
      <ul className="space-y-2">
        <Bullet>We <Strong>never sell, rent or trade</Strong> personal data — with anyone, for any price.</Bullet>
        <Bullet>Beneficiary identities, photos and case details are never published without written, informed consent (we keep photo-consent on file).</Bullet>
        <Bullet>Donor identities stay private unless you choose to appear on public supporter lists — the anonymous-giving option is respected everywhere.</Bullet>
        <Bullet>We do not send marketing spam. Emails you receive relate to your gifts, receipts or programmes you opted into; every message has an opt-out.</Bullet>
      </ul>

      <PolicyHeading icon={BadgeCheck}>4. Your rights (DPDP Act, 2023)</PolicyHeading>
      <p>
        You may ask us to access, correct, complete or erase your personal data, or
        withdraw a consent you previously gave, by writing to our Grievance Officer.
        We verify identity before acting and respond within the statutory timeline.
        Some records (e.g. donation receipts and audited accounts) must be retained
        under tax law even after an account is deleted — we will tell you exactly
        what is kept and why.
      </p>

      <PolicyHeading icon={Landmark}>5. Security &amp; retention</PolicyHeading>
      <p>
        Data is encrypted in transit, access is role-restricted, and every sensitive
        action in the platform is written to an audit log. Donation records are kept
        for the period required by the Income Tax Act; volunteer records for the
        duration of engagement plus statutory limits; beneficiary case files until
        the case is closed and legal retention lapses.
      </p>

      <GrievanceOfficer note="Data-protection requests and complaints both land with the Grievance Officer." />
    </PolicyProse>
  );
}

/* ------------------------------------------------------------------ */
/* TERMS OF USE                                                        */
/* ------------------------------------------------------------------ */

function TermsContent() {
  return (
    <PolicyProse>
      <p>
        These terms govern your use of the United Angel Reach website and portals
        (the &ldquo;Platform&rdquo;). By using the Platform you accept them. If you
        disagree with any part, please stop using the Platform and write to us —
        we will still help you offline, because that is the whole point of the trust.
      </p>

      <PolicyHeading icon={Heart}>1. Donations</PolicyHeading>
      <ul className="space-y-2">
        <Bullet>All donations are <Strong>voluntary contributions</Strong> to a registered charitable trust — they are not payment for goods or services, and no quid pro quo is offered.</Bullet>
        <Bullet>Online gifts (UPI, gateway) are recorded immediately; offline gifts (cash, bank transfer, cheque) are recorded as pending until a staff member verifies the instrument — typically within two working days.</Bullet>
        <Bullet>Gifts are directed to the campaign you choose, or to the general fund, which our trustees allocate weekly to the highest-need programme. Allocations are reported publicly every quarter.</Bullet>
        <Bullet>Please do not attempt unverified chargebacks; raise a concern first (see the refund policy) — we resolve quickly and in writing.</Bullet>
      </ul>

      <PolicyHeading icon={HandHeart}>2. Beneficiary requests</PolicyHeading>
      <ul className="space-y-2">
        <Bullet>Submitting a help request is free and never guarantees assistance; every request passes a verification step by our case team, and resources are allocated by need and availability.</Bullet>
        <Bullet>You agree to give truthful information. Deliberately false claims divert help away from families who need it — we may decline service in such cases.</Bullet>
        <Bullet>Support is delivered by background-verified volunteers and recorded against QR-traced batches; you may always ask the volunteer for their ID card and receipt book.</Bullet>
      </ul>

      <PolicyHeading icon={UserCheck}>3. Volunteers</PolicyHeading>
      <ul className="space-y-2">
        <Bullet>Volunteers act as ambassadors of the trust. You consent to background verification, to our code of conduct (no proselytising, no photography without consent, no handling of funds outside receipt books) and to honest attendance records.</Bullet>
        <Bullet>Volunteer status may be paused or revoked for safety violations. That decision is explainable on request — write to the Grievance Officer.</Bullet>
      </ul>

      <PolicyHeading icon={ShieldCheck}>4. Platform content &amp; acceptable use</PolicyHeading>
      <ul className="space-y-2">
        <Bullet>The Platform, its playbooks, reports and content are the property of United Angel Reach Trust. Field playbooks may be reused by other non-profits with attribution — that is deliberate; data-scraping, republishing beneficiary material or misrepresenting affiliation with UAR is not permitted.</Bullet>
        <Bullet>Do not attempt to breach security, scrape personal data, upload malicious code or misuse the assistant. We log and report abuse.</Bullet>
        <Bullet>The Platform is provided &ldquo;as is&rdquo;. We work hard on accuracy, but statistics on public pages are aggregates that update on cycles and may lag reality.</Bullet>
      </ul>

      <PolicyHeading icon={Landmark}>5. Governing law</PolicyHeading>
      <p>
        These terms are governed by the laws of India. Disputes are subject to the
        exclusive jurisdiction of the courts of Bengaluru, Karnataka. Nothing here
        affects your statutory rights as a donor or a consumer.
      </p>

      <GrievanceOfficer note="Concerns about conduct, content or misuse of the Platform also reach the Grievance Officer." />
    </PolicyProse>
  );
}

/* ------------------------------------------------------------------ */
/* REFUND POLICY                                                       */
/* ------------------------------------------------------------------ */

function RefundsContent() {
  return (
    <PolicyProse>
      <p>
        Donations to United Angel Reach Trust are spent on verified, ongoing
        programmes, so we treat them as final. That said, mistakes happen — and
        when they do, we make them right quickly and in full.
      </p>

      <PolicyHeading icon={Undo2}>1. When we refund</PolicyHeading>
      <ul className="space-y-2">
        <Bullet><Strong>Accidental or duplicate donations</Strong> — wrong amount, paid twice, or a keying error. Reported within <Strong>48 hours</Strong> of the transaction, refunded in full.</Bullet>
        <Bullet><Strong>Fraudulent use of your card or account</Strong> — refunded in full after you share the transaction reference; we also file the cyber complaint with you (1930) because that helps everyone.</Bullet>
        <Bullet><Strong>Failed or interrupted gateway transactions</Strong> — if money left your account but no receipt was generated, the gateway auto-reverses within 5–7 working days; if it does not, we push the reconciliation for you.</Bullet>
        <Bullet><Strong>Designated campaigns</Strong> — if a specific campaign is cancelled or cannot accept further funds, earmarked donations are redirected with your consent or refunded on request.</Bullet>
      </ul>

      <PolicyHeading icon={Receipt}>2. Refunds and your 80G receipt</PolicyHeading>
      <p>
        If a refund happens after an 80G receipt was issued, the receipt is
        cancelled in our books and a credit note is issued — please do not claim
        the refunded amount as a deduction. Your records stay clean and audited,
        which protects you as much as it protects the trust.
      </p>

      <PolicyHeading icon={Mail}>3. How to request one</PolicyHeading>
      <ul className="space-y-2">
        <Bullet>Email <a className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400" href={`mailto:${CARE_EMAIL}?subject=Donation%20refund%20request`}>{CARE_EMAIL}</a> with the receipt number (or UTR / transaction ID), the date, the amount and a one-line reason.</Bullet>
        <Bullet>We acknowledge within one working day, verify, and complete approved refunds to the <Strong>original payment instrument</Strong> within <Strong>7–10 working days</Strong>.</Bullet>
        <Bullet>Cash donations collected by volunteers are refunded from the trust account by bank transfer after verification of the numbered counterfoil.</Bullet>
      </ul>

      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-800 dark:text-amber-300">
        <p className="font-semibold">Please note</p>
        <p className="mt-1">
          Donations already spent on a verified delivery (an assembled ration kit,
          adopted medicines, a completed corridor mission) cannot be selectively
          refunded — but any <em>processing error</em> on our side is always refunded,
          regardless of programme stage.
        </p>
      </div>

      <GrievanceOfficer note="Unresolved refund disputes escalate to the Managing Trustee, then to banking-ombudsman channels with our full cooperation." />
    </PolicyProse>
  );
}

/* ------------------------------------------------------------------ */
/* TAX EXEMPTION (80G)                                                 */
/* ------------------------------------------------------------------ */

function TaxExemptionContent() {
  return (
    <PolicyProse>
      <p>
        United Angel Reach Trust is registered under <Strong>Section 12A/12AB</Strong> of
        the Income Tax Act, 1961, and donations to it qualify for deduction under{" "}
        <Strong>Section 80G</Strong>. In plain words: if you pay tax in India, half of
        what you donate can be deducted from your taxable income.
      </p>

      <PolicyHeading icon={Landmark}>1. How the 80G deduction works</PolicyHeading>
      <ul className="space-y-2">
        <Bullet>Qualifying donations get a <Strong>50% deduction</Strong>, subject to the limits in Section 80G (adjusted gross income thresholds for some slabs).</Bullet>
        <Bullet>The deduction is claimed <Strong>while filing your income-tax return</Strong> for the relevant financial year — keep the receipt; your CA will know what to do with it.</Bullet>
        <Bullet>Your employer may also require the trust&rsquo;s PAN and registration details for matching donation records — all of it is printed on the receipt.</Bullet>
      </ul>

      <PolicyHeading icon={Receipt}>2. Getting your receipt</PolicyHeading>
      <ul className="space-y-2">
        <Bullet>Online gifts (UPI / gateway) generate a numbered receipt instantly — download it from the thank-you screen or find it in the receipts list in your donor portal.</Bullet>
        <Bullet>Offline gifts (cash, bank transfer, cheque) are receipted after verification by our team — usually within <Strong>two working days</Strong>.</Bullet>
        <Bullet>Add your <Strong>PAN</Strong> while donating and the receipt is issued tax-ready with your PAN printed on it. Without PAN, the receipt is still valid, but the deduction can be disallowed.</Bullet>
        <Bullet>Every receipt carries the trust&rsquo;s name, address, PAN and 80G registration number, the amount in words, and the signature block of the authorised signatory.</Bullet>
      </ul>

      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-800 dark:text-amber-300">
        <p className="font-semibold">One important rule about cash</p>
        <p className="mt-1">
          Under the Income Tax Act, <Strong>cash donations above ₹2,000 do not qualify
          for any 80G deduction</Strong>. Cash up to ₹2,000, and all non-cash modes
          (UPI, bank transfer, cheque, gateway), qualify normally. If you are giving
          a larger gift, please use a banking channel — it is safer for you and for
          our auditors.
        </p>
      </div>

      <PolicyHeading icon={BadgeCheck}>3. Our registration numbers</PolicyHeading>
      <p>
        The trust&rsquo;s PAN, 80G registration number and 12A/12AB registration
        number are published on the{" "}
        <Link href="/about" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
          About page
        </Link>{" "}
        under Legal &amp; Financial transparency, and appear on every receipt and
        certificate we issue. Write to{" "}
        <a className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400" href={`mailto:${CARE_EMAIL}`}>{CARE_EMAIL}</a>{" "}
        with &ldquo;Registration documents&rdquo; in the subject for certified copies.
      </p>

      <PolicyHeading icon={ShieldCheck}>4. A note on foreign contributions</PolicyHeading>
      <p>
        Donations from foreign sources are regulated by the <Strong>Foreign
        Contribution (Regulation) Act, 2010 (FCRA)</Strong>. If you are a non-Indian
        citizen, an NRI without an Indian-income source, or a foreign entity, please
        contact us <Strong>before</Strong> donating so we can route your gift in full
        compliance with FCRA. Indian citizens donating from Indian income can give
        through every normal channel.
      </p>

      <GrievanceOfficer note="Receipt corrections, PAN updates and duplicate-receipt requests are handled by the same desk." />
    </PolicyProse>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "How much of my donation actually reaches programmes?",
    a: (
      <>
        At least 92 paise of every rupee goes directly to programme delivery. Our
        administration stays under 8%, procurement happens wholesale, and the split
        is published in the audited annual accounts (80G · 12A registered). Quarter
        by quarter, utilisation is reported publicly on the{" "}
        <Link href="/impact" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">impact page</Link>.
      </>
    ),
  },
  {
    q: "Is my donation eligible for tax exemption?",
    a: (
      <>
        Yes — UAR is a 12A/12AB registered charitable trust and donations qualify
        for 50% deduction under Section 80G. Add your PAN while donating and the
        receipt is issued tax-ready. Note the legal cap: cash gifts above ₹2,000
        are not eligible for 80G. Full details on the{" "}
        <Link href="/tax-exemption" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">tax exemption page</Link>.
      </>
    ),
  },
  {
    q: "How do I get my 80G receipt?",
    a: (
      <>
        Online gifts receive a numbered, print-ready receipt instantly on the
        thank-you screen. Offline gifts (cash, bank transfer, cheque) are verified
        by our team within two working days and the receipt is issued after that
        verification. Donors signed in with the same email can always re-download
        past receipts.
      </>
    ),
  },
  {
    q: "Can I donate monthly instead of once?",
    a: (
      <>
        Please do — monthly commitments are what let us promise a family a year of
        ration kits or a patient a year of medicines. Choose &ldquo;Monthly&rdquo;
        on the{" "}
        <Link href="/donate" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">donate page</Link>{" "}
        and we will track it, receipt each instalment and report the cumulative
        impact back to you.
      </>
    ),
  },
  {
    q: "How do you verify beneficiaries before helping?",
    a: (
      <>
        Every request is screened by our case team — phone verification, need
        assessment and, for ongoing cases, a household visit by a background-verified
        volunteer. Support is delivered against numbered receipts and QR-scanned at
        the door; an unscanned kit triggers an audit, never a shrug.
      </>
    ),
  },
  {
    q: "Can I donate goods — clothes, groceries, medicines?",
    a: (
      <>
        We accept specific, in-date, quality-checked goods for our inventory drives
        (ration staples, sanitary pads, new medicines with intact packaging). Please
        write to {CARE_EMAIL} first with what you have and your city — a coordinator
        will confirm what is needed this month so nothing is wasted.
      </>
    ),
  },
  {
    q: "What is your refund policy?",
    a: (
      <>
        Donations are generally final, but accidental or duplicate payments reported
        within 48 hours, gateway failures and fraud are refunded in full within
        7–10 working days. See the{" "}
        <Link href="/refunds" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">refund policy</Link>{" "}
        for the complete process.
      </>
    ),
  },
  {
    q: "Is my payment and data secure?",
    a: (
      <>
        Payments run through established Indian gateways and UPI — card and UPI
        credentials never touch our servers. Personal data is role-restricted,
        audit-logged and never sold; our privacy policy follows the Digital
        Personal Data Protection Act, 2023, with a designated Grievance Officer.
      </>
    ),
  },
  {
    q: "How can I volunteer?",
    a: (
      <>
        Register on the{" "}
        <Link href="/volunteer" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">volunteer page</Link>{" "}
        with your skills and availability. After a short background verification you
        get portal access with assigned tasks — distributions, kit scanning, pad-bank
        restocks, corridor drills or awareness sessions. Two hours a month is a real
        contribution.
      </>
    ),
  },
  {
    q: "Someone needs help right now — what do I do?",
    a: (
      <>
        National helplines come first, always: <strong>112</strong> (emergency),{" "}
        <strong>108</strong> (ambulance), <strong>1098</strong> (CHILDLINE),{" "}
        <strong>181</strong> (women), <strong>14446</strong> (de-addiction),{" "}
        <strong>1930</strong> (cyber fraud). Then send us a request through the
        beneficiary portal or the contact page — our case team calls back within 48
        hours.
      </>
    ),
  },
  {
    q: "How can I trust where the money goes?",
    a: (
      <>
        Three words: receipts, scans, audits. Every rupee is receipted, every
        physical delivery is QR-traced to a door, and the books are audited and
        published yearly. Registrations (80G, 12A, NGO Darpan) are public on the{" "}
        <Link href="/about" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">About page</Link>,
        and the quarterly utilisation note appears on the impact dashboard.
      </>
    ),
  },
];

function FaqContent() {
  return (
    <div className="max-w-3xl">
      <Accordion type="single" collapsible className="w-full">
        {FAQS.map((f, i) => (
          <AccordionItem key={i} value={`faq-${i}`}>
            <AccordionTrigger className="text-left text-sm font-semibold sm:text-base">
              {f.q}
            </AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
              {f.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <Card className="mt-8 border-emerald-500/25 bg-emerald-500/10 p-5">
        <p className="text-sm leading-relaxed">
          <LifeBuoy className="mr-1.5 inline size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Not answered here? Write to{" "}
          <a
            href={`mailto:${CARE_EMAIL}`}
            className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
          >
            {CARE_EMAIL}
          </a>{" "}
          or use the{" "}
          <Link href="/contact" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
            contact form
          </Link>{" "}
          — the care desk replies within two working days.
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Registry + root component                                           */
/* ------------------------------------------------------------------ */

const POLICIES: Record<
  string,
  {
    icon: LucideIcon;
    title: string;
    intro: string;
    chips: string[];
    content: React.ReactNode;
  }
> = {
  privacy: {
    icon: ShieldCheck,
    title: "Privacy policy",
    intro:
      "How United Angel Reach collects, uses and protects personal data — written in plain language, compliant with India's DPDP Act, 2023.",
    chips: ["DPDP Act 2023", "No data selling", "Grievance Officer"],
    content: <PrivacyContent />,
  },
  terms: {
    icon: ScrollText,
    title: "Terms of use",
    intro:
      "The ground rules for donating, requesting support and volunteering on the UAR platform — fair, short and readable.",
    chips: ["Donations", "Beneficiary requests", "Volunteer conduct"],
    content: <TermsContent />,
  },
  refunds: {
    icon: Undo2,
    title: "Refund policy",
    intro:
      "Donations are final once spent — but errors, fraud and failed transactions are refunded in full, quickly and in writing.",
    chips: ["48-hour window", "7–10 working days", "Written resolution"],
    content: <RefundsContent />,
  },
  "tax-exemption": {
    icon: Landmark,
    title: "Tax exemption — Section 80G",
    intro:
      "Everything about 80G receipts, PAN, cash limits and our 12A/12AB registration — so your CA never has to chase paperwork.",
    chips: ["80G · 50% deduction", "12A/12AB registered", "PAN-ready receipts"],
    content: <TaxExemptionContent />,
  },
  faq: {
    icon: LifeBuoy,
    title: "Frequently asked questions",
    intro:
      "The questions donors, families and volunteers ask us most — answered the way we'd answer over a cup of chai.",
    chips: ["11 answers", "Receipts & 80G", "Verification"],
    content: <FaqContent />,
  },
};

export function PolicyPage({ slug }: { slug: string }) {
  const policy = POLICIES[slug];

  if (!policy) {
    return (
      <Section className="py-16">
        <div className="mx-auto max-w-lg text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted">
            <FileText className="size-7 text-muted-foreground" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Document not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn&rsquo;t find that policy page. Pick one of the Trust &amp; Legal
            documents below.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {LEGAL_LINKS.map((l) => (
              <Button key={l.slug} variant="outline" size="sm" asChild>
                <Link href={`/${l.slug}`}>{l.label}</Link>
              </Button>
            ))}
          </div>
        </div>
      </Section>
    );
  }

  const Icon = policy.icon;

  return (
    <>
      <PolicyHero
        icon={Icon}
        title={policy.title}
        intro={policy.intro}
        chips={policy.chips}
      />
      <Section className="py-10 sm:py-12">
        {policy.content}
        <Separator className="my-10" />
      </Section>
      <PolicyCrossLinks current={slug} />
    </>
  );
}
