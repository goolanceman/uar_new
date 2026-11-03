"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "@/lib/router";
import { get, post } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Section, EmptyState, CampaignIcon } from "@/components/public/shared";
import {
  CAMPAIGN_CONTENT,
  DONATION_TIERS,
  GENERIC_IMPACT_HINTS,
  ORG_DEFAULTS,
  accentSoft,
  type DonationTier,
} from "@/components/public/campaign-data";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  Gift,
  HandCoins,
  Heart,
  Info,
  Landmark,
  Loader2,
  Lock,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  User,
  Wallet,
  Zap,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

interface LiveCampaign {
  id: string;
  title: string;
  slug?: string | null;
  tagline?: string | null;
  targetAmount: number;
  raisedAmount: number;
  icon?: string | null;
  accent?: string | null;
  status?: string | null;
}

interface RecentDonation {
  id: string;
  donorName: string;
  amount: number;
  isAnonymous?: boolean;
  type?: string;
  createdAt?: string;
  campaign?: { title?: string } | null;
}

interface ReceiptInfo {
  receiptNumber: string;
  amount: number;
  type: string;
  campaignTitle?: string | null;
}

interface OrgPublic {
  orgName?: string;
  upiId?: string;
  org80g?: string;
  orgEmail?: string;
}

const PRESETS = [500, 1000, 2500, 5000, 10000];
const SLIDER_MIN = 100;
const SLIDER_MAX = 100000;
const SLIDER_STEP = 100;

const CATEGORY_BY_SLUG: Record<string, string> = {
  "anti-drug": "AWARENESS",
  "cyber-crime": "SAFETY",
  "women-safety": "SAFETY",
  "child-safety": "SAFETY",
  "medicine-adoption": "MEDICAL",
  "animal-welfare": "ANIMAL",
  "green-corridor": "MOBILITY",
  "ration-kits": "FOOD_DISTRIBUTION",
  "sanitary-pads": "SANITARY_PADS",
};

const PAYMENT_METHODS = [
  { value: "UPI", label: "UPI — GPay / PhonePe / Paytm", icon: Smartphone },
  { value: "RAZORPAY", label: "Card / Netbanking (gateway)", icon: CreditCard },
  { value: "BANK_TRANSFER", label: "Bank transfer (NEFT / IMPS)", icon: Building2 },
  { value: "CASH", label: "Cash via volunteer collection", icon: Banknote },
];

const WIZARD_STEPS = [
  { n: 1, label: "Choose your gift", icon: Gift },
  { n: 2, label: "About you", icon: User },
  { n: 3, label: "Payment", icon: Wallet },
  { n: 4, label: "Thank you", icon: CheckCircle2 },
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

async function copyText(text: string, label = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error("Copy failed — select the text manually");
  }
}

/** Impact hint for the current amount + campaign (from campaign-data tiers). */
function impactHint(amount: number, slug: string | null | undefined): string {
  const tiers: DonationTier[] = slug
    ? (DONATION_TIERS[slug] ?? GENERIC_IMPACT_HINTS)
    : GENERIC_IMPACT_HINTS;
  const sorted = [...tiers].sort((a, b) => b.amount - a.amount);
  const hit = sorted.find((t) => amount >= t.amount) ?? sorted[sorted.length - 1];
  return hit?.impact ?? "every rupee is QR-traced to a doorstep";
}

/* ================================================================== */
/* DonatePage — guided 4-step wizard                                   */
/* ================================================================== */

export function DonatePage() {
  const { query } = useRoute();
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();

  const [org, setOrg] = useState<OrgPublic | null>(null);
  const [campaigns, setCampaigns] = useState<LiveCampaign[] | null>(null);
  const [recent, setRecent] = useState<RecentDonation[] | null>(null);

  const [step, setStep] = useState(1);
  const [dir, setDir] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Step 1
  const [giftType, setGiftType] = useState<"ONE_TIME" | "RECURRING">("ONE_TIME");
  const [amount, setAmount] = useState<number>(1000);
  const [customAmount, setCustomAmount] = useState<string>("");

  // Step 2
  const [campaignId, setCampaignId] = useState<string>("general");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pan, setPan] = useState("");
  const [message, setMessage] = useState("");
  const [anonymous, setAnonymous] = useState(false);

  // Step 3
  const [paymentMethod, setPaymentMethod] = useState("UPI");

  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptInfo | null>(null);

  const slugFromUrl = query.get("campaign");

  /* ---------------- data loads ---------------- */
  useEffect(() => {
    let alive = true;
    get<OrgPublic>("/api/settings/public")
      .then((d) => alive && setOrg(d ?? null))
      .catch(() => {});
    get<LiveCampaign[]>("/api/campaigns")
      .then((d) => alive && setCampaigns(Array.isArray(d) ? d : []))
      .catch(() => alive && setCampaigns([]));
    get<RecentDonation[]>("/api/donations?public=1")
      .then((d) => alive && setRecent(Array.isArray(d) ? d : []))
      .catch(() => alive && setRecent([]));
    return () => {
      alive = false;
    };
  }, []);

  // Pre-select campaign from ?campaign=
  useEffect(() => {
    if (!slugFromUrl || !campaigns) return;
    const found = campaigns.find((c) => c.slug === slugFromUrl);
    if (found) setCampaignId(found.id);
  }, [slugFromUrl, campaigns]);

  // Prefill donor details from session
  useEffect(() => {
    if (!user) return;
    setName((n) => n || user.name || "");
    setEmail((e) => e || user.email || "");
    setPhone((p) => p || user.phone || "");
  }, [user]);

  const selected = useMemo(
    () => campaigns?.find((c) => c.id === campaignId) ?? null,
    [campaigns, campaignId]
  );
  const selectedSlug = selected?.slug ?? null;

  const effectiveAmount = customAmount
    ? Number(customAmount) || 0
    : amount;

  const upiId = org?.upiId || ORG_DEFAULTS.upiId;
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    "UnitedAngelReach"
  )}&am=${effectiveAmount}&cu=INR&tn=${encodeURIComponent("UAR Donation")}`;

  /* ---------------- step validation ---------------- */
  const validateStep = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (!Number.isFinite(effectiveAmount) || effectiveAmount < 10)
        e.amount = "Please choose at least ₹10 — the minimum we can process.";
      if (effectiveAmount > SLIDER_MAX)
        e.amount = `For gifts above ${formatINR(SLIDER_MAX)}, please contact care@unitedangelreach.org.`;
    }
    if (s === 2) {
      if (name.trim().length < 2) e.name = "Please enter your full name.";
      if (!EMAIL_RE.test(email.trim()))
        e.email = "A valid email is needed for your 80G receipt.";
      if (phone.trim() && phone.replace(/\D/g, "").length !== 10)
        e.phone = "Phone must be exactly 10 digits (or leave it blank).";
      if (pan.trim() && !PAN_RE.test(pan.trim().toUpperCase()))
        e.pan = "PAN looks invalid — format is ABCDE1234F.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goTo = (next: number) => {
    setDir(next > step ? 1 : -1);
    setErrors({});
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const nextStep = () => {
    if (!validateStep(step)) return;
    if (step === 3) {
      void submit();
      return;
    }
    goTo(step + 1);
  };

  /* ---------------- submit ---------------- */
  const submit = async () => {
    if (!validateStep(2)) {
      goTo(2);
      return;
    }
    setBusy(true);
    try {
      const res = await post<
        ReceiptInfo & { campaign?: { title?: string } | null }
      >("/api/donations", {
        donorName: name.trim(),
        donorEmail: email.trim(),
        donorPhone: phone.trim() || undefined,
        amount: effectiveAmount,
        type: giftType,
        category: selected
          ? (CATEGORY_BY_SLUG[selected.slug ?? ""] ?? "GENERAL")
          : "GENERAL",
        paymentMethod,
        campaignId: selected ? selected.id : undefined,
        message: message.trim() || undefined,
        isAnonymous: anonymous,
        pan: pan.trim() || undefined,
      });
      setReceipt({
        receiptNumber: res.receiptNumber,
        amount: res.amount,
        type: res.type,
        campaignTitle: res.campaign?.title ?? selected?.title ?? "General fund",
      });
      goTo(4);
      toast.success(`Thank you! Receipt ${res.receiptNumber} generated.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Donation failed — please try again"
      );
    } finally {
      setBusy(false);
    }
  };

  const resetAll = () => {
    setReceipt(null);
    setAmount(1000);
    setCustomAmount("");
    setGiftType("ONE_TIME");
    setMessage("");
    setAnonymous(false);
    setPaymentMethod("UPI");
    setErrors({});
    goTo(1);
  };

  const firstName = name.trim().split(" ")[0] || "friend";

  /* ================================================================= */
  /* THANK YOU (step 4 content, full-page)                             */
  /* ================================================================= */
  if (receipt) {
    return (
      <Section className="mx-auto max-w-2xl">
        <Card className="p-8 text-center sm:p-10">
          <motion.span
            initial={reduceMotion ? false : { scale: 0, rotate: -30 }}
            animate={reduceMotion ? {} : { scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
            className="mx-auto flex size-20 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-8 ring-emerald-500/10"
          >
            <CheckCircle2 className="size-11" aria-hidden />
          </motion.span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">
            Thank you, {firstName}!
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
            Your {receipt.type === "RECURRING" ? "monthly " : ""}
            gift of{" "}
            <span className="font-bold text-foreground">
              {formatINR(receipt.amount)}
            </span>{" "}
            is confirmed{receipt.campaignTitle ? ` for ${receipt.campaignTitle}` : ""}.
          </p>

          <div className="mx-auto mt-6 max-w-sm rounded-xl border bg-muted/40 p-4 text-left text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Receipt no.</span>
              <span className="flex items-center gap-1.5">
                <Badge variant="outline" className="font-mono text-xs">
                  {receipt.receiptNumber}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Copy receipt number"
                  onClick={() => copyText(receipt.receiptNumber, "Receipt number copied")}
                >
                  <Copy className="size-3.5" aria-hidden />
                </Button>
              </span>
            </div>
            <Separator className="my-3" />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-semibold">{formatINR(receipt.amount)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Type</span>
              <span className="font-semibold">
                {receipt.type === "RECURRING" ? "Monthly" : "One-time"}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Fund</span>
              <span className="max-w-[55%] truncate text-right font-semibold">
                {receipt.campaignTitle}
              </span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() =>
                window.open(
                  `/api/receipts/${encodeURIComponent(receipt.receiptNumber)}/html`,
                  "_blank",
                  "noopener"
                )
              }
            >
              <Download className="size-4" aria-hidden /> Download 80G receipt
            </Button>
            <Button variant="outline" onClick={resetAll}>
              <Heart className="size-4" aria-hidden /> Donate again
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/campaigns">
                Explore campaigns <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>

          <p className="mx-auto mt-6 max-w-md text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mr-1 inline size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Donations are eligible for deduction under Section 80G.{" "}
            {pan.trim()
              ? "Your PAN is on the receipt — it's tax-ready."
              : "Add PAN next time and the receipt is issued tax-ready."}{" "}
            A copy is on its way to {email.trim() || "your email"}.
          </p>
        </Card>
      </Section>
    );
  }

  /* ================================================================= */
  /* WIZARD                                                            */
  /* ================================================================= */
  const motionProps = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, x: dir * 48 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: dir * -48 },
      };

  return (
    <Section
      title="Donate"
      subtitle="Four quick steps. ≥92% of every rupee reaches programmes, and every kit is QR-traced to a doorstep."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* ----------------- Left: wizard ----------------- */}
        <div className="min-w-0 overflow-hidden">
          {/* Stepper header */}
          <nav
            aria-label="Donation steps"
            className="mb-5 rounded-xl border bg-card p-3 sm:p-4"
          >
            {/* Mobile: compact progress */}
            <div className="sm:hidden">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                <span>
                  Step {step} of 4 — {WIZARD_STEPS[step - 1].label}
                </span>
                <span>{Math.round((step / 4) * 100)}%</span>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={4}
                aria-valuenow={step}
                aria-label={`Step ${step} of 4`}
              >
                <motion.div
                  className="h-full rounded-full bg-emerald-500"
                  animate={{ width: `${(step / 4) * 100}%` }}
                  transition={{ duration: 0.35 }}
                />
              </div>
            </div>
            {/* Desktop: full stepper */}
            <ol className="hidden items-center gap-1 sm:flex">
              {WIZARD_STEPS.map((s, i) => {
                const done = step > s.n;
                const active = step === s.n;
                return (
                  <React.Fragment key={s.n}>
                    <li className="flex min-w-0 items-center">
                      <button
                        type="button"
                        disabled={!done}
                        onClick={() => done && goTo(s.n)}
                        aria-current={active ? "step" : undefined}
                        className={cn(
                          "flex min-h-[44px] items-center gap-2 rounded-full px-2.5 py-1.5 text-sm transition",
                          done && "cursor-pointer hover:bg-accent",
                          active ? "font-semibold" : "text-muted-foreground"
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition",
                            done
                              ? "bg-emerald-600 text-white"
                              : active
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-500/40"
                                : "bg-muted text-muted-foreground"
                          )}
                        >
                          {done ? <Check className="size-4" aria-hidden /> : s.n}
                        </span>
                        <span className="truncate">{s.label}</span>
                      </button>
                    </li>
                    {i < WIZARD_STEPS.length - 1 && (
                      <li
                        aria-hidden
                        className={cn(
                          "h-0.5 w-6 shrink-0 rounded-full lg:w-10",
                          step > s.n ? "bg-emerald-500" : "bg-border"
                        )}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </ol>
          </nav>

          {/* Step body */}
          <Card className="overflow-hidden p-5 sm:p-6">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                {...motionProps}
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                {/* ============ STEP 1 — Choose your gift ============ */}
                {step === 1 && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="flex items-center gap-2 text-lg font-bold">
                        <Gift className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                        Choose your gift
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        One-time help when it&rsquo;s needed — or a monthly commitment that
                        lets us plan a full year of care.
                      </p>
                    </div>

                    {/* Segmented toggle */}
                    <div
                      role="radiogroup"
                      aria-label="Gift frequency"
                      className="grid grid-cols-2 gap-1.5 rounded-xl border bg-muted/50 p-1.5"
                    >
                      {(
                        [
                          { v: "ONE_TIME", label: "One-time", hint: "Give once, right now" },
                          { v: "RECURRING", label: "Monthly", hint: "Sustain a programme" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.v}
                          type="button"
                          role="radio"
                          aria-checked={giftType === opt.v}
                          onClick={() => setGiftType(opt.v)}
                          className={cn(
                            "min-h-[52px] rounded-lg px-3 py-2 text-center transition",
                            giftType === opt.v
                              ? "bg-background shadow-sm ring-1 ring-emerald-500/40"
                              : "hover:bg-accent"
                          )}
                        >
                          <span
                            className={cn(
                              "block text-sm font-semibold",
                              giftType === opt.v &&
                                "text-emerald-600 dark:text-emerald-400"
                            )}
                          >
                            {opt.label}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {opt.hint}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Preset amounts */}
                    <div>
                      <Label className="text-sm font-semibold">Pick an amount</Label>
                      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {PRESETS.map((p) => {
                          const active = !customAmount && amount === p;
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => {
                                setAmount(p);
                                setCustomAmount("");
                                setErrors((e) => ({ ...e, amount: "" }));
                              }}
                              aria-pressed={active}
                              className={cn(
                                "min-h-[48px] rounded-lg border text-sm font-bold transition",
                                active
                                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-500/30"
                                  : "bg-background hover:bg-accent"
                              )}
                            >
                              ₹{p.toLocaleString("en-IN")}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Custom amount + slider */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="custom-amount" className="text-sm font-semibold">
                          Or set a custom amount
                        </Label>
                        <div className="relative w-32">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                            ₹
                          </span>
                          <Input
                            id="custom-amount"
                            type="number"
                            inputMode="numeric"
                            min={10}
                            step={100}
                            value={customAmount}
                            onChange={(e) => {
                              setCustomAmount(e.target.value);
                              const n = Number(e.target.value);
                              if (Number.isFinite(n) && n > 0) setAmount(n);
                            }}
                            placeholder={String(amount)}
                            className="pl-7 text-right font-semibold"
                            aria-describedby="amount-error"
                          />
                        </div>
                      </div>
                      <Slider
                        value={[
                          Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, amount || SLIDER_MIN)),
                        ]}
                        min={SLIDER_MIN}
                        max={SLIDER_MAX}
                        step={SLIDER_STEP}
                        onValueChange={(v) => {
                          setAmount(v[0] ?? SLIDER_MIN);
                          setCustomAmount("");
                        }}
                        aria-label={`Donation amount: ${formatINR(amount)}`}
                      />
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>₹100</span>
                        <span>₹50,000</span>
                        <span>₹1,00,000</span>
                      </div>
                    </div>

                    {/* Impact hint */}
                    <div
                      className="flex items-start gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3.5"
                      aria-live="polite"
                    >
                      <Sparkles
                        className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden
                      />
                      <p className="text-sm leading-relaxed text-foreground">
                        <span className="font-bold">
                          {formatINR(effectiveAmount || 0)}{" "}
                          {giftType === "RECURRING" ? "a month " : ""}
                        </span>
                        {impactHint(effectiveAmount || 0, selectedSlug)}.
                      </p>
                    </div>

                    {errors.amount && (
                      <p id="amount-error" className="text-sm font-medium text-red-600 dark:text-red-400">
                        {errors.amount}
                      </p>
                    )}
                  </div>
                )}

                {/* ============ STEP 2 — About you ============ */}
                {step === 2 && (
                  <div className="space-y-5">
                    <div>
                      <h2 className="flex items-center gap-2 text-lg font-bold">
                        <User className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                        About you
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        We need this for the receipt — nothing else. You can give
                        anonymously on public lists.
                      </p>
                    </div>

                    {/* Campaign select */}
                    <div className="space-y-1.5">
                      <Label htmlFor="d-campaign">Direct my gift to</Label>
                      {campaigns === null ? (
                        <Skeleton className="h-11 w-full" />
                      ) : (
                        <Select
                          value={campaignId}
                          onValueChange={setCampaignId}
                        >
                          <SelectTrigger id="d-campaign" className="h-11">
                            <SelectValue placeholder="Choose a fund" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="general">
                              Where it&rsquo;s needed most — general fund
                            </SelectItem>
                            {campaigns
                              .filter((c) => c.status !== "CANCELLED")
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.title}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Not sure? The general fund is routed weekly to the
                        highest-need programme — you&rsquo;ll see exactly where it went.
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="d-name">Full name *</Label>
                        <Input
                          id="d-name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Your name"
                          aria-describedby={errors.name ? "name-error" : undefined}
                        />
                        {errors.name && (
                          <p id="name-error" className="text-xs font-medium text-red-600 dark:text-red-400">
                            {errors.name}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="d-email">Email *</Label>
                        <Input
                          id="d-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          aria-describedby={errors.email ? "email-error" : undefined}
                        />
                        {errors.email && (
                          <p id="email-error" className="text-xs font-medium text-red-600 dark:text-red-400">
                            {errors.email}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="d-phone">Phone</Label>
                        <Input
                          id="d-phone"
                          inputMode="numeric"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="10-digit mobile (optional)"
                          aria-describedby={errors.phone ? "phone-error" : undefined}
                        />
                        {errors.phone && (
                          <p id="phone-error" className="text-xs font-medium text-red-600 dark:text-red-400">
                            {errors.phone}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="d-pan">PAN (optional)</Label>
                        <Input
                          id="d-pan"
                          value={pan}
                          onChange={(e) => setPan(e.target.value.toUpperCase())}
                          placeholder="ABCDE1234F"
                          maxLength={10}
                          className="font-mono"
                          aria-describedby={errors.pan ? "pan-error" : undefined}
                        />
                        {errors.pan ? (
                          <p id="pan-error" className="text-xs font-medium text-red-600 dark:text-red-400">
                            {errors.pan}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {/* 80G explainer */}
                    <div className="flex items-start gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-4">
                      <Landmark
                        className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden
                      />
                      <div className="text-sm leading-relaxed">
                        <p className="font-semibold">
                          80G: donors get a 50% tax deduction
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          Add your PAN and we email a tax-ready receipt with it printed
                          on — one less April scramble.
                        </p>
                      </div>
                    </div>

                    {/* Anonymous + message */}
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                      <div>
                        <Label htmlFor="d-anon" className="text-sm font-semibold">
                          Give anonymously
                        </Label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Your name won&rsquo;t appear on public supporter lists.
                        </p>
                      </div>
                      <Switch
                        id="d-anon"
                        checked={anonymous}
                        onCheckedChange={setAnonymous}
                        aria-label="Give anonymously"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="d-msg">Message (optional)</Label>
                      <Textarea
                        id="d-msg"
                        rows={2}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="A word for the team or the family you're helping…"
                      />
                    </div>
                  </div>
                )}

                {/* ============ STEP 3 — Payment ============ */}
                {step === 3 && (
                  <div className="space-y-5">
                    <div>
                      <h2 className="flex items-center gap-2 text-lg font-bold">
                        <Wallet className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                        Payment
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        You&rsquo;re giving{" "}
                        <span className="font-semibold text-foreground">
                          {formatINR(effectiveAmount)}
                          {giftType === "RECURRING" ? " / month" : ""}
                        </span>{" "}
                        {selected ? `to ${selected.title}` : "to the general fund"}.
                      </p>
                    </div>

                    {/* Method select */}
                    <div className="space-y-1.5">
                      <Label htmlFor="d-method">Payment method</Label>
                      <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                        <SelectTrigger id="d-method" className="h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* UPI block */}
                    {paymentMethod === "UPI" && (
                      <div className="rounded-xl border p-4">
                        <div className="flex items-center gap-2">
                          <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <QrCode className="size-5" aria-hidden />
                          </span>
                          <div>
                            <p className="text-sm font-bold">Pay by UPI</p>
                            <p className="text-xs text-muted-foreground">
                              Scan in any UPI app, or tap the button on mobile.
                            </p>
                          </div>
                        </div>
                        <Separator className="my-3.5" />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              UPI ID
                            </p>
                            <code className="text-sm font-bold select-all">{upiId}</code>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyText(upiId, "UPI ID copied")}
                            aria-label="Copy UPI ID"
                          >
                            <Copy className="size-3.5" aria-hidden /> Copy
                          </Button>
                        </div>
                        <Separator className="my-3.5" />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Amount
                            </p>
                            <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                              {formatINR(effectiveAmount)}
                            </p>
                          </div>
                          <Button
                            className="bg-emerald-600 hover:bg-emerald-700"
                            onClick={() =>
                              window.open(upiLink, "_blank", "noopener")
                            }
                            aria-label="Open your UPI app to pay"
                          >
                            <Smartphone className="size-4" aria-hidden /> Open UPI app
                          </Button>
                        </div>
                        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          After paying, press <strong>Confirm gift</strong> below — we record
                          the pledge instantly and reconcile the payment reference.
                        </p>
                      </div>
                    )}

                    {/* Mock gateway block */}
                    {paymentMethod === "RAZORPAY" && (
                      <div className="rounded-xl border p-4">
                        <div className="flex items-center gap-2">
                          <span className="flex size-9 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
                            <CreditCard className="size-5" aria-hidden />
                          </span>
                          <div>
                            <p className="text-sm font-bold">Card / Netbanking</p>
                            <Badge variant="outline" className="mt-0.5 text-[10px]">
                              Gateway demo
                            </Badge>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label htmlFor="cc-num">Card number</Label>
                            <Input
                              id="cc-num"
                              disabled
                              placeholder="4111 1111 1111 1111"
                              className="font-mono"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="cc-exp">Expiry</Label>
                            <Input id="cc-exp" disabled placeholder="MM / YY" />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="cc-cvv">CVV</Label>
                            <Input id="cc-cvv" disabled placeholder="•••" type="password" />
                          </div>
                        </div>
                        <p className="mt-3 flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          Gateway demo — Razorpay/Stripe keys are configured by admins in
                          Settings. Confirming records your gift and generates the receipt.
                        </p>
                      </div>
                    )}

                    {paymentMethod === "BANK_TRANSFER" && (
                      <div className="rounded-xl border p-4 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <Building2 className="size-5" aria-hidden />
                          </span>
                          <p className="font-bold">Bank transfer</p>
                        </div>
                        <p className="mt-3 text-muted-foreground">
                          Transfer to <strong>United Angel Reach Trust</strong> and reply to
                          the receipt email with the UTR number — we reconcile within one
                          working day.
                        </p>
                      </div>
                    )}

                    {paymentMethod === "CASH" && (
                      <div className="rounded-xl border p-4 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                            <Banknote className="size-5" aria-hidden />
                          </span>
                          <p className="font-bold">Cash via volunteer</p>
                        </div>
                        <p className="mt-3 text-muted-foreground">
                          A background-verified volunteer collects with an ID card and a
                          numbered receipt book. You&rsquo;ll get a call within 48 hours to fix
                          a slot.
                        </p>
                      </div>
                    )}

                    <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                      <Lock className="size-3.5" aria-hidden /> 80G eligible · audited
                      accounts · QR-traced impact
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Wizard footer */}
            <div className="mt-6 flex items-center justify-between gap-3 border-t pt-4">
              {step > 1 ? (
                <Button variant="outline" onClick={() => goTo(step - 1)} disabled={busy}>
                  <ArrowLeft className="size-4" aria-hidden /> Back
                </Button>
              ) : (
                <span />
              )}
              <Button
                size="lg"
                className="min-w-[220px] bg-emerald-600 text-base hover:bg-emerald-700"
                onClick={nextStep}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-5 animate-spin" aria-hidden /> Processing…
                  </>
                ) : step === 3 ? (
                  <>
                    <Heart className="size-5" aria-hidden /> Confirm gift{" "}
                    {formatINR(effectiveAmount)}
                  </>
                ) : (
                  <>
                    Continue <ArrowRight className="size-4" aria-hidden />
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>

        {/* ----------------- Right: summary sidebar ----------------- */}
        <div className="min-w-0 overflow-hidden space-y-4 lg:sticky lg:top-20 lg:self-start">
          {/* Running summary */}
          <Card className="p-5">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Your gift
            </h3>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400">
                {formatINR(effectiveAmount || 0)}
              </span>
              {giftType === "RECURRING" && (
                <span className="text-sm font-semibold text-muted-foreground">/ month</span>
              )}
            </div>
            <Separator className="my-4" />
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Type</span>
                <span className="font-semibold">
                  {giftType === "RECURRING" ? "Monthly" : "One-time"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Fund</span>
                <span className="max-w-[60%] truncate text-right font-semibold">
                  {selected?.title ?? "Where it's needed most"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Payment</span>
                <span className="font-semibold">
                  {PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.value ?? "UPI"}
                </span>
              </li>
              {selected && selectedSlug && (
                <li className="flex items-center gap-2 pt-1">
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      accentSoft(selected.accent).chip,
                      accentSoft(selected.accent).text
                    )}
                  >
                    <CampaignIcon
                      icon={selected.icon ?? CAMPAIGN_CONTENT[selectedSlug]?.icon ?? "heart"}
                      className="size-4"
                    />
                  </span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {selected.tagline ?? CAMPAIGN_CONTENT[selectedSlug]?.heroTag}
                  </span>
                </li>
              )}
            </ul>
            <Separator className="my-4" />
            {/* Trust badges */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { icon: Landmark, label: "80G eligible" },
                { icon: ShieldCheck, label: "Secure" },
                { icon: Zap, label: "Immediate impact" },
              ].map((b) => (
                <div
                  key={b.label}
                  className="rounded-lg border bg-muted/40 px-1.5 py-2.5"
                  title={b.label}
                >
                  <b.icon
                    className="mx-auto size-4 text-emerald-600 dark:text-emerald-400"
                    aria-hidden
                  />
                  <p className="mt-1 text-[10px] font-semibold leading-tight">
                    {b.label}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* Where money goes */}
          <Card className="p-5">
            <h3 className="flex items-center gap-2 font-semibold">
              <HandCoins className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />{" "}
              Where it goes
            </h3>
            <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
              <li>
                <span className="font-bold text-foreground">₹500</span> — one family&rsquo;s
                ration kit, QR-traced to their door
              </li>
              <li>
                <span className="font-bold text-foreground">₹1,000</span> — a school
                cyber-safety session for 50 seniors or students
              </li>
              <li>
                <span className="font-bold text-foreground">₹10,000</span> — a year of
                monthly follow-ups for one person in recovery
              </li>
            </ul>
          </Card>

          {/* Recent donations */}
          <Card className="p-5">
            <h3 className="flex items-center gap-2 font-semibold">
              <Heart className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />{" "}
              Recent gifts
            </h3>
            {recent === null ? (
              <div className="mt-3 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded-lg" />
                ))}
              </div>
            ) : recent.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Be the first today"
                hint="Recent gifts will appear here — anonymously if you prefer."
                className="mt-3 border-0 bg-transparent p-2"
              />
            ) : (
              <ul className="mt-3 max-h-56 space-y-2.5 overflow-y-auto pr-1 scrollbar-thin">
                {recent.slice(0, 12).map((d) => (
                  <li key={d.id} className="flex items-center gap-2.5 text-sm">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {(d.isAnonymous ? "A" : d.donorName?.[0] ?? "?").toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {d.isAnonymous ? "Anonymous" : d.donorName}
                        {d.type === "RECURRING" && (
                          <Badge variant="outline" className="ml-1.5 px-1 py-0 text-[9px]">
                            monthly
                          </Badge>
                        )}
                      </span>
                      {d.campaign?.title && (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {d.campaign.title}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-bold text-emerald-600 dark:text-emerald-400">
                      {formatINR(d.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Section>
  );
}
