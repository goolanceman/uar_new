"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Baby,
  BookOpenCheck,
  ChevronDown,
  Droplets,
  HandHeart,
  HeartHandshake,
  Info,
  LifeBuoy,
  MessageCircle,
  Package,
  PackageOpen,
  PawPrint,
  Phone,
  Pill,
  Send,
  Shield,
  ShieldAlert,
  Siren,
  Sprout,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useMasters, labelOf } from "@/hooks/use-masters";
import type { SessionUser } from "@/hooks/use-auth";
import { get, post } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatDate, formatDateTime, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { phoneRule, minLen, required, fieldError } from "@/lib/validators";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  FieldGrid,
  TextField,
  TextareaField,
  SelectField,
} from "@/components/shared/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/* Official helplines — numbers per CONVENTIONS.md */
const HELPLINES: { num: string; label: string; desc: string }[] = [
  { num: "112", label: "Emergency", desc: "Police · Fire · National" },
  { num: "108", label: "Ambulance", desc: "Free emergency response" },
  { num: "1098", label: "Child safety", desc: "CHILDLINE 24×7" },
  { num: "181", label: "Women safety", desc: "Sakhi / Abhayam support" },
];

const URGENCIES: { value: string; label: string }[] = [
  { value: "LOW", label: "Can wait a few days" },
  { value: "MEDIUM", label: "Within this week" },
  { value: "HIGH", label: "Urgent — this affects us now" },
  { value: "CRITICAL", label: "Critical — need help today" },
];

/** Row returned by GET /api/beneficiary-requests?mine=1 */
interface RequestRow {
  id: string;
  name: string;
  phone?: string | null;
  category: string;
  urgency: string;
  details: string;
  status: string; // PENDING | IN_REVIEW | APPROVED | FULFILLED | REJECTED
  reviewNote?: string | null;
  createdAt: string;
}

interface BeneficiaryRow {
  id: string;
  name: string;
  category: string;
  urgencyLevel: string;
  familyMembers?: number;
  city?: string | null;
  userId?: string | null;
  email?: string | null;
}

interface Distribution {
  id: string;
  type: string;
  quantity: number;
  beneficiaryId?: string | null;
  location?: string | null;
  distributedAt: string;
}

const PROGRAMMES: {
  key: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  iconClass: string;
  borderClass: string;
}[] = [
  {
    key: "ration",
    title: "Ration kits",
    desc: "Monthly groceries for families in distress — QR-tracked from our store to your door.",
    icon: Package,
    iconClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    borderClass: "hover:border-emerald-500/40",
  },
  {
    key: "medicine",
    title: "Adopt-a-Medicine",
    desc: "Donors fund monthly medicines for BP, diabetes and cardiac patients — you never skip a dose.",
    icon: Pill,
    iconClass: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
    borderClass: "hover:border-teal-500/40",
  },
  {
    key: "women",
    title: "Women safety",
    desc: "Sakhi desks, self-defence drives and the 181 Abhayam network across Bengaluru.",
    icon: Shield,
    iconClass: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400",
    borderClass: "hover:border-fuchsia-500/40",
  },
  {
    key: "child",
    title: "Child safety",
    desc: "CHILDLINE outreach, school awareness and safe-space programmes for children.",
    icon: Baby,
    iconClass: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    borderClass: "hover:border-amber-500/40",
  },
  {
    key: "animals",
    title: "Animal welfare",
    desc: "Rescue, vaccination and sterilisation drives for street animals with our shelter partners.",
    icon: PawPrint,
    iconClass: "bg-lime-500/15 text-lime-700 dark:text-lime-400",
    borderClass: "hover:border-lime-500/40",
  },
  {
    key: "green-corridor",
    title: "Green corridor",
    desc: "Ambulances with smart traffic corridors reach hospitals minutes faster in emergencies.",
    icon: Siren,
    iconClass: "bg-red-500/15 text-red-700 dark:text-red-400",
    borderClass: "hover:border-red-500/40",
  },
  {
    key: "anti-drug",
    title: "Anti-drug outreach",
    desc: "Confidential de-addiction counselling, 14446 referrals and community awareness.",
    icon: ShieldAlert,
    iconClass: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    borderClass: "hover:border-orange-500/40",
  },
];

interface RequestForm {
  name: string;
  phone: string;
  category: string;
  urgency: string;
  details: string;
}

type RequestErrors = Partial<Record<keyof RequestForm, string | null>>;

/** Support programmes a beneficiary can apply for -- distinct from the
 *  BENEFICIARY_CATEGORY master (which records who they are, e.g. "Widow",
 *  "Student"). Selecting one tags the free-text details so the case team
 *  can route the request to the right programme immediately. */
const SUPPORT_PROGRAMMES: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "Ration & food kits", label: "Ration / food kit", icon: Package },
  { key: "Sanitary pads", label: "Sanitary pads", icon: Droplets },
  { key: "Adopt-a-Medicine", label: "Medicines", icon: Pill },
  { key: "Education support", label: "Education support", icon: BookOpenCheck },
  { key: "Animal welfare", label: "Animal welfare", icon: PawPrint },
  { key: "Other support", label: "Other", icon: HandHeart },
];

interface AwarenessTopic {
  key: string;
  title: string;
  icon: LucideIcon;
  iconClass: string;
  helpline: { num: string; label: string };
  points: string[];
  askPrompt: string;
}

const AWARENESS_TOPICS: AwarenessTopic[] = [
  {
    key: "cyber",
    title: "Cyber crime awareness",
    icon: ShieldAlert,
    iconClass: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
    helpline: { num: "1930", label: "Cyber fraud helpline" },
    points: [
      "If money is stolen via UPI/bank fraud, call 1930 immediately -- the first hour (the 'golden hour') is when banks can still freeze the transaction.",
      "Never share your OTP, UPI PIN, or CVV with anyone -- banks and the police never ask for these over phone or SMS.",
      "Report any cyber crime at cybercrime.gov.in, or use the Chakshu portal to report a fraud call/SMS.",
      "Be suspicious of 'you've won a prize', fake job offers, and KYC-update calls -- they are the most common tricks.",
    ],
    askPrompt: "Tell me what to do if I think I'm a victim of cyber fraud or a UPI scam.",
  },
  {
    key: "anti-drug",
    title: "Anti-drug awareness",
    icon: Sprout,
    iconClass: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    helpline: { num: "14446", label: "De-addiction helpline" },
    points: [
      "Addiction is a health condition, not a crime -- judgement-free help is available for the person and their family.",
      "Call the National De-addiction Helpline 14446 (toll-free, confidential) for counselling and rehab referrals.",
      "Tele-MANAS 14416 offers 24x7 mental health support, including for family members under stress.",
      "To report drug trafficking or peddling anonymously, call 1933.",
    ],
    askPrompt: "A family member may be using drugs -- how do I help them, step by step?",
  },
  {
    key: "child",
    title: "Child safety",
    icon: Baby,
    iconClass: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    helpline: { num: "1098", label: "CHILDLINE (24x7)" },
    points: [
      "CHILDLINE 1098 is a free, 24x7 helpline for any child in distress or danger, anywhere in India.",
      "Teach children the 'underwear rule': no one should touch the parts covered by their underwear, and they should tell a trusted adult if someone tries.",
      "POCSO (Protection of Children from Sexual Offences Act) cases can be reported confidentially -- schools and police must act immediately.",
      "Online: watch for strangers contacting children on games/social apps and report suspicious accounts right away.",
    ],
    askPrompt: "How do I teach my child to stay safe, and what do I do if something happened?",
  },
];

export default function BeneficiaryHub({ user }: { user: SessionUser }) {
  const { options: categoryOptions } = useMasters("BENEFICIARY_CATEGORY");

  const [form, setForm] = useState<RequestForm>({
    name: user.name ?? "",
    phone: user.phone ?? "",
    category: "",
    urgency: "MEDIUM",
    details: "",
  });
  const [errors, setErrors] = useState<RequestErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [caseRow, setCaseRow] = useState<BeneficiaryRow | null>(null);
  const [received, setReceived] = useState<Distribution[]>([]);
  const [loadingCase, setLoadingCase] = useState(true);
  const [selectedProgramme, setSelectedProgramme] = useState<string | null>(null);
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const setField = (key: keyof RequestForm) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    setErrors((e) => (e[key] ? { ...e, [key]: null } : e));
  };

  // ── My requests — real backend, no localStorage ──────────────────────────
  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const rows = await get<unknown>("/api/beneficiary-requests?mine=1");
      setRequests(Array.isArray(rows) ? (rows as RequestRow[]) : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load your requests");
      setRequests([]);
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  // ── Case record + support received ────────────────────────────────────────
  const loadCase = useCallback(async () => {
    setLoadingCase(true);
    try {
      const rows = await get<unknown>("/api/beneficiaries?mine=1").catch(() => []);
      const list = Array.isArray(rows) ? (rows as BeneficiaryRow[]) : [];
      const mine =
        list.find((r) => r.userId === user.id) ??
        list.find(
          (r) => r.email && user.email && r.email.toLowerCase() === user.email.toLowerCase()
        ) ??
        list[0] ??
        null;
      setCaseRow(mine);
      if (mine) {
        const dists = await get<unknown>("/api/distributions?limit=200").catch(() => {
          toast.error("Could not load your support history right now");
          return [];
        });
        const list2 = Array.isArray(dists) ? (dists as Distribution[]) : [];
        setReceived(list2.filter((d) => d.beneficiaryId === mine.id).slice(0, 10));
      } else {
        setReceived([]);
      }
    } finally {
      setLoadingCase(false);
    }
  }, [user.id, user.email]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    void loadCase();
  }, [loadCase]);

  const submit = async () => {
    const errs: RequestErrors = {
      name: fieldError(form.name, [required("Name")]),
      phone: fieldError(form.phone, [phoneRule(true)]),
      category: fieldError(form.category, [required("Help type")]),
      details: fieldError(form.details, [minLen(10, "Details")]),
    };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      toast.error("Please complete the highlighted fields");
      return;
    }
    setSubmitting(true);
    try {
      const details = selectedProgramme
        ? `[Programme: ${selectedProgramme}] ${form.details.trim()}`
        : form.details.trim();
      await post("/api/beneficiary-requests", {
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        category: form.category,
        urgency: form.urgency,
        details,
      });
      toast.success(
        "Request received — our case team will call you within 48 hours. Keep your phone nearby."
      );
      setForm((f) => ({ ...f, category: "", urgency: "MEDIUM", details: "" }));
      setSelectedProgramme(null);
      await loadRequests();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send your request");
    } finally {
      setSubmitting(false);
    }
  };

  const categoryLabel = (value: string) =>
    categoryOptions.find((o) => o.value === value)?.label ?? titleCase(value);

  const pickProgramme = (key: string) => {
    setSelectedProgramme(key);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const askAngel = (question: string) => {
    window.dispatchEvent(new CustomEvent("angel:ask", { detail: { question } }));
  };

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <PageHeader
        title={`Namaste, ${user.name.split(" ")[0]}`}
        description="We're here for you — no judgement, only help. United Angel Reach supports families with ration kits, medicines, women & child safety, animal rescue and emergency ambulance corridors."
        icon={<HeartHandshake className="size-5" />}
      />

      {/* Case record */}
      <SectionCard
        title="Your case record"
        description="How our team has you registered"
        icon={<HandHeart className="size-5" />}
      >
        {loadingCase ? (
          <div className="space-y-2" aria-label="Loading case record">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-5 w-72" />
          </div>
        ) : caseRow ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Registered as </span>
              <span className="font-semibold">{caseRow.name}</span>
              <span className="text-muted-foreground">
                {" "}
                · {categoryLabel(caseRow.category)}
                {caseRow.city ? ` · ${caseRow.city}` : ""}
              </span>
            </p>
            <p className="flex items-center gap-2">
              <span className="text-muted-foreground">Urgency on file:</span>
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full text-[10px]",
                  (caseRow.urgencyLevel === "HIGH" || caseRow.urgencyLevel === "CRITICAL")
                    ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                )}
              >
                {titleCase(caseRow.urgencyLevel)}
              </Badge>
            </p>
          </div>
        ) : (
          <EmptyState
            icon={<HandHeart className="size-5" />}
            title="Case record not linked yet"
            hint="That's okay — send a request below and our team will register you and call within 48 hours."
          />
        )}
      </SectionCard>

      {/* Support received */}
      <SectionCard
        title="Support you've received"
        description="Distributions recorded for your family"
        icon={<PackageOpen className="size-5" />}
      >
        {loadingCase ? (
          <div className="space-y-3" aria-label="Loading support history">
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : !caseRow || received.length === 0 ? (
          <EmptyState
            icon={<PackageOpen className="size-5" />}
            title={caseRow ? "Nothing recorded yet" : "Linked after your first delivery"}
            hint={
              caseRow
                ? "When a volunteer hands over a kit or support to your family, it shows up here."
                : "Once our team links your case, every delivery you receive is listed here."
            }
          />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto scrollbar-thin">
            {received.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <PackageOpen className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{titleCase(d.type)} support</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(d.distributedAt)}
                    {d.location ? ` · ${d.location}` : ""}
                  </p>
                </div>
                <p className="text-sm font-bold">×{d.quantity}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Apply for a support programme */}
      <SectionCard
        title="Apply for a support programme"
        description="Tap the programme you need — it tags your request below so our case team routes it straight away."
        icon={<Package className="size-5" />}
      >
        <div className="flex flex-wrap gap-2">
          {SUPPORT_PROGRAMMES.map((p) => {
            const Icon = p.icon;
            const active = selectedProgramme === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => pickProgramme(p.key)}
                aria-pressed={active}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "bg-card hover:border-primary/40 hover:bg-accent"
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {p.label}
              </button>
            );
          })}
        </div>
        {selectedProgramme && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5 shrink-0" aria-hidden="true" />
            Applying for <strong className="text-foreground">{selectedProgramme}</strong> — fill in
            the form below and send. You can change this anytime before sending.
          </p>
        )}
      </SectionCard>

      {/* Need help form */}
      <SectionCard
        title="Need help?"
        description="Tell us what you need — a case worker calls you back within 48 hours. There is no fee and no paperwork needed to ask."
        icon={<HandHeart className="size-5" />}
      >
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
          className="space-y-4"
        >
          <FieldGrid>
            <TextField
              label="Your name"
              required
              value={form.name}
              onChange={setField("name")}
              error={errors.name}
              placeholder="Full name"
            />
            <SelectField
              label="Your situation (helps us prioritise)"
              required
              value={form.category}
              onChange={(v) => setField("category")(v)}
              error={errors.category}
              options={categoryOptions}
              placeholder="e.g. Widow, Student, Daily wage worker…"
            />
            <TextField
              label="Contact phone"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={setField("phone")}
              error={errors.phone}
              hint="Optional — helps our case team call you back"
              placeholder="+91 98765 43210"
            />
            <SelectField
              label="How urgent is it?"
              value={form.urgency}
              onChange={(v) => setField("urgency")(v)}
              options={URGENCIES}
              placeholder="Select urgency"
            />
          </FieldGrid>
          <TextareaField
            label="Describe your need"
            required
            rows={4}
            value={form.details}
            onChange={setField("details")}
            error={errors.details}
            hint="Only our case team reads this. We never share your details publicly."
            placeholder="e.g. Family of four in BTM Layout, lost daily-wage income this month, need ration support…"
          />
          <Button type="submit" className="min-h-11 gap-1.5" disabled={submitting}>
            <Send className="size-4" aria-hidden="true" />
            {submitting ? "Sending…" : "Send request"}
          </Button>
        </form>
      </SectionCard>

      {/* My requests */}
      <SectionCard
        title="My requests"
        description="Sent from your account — our case team updates you by phone"
        icon={<Send className="size-5" />}
      >
        {loadingRequests ? (
          <div className="space-y-3" aria-label="Loading your requests">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : requests.length === 0 ? (
          <EmptyState
            icon={<Send className="size-5" />}
            title="No requests yet"
            hint="Whenever you send one above, it's listed here so you can track what you asked for."
          />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto scrollbar-thin">
            {requests.map((r) => (
              <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{categoryLabel(r.category)}</p>
                  <StatusBadge status={r.status} />
                  <span className="text-[11px] text-muted-foreground">
                    Submitted {formatDateTime(r.createdAt)} · urgency {titleCase(r.urgency)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.details}</p>
                {r.reviewNote ? (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-muted/60 p-2 text-xs leading-relaxed">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <span>
                      <span className="font-semibold">Case team note:</span> {r.reviewNote}
                    </span>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Helplines */}
      <section aria-label="Emergency helplines">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <LifeBuoy className="size-4" aria-hidden="true" /> Tap to call — free
          national helplines
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {HELPLINES.map((h) => (
            <a
              key={h.num}
              href={`tel:${h.num}`}
              className="group flex min-h-11 flex-col gap-0.5 rounded-xl border bg-card p-4 shadow-sm outline-none transition hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Call ${h.label} on ${h.num}`}
            >
              <span className="flex items-center gap-2">
                <Phone
                  className="size-4 text-primary transition-transform group-hover:scale-110"
                  aria-hidden="true"
                />
                <span className="text-xl font-bold tabular-nums">{h.num}</span>
              </span>
              <span className="text-sm font-medium">{h.label}</span>
              <span className="text-xs text-muted-foreground">{h.desc}</span>
            </a>
          ))}
        </div>
      </section>

      {/* Awareness & Safety library (Help Center) */}
      <section aria-label="Awareness and safety library">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Shield className="size-4" aria-hidden="true" /> Help Center — Awareness & Safety
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Read any topic below for key facts and helpline numbers — or tap &quot;Ask Angel&quot;
          for a personal, judgement-free conversation about your situation.
        </p>
        <div className="space-y-3">
          {AWARENESS_TOPICS.map((t) => {
            const Icon = t.icon;
            const isOpen = openTopic === t.key;
            return (
              <div key={t.key} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <button
                  type="button"
                  onClick={() => setOpenTopic(isOpen ? null : t.key)}
                  aria-expanded={isOpen}
                  className="flex w-full min-h-11 items-center gap-3 p-4 text-left transition hover:bg-accent/50"
                >
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", t.iconClass)}>
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{t.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      Helpline {t.helpline.num} · {t.helpline.label}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")}
                    aria-hidden="true"
                  />
                </button>
                {isOpen && (
                  <div className="border-t bg-muted/30 p-4">
                    <ul className="space-y-2">
                      {t.points.map((pt, i) => (
                        <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <a
                        href={`tel:${t.helpline.num}`}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition hover:border-primary/40 hover:bg-accent"
                      >
                        <Phone className="size-3.5 text-primary" aria-hidden="true" />
                        Call {t.helpline.num}
                      </a>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-11 gap-1.5 sm:min-h-9"
                        onClick={() => askAngel(t.askPrompt)}
                      >
                        <MessageCircle className="size-3.5" aria-hidden="true" />
                        Ask Angel about this
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Programmes */}
      <section aria-label="UAR programmes">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          How we can help
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROGRAMMES.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => navigate("/campaigns")}
                aria-label={`Learn about ${p.title}`}
                className={`group flex min-h-11 flex-col gap-2 rounded-xl border bg-card p-5 text-left shadow-sm outline-none transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring ${p.borderClass}`}
              >
                <span className={`flex size-10 items-center justify-center rounded-lg ${p.iconClass}`}>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold">{p.title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{p.desc}</span>
                <span className="pt-1 text-xs font-medium text-primary">See campaigns</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
