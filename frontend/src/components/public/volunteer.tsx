"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { get, post } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useMasters } from "@/hooks/use-masters";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Section, StepFlow } from "@/components/public/shared";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ClipboardList,
  Copy,
  GraduationCap,
  HandHeart,
  Info,
  KeyRound,
  Laptop,
  LogIn,
  Package,
  PawPrint,
  ScanLine,
  ShieldCheck,
  Stethoscope,
  Boxes,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

interface TempCreds {
  email: string;
  password: string;
  fullName: string;
}

interface MineApplication {
  id: string;
  fullName: string;
  status: "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "INFO_REQUESTED";
  motivation?: string;
  reviewNote?: string | null;
  createdAt?: string;
}

const ROLES_GRID = [
  {
    icon: Package,
    title: "Field Distributor",
    desc: "Run ration-kit lanes and pad-bank restocks. Two hours, one fixed lane, real names.",
  },
  {
    icon: GraduationCap,
    title: "Awareness Educator",
    desc: "Host anti-drug, cyber and menstrual-health sessions in schools, colleges and offices.",
  },
  {
    icon: PawPrint,
    title: "Animal Rescuer",
    desc: "Feeding points, ABC drive coordination and 1962 rescue callouts with trained handlers.",
  },
  {
    icon: Stethoscope,
    title: "Medicine Runner",
    desc: "Deliver adopted medicines with QR receipts and record patient adherence notes.",
  },
  {
    icon: Laptop,
    title: "Tech & Data",
    desc: "Maintain kit QR flows, dashboards and the corridor event logs — remote-friendly.",
  },
  {
    icon: ShieldCheck,
    title: "Event Marshal",
    desc: "Corridor demos, campus drives and fundraiser days — logistics and safety.",
  },
];

const JOURNEY_STEPS = [
  {
    title: "Apply below",
    desc: "Two steps, three minutes. Tell us who you are and where you can help.",
  },
  {
    title: "Get a temporary login",
    desc: "Instant credentials to sign in and track your application status.",
  },
  {
    title: "Track status",
    desc: "A programme lead reviews every application within 3 working days.",
  },
  {
    title: "Admin approves you",
    desc: "Orientation call, ID verification for child/patient roles, then activation.",
  },
  {
    title: "Full volunteer portal unlocks",
    desc: "Tasks, kit scanning, distributions and inventory — the whole field toolkit.",
  },
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MOTIVATION_MIN = 30;

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  UNDER_REVIEW: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  INFO_REQUESTED: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  APPROVED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  REJECTED: "bg-red-500/15 text-red-600 dark:text-red-400",
};

async function copyText(text: string, label = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error("Copy failed — select the text manually");
  }
}

/* ================================================================== */
/* VolunteerPage                                                       */
/* ================================================================== */

export function VolunteerPage() {
  const { user } = useAuth();
  const reduce = useReducedMotion();
  const { options: cities, loading: citiesLoading } = useMasters("CITY");
  const { options: skills, loading: skillsLoading } = useMasters("SKILL");
  const { options: availability } = useMasters("AVAILABILITY");

  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [occupation, setOccupation] = useState("");
  const [skillSel, setSkillSel] = useState<Set<string>>(new Set());
  const [availSel, setAvailSel] = useState<Set<string>>(new Set());
  const [motivation, setMotivation] = useState("");

  const [busy, setBusy] = useState(false);
  const [tempCreds, setTempCreds] = useState<TempCreds | null>(null);
  const [submittedForUser, setSubmittedForUser] = useState(false);
  const [mine, setMine] = useState<MineApplication | null>(null);
  const [mineChecked, setMineChecked] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFullName((n) => n || user.name || "");
    setEmail((e) => e || user.email || "");
    setPhone((p) => p || user.phone || "");
    setCity((c) => c || user.city || "");
    // Check for an existing application (logged-in users only)
    let alive = true;
    get<{ application: MineApplication | null }>("/api/volunteer-applications/mine")
      .then((d) => {
        if (!alive) return;
        setMine(d?.application ?? null);
        setMineChecked(true);
      })
      .catch(() => alive && setMineChecked(true));
    return () => {
      alive = false;
    };
  }, [user]);

  const toggleSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    value: string
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const validateStep = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (fullName.trim().length < 3) e.fullName = "Please enter your full name.";
      if (!EMAIL_RE.test(email.trim())) e.email = "A valid email is needed for updates.";
      if (phone.replace(/\D/g, "").length !== 10)
        e.phone = "Phone must be exactly 10 digits.";
      if (!city) e.city = "Please choose your city.";
    }
    if (s === 2) {
      if (motivation.trim().length < MOTIVATION_MIN)
        e.motivation = `Tell us a little more — at least ${MOTIVATION_MIN} characters.`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const nextStep = () => {
    if (!validateStep(step)) return;
    if (step === 2) {
      void submit();
      return;
    }
    setErrors({});
    setStep(2);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await post<{ application?: unknown; tempCreds?: TempCreds }>(
        "/api/volunteer-applications",
        {
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          city,
          occupation: occupation.trim() || undefined,
          skills: Array.from(skillSel).join(",") || undefined,
          availability: Array.from(availSel).join(",") || undefined,
          motivation: motivation.trim(),
        }
      );
      if (user) {
        setSubmittedForUser(true);
        toast.success("Application received — track its status in your Volunteer Portal.");
      } else if (res?.tempCreds) {
        setTempCreds(res.tempCreds);
        toast.success("Application received!");
      } else {
        setSubmittedForUser(true);
        toast.success("Application received — we'll be in touch within 3 working days.");
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit application");
    } finally {
      setBusy(false);
    }
  };

  const resetForm = () => {
    setTempCreds(null);
    setSubmittedForUser(false);
    setStep(1);
    setMotivation("");
    setSkillSel(new Set());
    setAvailSel(new Set());
    setErrors({});
  };

  /* ---------------- success views ---------------- */
  if (tempCreds) {
    return (
      <Section className="mx-auto max-w-2xl">
        <Card className="p-6 sm:p-8">
          <div className="text-center">
            <motion.span
              initial={reduce ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 16 }}
              className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-8 ring-emerald-500/10"
            >
              <CheckCircle2 className="size-9" aria-hidden />
            </motion.span>
            <h1 className="mt-4 text-xl font-bold tracking-tight sm:text-2xl">
              Application received, {tempCreds.fullName.split(" ")[0]}!
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A programme lead reviews every application within 3 working days.
            </p>
          </div>

          <div className="mx-auto mt-6 max-w-md rounded-xl border p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <KeyRound className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />{" "}
              Temporary credentials
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sign in with these to track your application status.
            </p>
            <div className="mt-3 space-y-2">
              {[
                { label: "Email", value: tempCreds.email },
                { label: "Password", value: tempCreds.password },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 p-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {row.label}
                    </p>
                    <code className="block truncate text-sm font-semibold select-all">
                      {row.value}
                    </code>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={`Copy ${row.label.toLowerCase()}`}
                    onClick={() => copyText(row.value, `${row.label} copied`)}
                  >
                    <Copy className="size-3.5" aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              These credentials are valid until an admin approves you — after approval, keep
              using the same login and your full portal unlocks automatically.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button className="bg-emerald-600 hover:bg-emerald-700" asChild>
              <Link href="/login">
                <LogIn className="size-4" aria-hidden /> Check application status
              </Link>
            </Button>
            <Button variant="outline" onClick={resetForm}>
              Submit another application
            </Button>
          </div>
        </Card>
      </Section>
    );
  }

  if (submittedForUser) {
    return (
      <Section className="mx-auto max-w-2xl">
        <Card className="p-6 text-center sm:p-8">
          <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-8 ring-emerald-500/10">
            <CheckCircle2 className="size-9" aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-bold tracking-tight sm:text-2xl">
            Application received!
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A programme lead reviews every application within 3 working days. You can track the
            status any time.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button className="bg-emerald-600 hover:bg-emerald-700" asChild>
              <Link href="/login">
                <LogIn className="size-4" aria-hidden /> Check application status
              </Link>
            </Button>
            <Button variant="outline" onClick={resetForm}>
              Submit another application
            </Button>
          </div>
        </Card>
      </Section>
    );
  }

  /* ---------------- main render ---------------- */
  return (
    <>
      <Section
        title="Volunteer with United Angel Reach"
        subtitle="Background-verified, angel-trained, always accompanied on field duties. Two hours a month is enough to change a lane."
      >
        {/* Value props */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES_GRID.map((r) => (
            <Card key={r.title} className="p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <r.icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-3 font-semibold">{r.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.desc}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title="Apply now"
        subtitle="Every application is reviewed by a programme lead within 3 working days."
        className="bg-muted/40"
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* -------- Form -------- */}
          <div className="space-y-4">
            {/* Existing application status (logged-in) */}
            {user && mineChecked && mine && (
              <Card className="border-emerald-500/25 bg-emerald-500/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <ClipboardList className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    Your latest application
                  </p>
                  <Badge
                    className={cn(
                      "border-0 text-[10px] uppercase",
                      STATUS_STYLE[mine.status] ?? "bg-muted text-muted-foreground"
                    )}
                  >
                    {mine.status}
                  </Badge>
                </div>
                {mine.status === "PENDING" && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Still in review — a lead will call you within 3 working days of applying.
                  </p>
                )}
                {mine.status === "UNDER_REVIEW" && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    A programme lead is reading your application right now.
                  </p>
                )}
                {mine.status === "INFO_REQUESTED" && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {mine.reviewNote
                      ? `The team asked for more information: ${mine.reviewNote}`
                      : "The team asked for more information — update your application in the Volunteer Portal."}
                  </p>
                )}
                {mine.status === "APPROVED" && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Approved! Sign in and open your Volunteer Portal — tasks and lanes are waiting.
                  </p>
                )}
                {mine.status === "REJECTED" && mine.reviewNote && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Note from the team: {mine.reviewNote}
                  </p>
                )}
              </Card>
            )}

            <Card className="p-5 sm:p-6">
              {/* Mini stepper */}
              <div className="mb-5 flex items-center gap-2" aria-label={`Step ${step} of 2`}>
                {[1, 2].map((s) => (
                  <React.Fragment key={s}>
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full text-xs font-bold",
                        step === s
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-500/40"
                          : s < step
                            ? "bg-emerald-600 text-white"
                            : "bg-muted text-muted-foreground"
                      )}
                    >
                      {s < step ? <BadgeCheck className="size-4" aria-hidden /> : s}
                    </span>
                    <span
                      className={cn(
                        "text-xs font-semibold",
                        step === s ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {s === 1 ? "About you" : "Your fit"}
                    </span>
                    {s === 1 && (
                      <span
                        aria-hidden
                        className={cn("h-0.5 flex-1 rounded", step > 1 ? "bg-emerald-500" : "bg-border")}
                      />
                    )}
                  </React.Fragment>
                ))}
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, x: 32 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: -32 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  {step === 1 ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="v-name">Full name *</Label>
                        <Input
                          id="v-name"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Your name"
                          aria-describedby={errors.fullName ? "v-name-err" : undefined}
                        />
                        {errors.fullName && (
                          <p id="v-name-err" className="text-xs font-medium text-red-600 dark:text-red-400">
                            {errors.fullName}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="v-email">Email *</Label>
                        <Input
                          id="v-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          aria-describedby={errors.email ? "v-email-err" : undefined}
                        />
                        {errors.email && (
                          <p id="v-email-err" className="text-xs font-medium text-red-600 dark:text-red-400">
                            {errors.email}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="v-phone">Phone *</Label>
                        <Input
                          id="v-phone"
                          inputMode="numeric"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="10-digit mobile"
                          aria-describedby={errors.phone ? "v-phone-err" : undefined}
                        />
                        {errors.phone && (
                          <p id="v-phone-err" className="text-xs font-medium text-red-600 dark:text-red-400">
                            {errors.phone}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="v-city">City *</Label>
                        {citiesLoading ? (
                          <Skeleton className="h-10 w-full" />
                        ) : (
                          <Select value={city} onValueChange={setCity}>
                            <SelectTrigger id="v-city" className="h-10">
                              <SelectValue placeholder="Choose your city" />
                            </SelectTrigger>
                            <SelectContent>
                              {cities.map((c) => (
                                <SelectItem key={c.value} value={c.value}>
                                  {c.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {errors.city && (
                          <p className="text-xs font-medium text-red-600 dark:text-red-400">
                            {errors.city}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="v-occ">Occupation</Label>
                        <Input
                          id="v-occ"
                          value={occupation}
                          onChange={(e) => setOccupation(e.target.value)}
                          placeholder="Student / teacher / engineer / retired…"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div>
                        <Label className="text-sm font-semibold">
                          Skills (choose all that apply)
                        </Label>
                        {skillsLoading ? (
                          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {Array.from({ length: 6 }).map((_, i) => (
                              <Skeleton key={i} className="h-10 rounded-lg" />
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {skills.map((s) => {
                              const on = skillSel.has(s.value);
                              return (
                                <button
                                  key={s.value}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => toggleSet(setSkillSel, s.value)}
                                  className={cn(
                                    "min-h-[44px] rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                                    on
                                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                      : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                                  )}
                                >
                                  {s.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div>
                        <Label className="text-sm font-semibold">Availability</Label>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {availability.map((av) => {
                            const on = availSel.has(av.value);
                            return (
                              <button
                                key={av.value}
                                type="button"
                                aria-pressed={on}
                                onClick={() => toggleSet(setAvailSel, av.value)}
                                className={cn(
                                  "min-h-[44px] rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                                  on
                                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                                )}
                              >
                                {av.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="v-mot">Why do you want to join? *</Label>
                          <span
                            className={cn(
                              "text-xs",
                              motivation.trim().length >= MOTIVATION_MIN
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground"
                            )}
                          >
                            {motivation.trim().length}/{MOTIVATION_MIN} min
                          </span>
                        </div>
                        <Textarea
                          id="v-mot"
                          rows={4}
                          value={motivation}
                          onChange={(e) => setMotivation(e.target.value)}
                          placeholder="A cause that touched you, a skill you want to give, hours you can commit…"
                          aria-describedby={errors.motivation ? "v-mot-err" : undefined}
                        />
                        {errors.motivation && (
                          <p id="v-mot-err" className="text-xs font-medium text-red-600 dark:text-red-400">
                            {errors.motivation}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              <div className="mt-6 flex items-center justify-between gap-3 border-t pt-4">
                {step === 2 ? (
                  <Button variant="outline" onClick={() => setStep(1)} disabled={busy}>
                    <ArrowLeft className="size-4" aria-hidden /> Back
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  size="lg"
                  className="min-w-[200px] bg-emerald-600 hover:bg-emerald-700"
                  onClick={nextStep}
                  disabled={busy}
                >
                  {busy ? (
                    "Submitting…"
                  ) : step === 1 ? (
                    <>
                      Continue <ArrowRight className="size-4" aria-hidden />
                    </>
                  ) : (
                    <>
                      <HandHeart className="size-5" aria-hidden /> Submit application
                    </>
                  )}
                </Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Not registered yet? You&rsquo;ll get temporary login details right after
                applying.{" "}
                <Link href="/login" className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
                  Already applied? Sign in
                </Link>
              </p>
            </Card>
          </div>

          {/* -------- Side: journey -------- */}
          <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <Card className="p-5">
              <h3 className="font-semibold">The volunteer journey</h3>
              <StepFlow accent="emerald" className="mt-4" steps={JOURNEY_STEPS} />
              <div className="mt-5 flex flex-wrap gap-1.5" aria-label="Portal capabilities">
                {[
                  { icon: ClipboardList, label: "Tasks" },
                  { icon: ScanLine, label: "Kit scanning" },
                  { icon: Package, label: "Distributions" },
                  { icon: Boxes, label: "Inventory" },
                ].map((t) => (
                  <Badge key={t.label} variant="outline" className="gap-1 text-[10px]">
                    <t.icon className="size-3" aria-hidden /> {t.label}
                  </Badge>
                ))}
              </div>
            </Card>
            <Card className="border-emerald-500/25 bg-emerald-500/10 p-5">
              <p className="flex items-start gap-2 text-sm leading-relaxed text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
                Volunteers working with children or patients complete an ID verification and sign
                our child-protection charter — non-negotiable, like everywhere at UAR.
              </p>
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}
