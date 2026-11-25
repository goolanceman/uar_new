"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "@/lib/router";
import { get, post } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { CURRENCIES, formatMoney, getCurrency } from "@/lib/settings-core";
import { emailRule, panRule, phoneRule } from "@/lib/validators";
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
import { Progress } from "@/components/ui/progress";
import { formatINRCompact } from "@/lib/format";
import { coverImageOf } from "@/lib/campaign-image";
import {
  CAMPAIGN_CONTENT,
  DONATION_TIERS,
  GENERIC_IMPACT_HINTS,
  ORG_DEFAULTS,
  accentSoft,
  type DonationTier,
} from "@/components/public/campaign-data";
import {
  AlertTriangle,
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
  Receipt,
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
  minDonation?: number | null;
  coverImage?: string | null;
  gallery?: string | null;
  images?: string | null;
  supporterCount?: number;
  endDate?: string | null;
}

interface RecentDonation {
  id: string;
  donorName: string;
  amount: number;
  currency?: string;
  isAnonymous?: boolean;
  type?: string;
  createdAt?: string;
  campaign?: { title?: string } | null;
}

interface ReceiptInfo {
  receiptNumber: string;
  amount: number;
  currency: string;
  type: string;
  campaignTitle?: string | null;
}

interface OrgPublic {
  orgName?: string;
  upiId?: string;
  org80g?: string;
  orgEmail?: string;
  currency?: string;
  currencySymbol?: string;
  gatewayEnabled?: boolean;
  gatewayProvider?: string;
  /** Public key id only (Razorpay key id / Stripe publishable key) — never secrets. */
  gatewayKeyId?: string;
  features?: Record<string, boolean>;
}

/* Gateway checkout payloads from POST /api/payments — public fields only;
   secret keys never leave the server. */
type GatewayOrder =
  | {
      provider: "RAZORPAY";
      orderId: string;
      keyId: string;
      amount: number;
      currency: string;
      testMode?: boolean;
    }
  | { provider: "STRIPE"; checkoutUrl: string }
  | { provider: "CASHFREE"; paymentSessionId: string; orderId: string; testMode?: boolean };

type DonationCreateResult = ReceiptInfo & {
  campaign?: { title?: string } | null;
  currency?: string;
  checkoutPending?: boolean;
};

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  onerror?: (r: { error?: { description?: string } }) => void;
  modal?: { ondismiss?: () => void };
  handler: (r: RazorpayHandlerResponse) => void | Promise<void>;
}

interface RazorpayInstance {
  open: () => void;
}

interface CashfreeDropinOptions {
  paymentSessionId: string;
  redirectTarget?: "modal" | "_modal" | "top";
  onSuccess?: (r?: unknown) => void;
  onFailure?: (r?: unknown) => void;
  onError?: (r?: unknown) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
    Cashfree?: new (options: { mode?: "sandbox" | "production" }) => {
      checkout: (o: CashfreeDropinOptions) => void;
    };
  }
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

/** Gateway provider display names (public settings send the enum value). */
const PROVIDER_LABELS: Record<string, string> = {
  RAZORPAY: "Razorpay",
  STRIPE: "Stripe",
  CASHFREE: "Cashfree",
};

/** Quick-amount chips per currency magnitude: INR keeps its rupee tiers,
 * most hard currencies use 25/50/100/250, low-unit-value JPY steps higher. */
function presetsFor(code: string): number[] {
  if (code === "INR") return PRESETS;
  if (code === "JPY") return [1000, 3000, 5000, 10000];
  return [25, 50, 100, 250];
}

/** Offline/manual methods — backend records these as PENDING until staff verify. */
const OFFLINE_METHODS = ["CASH", "BANK_TRANSFER", "CHEQUE"];

/** Gateway checkout methods (posted as paymentMethod, settled asynchronously). */
const GATEWAY_METHODS = ["RAZORPAY", "STRIPE", "CASHFREE"];

const WIZARD_STEPS = [
  { n: 1, label: "Choose your gift", icon: Gift },
  { n: 2, label: "About you", icon: User },
  { n: 3, label: "Payment", icon: Wallet },
  { n: 4, label: "Thank you", icon: CheckCircle2 },
];

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

/** Loads a provider checkout SDK once per page session (resolve-once cache). */
const scriptCache = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scriptCache.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => {
        scriptCache.delete(src);
        reject(new Error(`Failed to load ${src}`));
      };
      document.head.appendChild(el);
    });
    scriptCache.set(src, p);
  }
  return p;
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
  const [currency, setCurrency] = useState("INR");

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
  const [redirectProvider, setRedirectProvider] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptInfo | null>(null);

  const slugFromUrl = query.get("campaign");
  const eventFromUrl = query.get("event");
  const [foodEvent, setFoodEvent] = useState<{ id: string; title: string; venue: string; eventDate: string; city?: string | null } | null>(null);

  /* ---------------- data loads ---------------- */
  // Refetchable live loader — called on mount AND after every successful
  // donation so the campaign progress bar + recent-donations wall reflect
  // the new gift immediately instead of showing the page-load snapshot.
  const refreshLive = useCallback(async () => {
    try {
      const d = await get<LiveCampaign[]>("/api/campaigns");
      setCampaigns(Array.isArray(d) ? d : []);
    } catch {
      /* keep whatever we already have */
    }
    try {
      const d = await get<RecentDonation[]>("/api/donations?public=1");
      setRecent(Array.isArray(d) ? d : []);
    } catch {
      /* keep whatever we already have */
    }
  }, []);

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

  // Sponsor-a-distribution from ?event=<foodEventId>
  useEffect(() => {
    if (!eventFromUrl) return;
    let alive = true;
    get<{ id: string; title: string; venue: string; eventDate: string; city?: string | null }[]>("/api/food/events?public=1")
      .then((d) => {
        if (!alive) return;
        const found = (Array.isArray(d) ? d : []).find((e) => e.id === eventFromUrl);
        if (found) setFoodEvent(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [eventFromUrl]);

  // Prefill donor details from session
  useEffect(() => {
    if (!user) return;
    setName((n) => n || user.name || "");
    setEmail((e) => e || user.email || "");
    setPhone((p) => p || user.phone || "");
  }, [user]);

  // Stripe redirects back to /?session_id=…#/donate — verify the session and
  // jump straight to the thank-you step, then clean the query.
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) return;
    let alive = true;
    (async () => {
      try {
        const r = await post<{
          ok: boolean;
          donation: { receiptNumber: string; amount: number; currency: string; paymentStatus: string };
        }>("/api/payments/verify", { sessionId });
        if (alive && r.ok && r.donation.paymentStatus === "COMPLETED") {
          setReceipt({
            receiptNumber: r.donation.receiptNumber,
            amount: r.donation.amount,
            currency: r.donation.currency,
            type: "ONE_TIME",
            campaignTitle: null,
          });
        }
      } catch {
        // verification failed — leave the wizard untouched so the donor can retry
      } finally {
        // Clean the query so a refresh doesn't re-verify the session
        const url = new URL(window.location.href);
        url.searchParams.delete("session_id");
        window.history.replaceState({}, "", url.toString());
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const selected = useMemo(
    () => campaigns?.find((c) => c.id === campaignId) ?? null,
    [campaigns, campaignId]
  );
  const selectedSlug = selected?.slug ?? null;

  /* ---------------- feature flags & gateway (from /api/settings/public) --- */
  const features = org?.features ?? {};
  const currencySwitcherOn = features["features.currencySwitcher"] !== false;
  const recurringOn = features["features.recurringDonations"] !== false;
  const anonymousOn = features["features.anonymousDonations"] !== false;
  const gatewayEnabled = org?.gatewayEnabled === true;
  const gatewayProvider = (org?.gatewayProvider ?? "RAZORPAY").toUpperCase();
  const providerLabel = PROVIDER_LABELS[gatewayProvider] ?? gatewayProvider;

  const effectiveAmount = customAmount
    ? Number(customAmount) || 0
    : amount;

  /** Campaign-specific minimum gift (falls back to the ₹10 floor). */
  const minDonation =
    selected?.minDonation && Number(selected.minDonation) > 0
      ? Number(selected.minDonation)
      : null;
  const minAmount = minDonation ?? 10;
  const isINR = currency === "INR";
  const sliderMin = Math.max(isINR ? SLIDER_MIN : 5, minAmount);
  const sliderMax = isINR ? SLIDER_MAX : 10000;
  const sliderStep = isINR ? SLIDER_STEP : 5;
  const isOfflineMethod = OFFLINE_METHODS.includes(paymentMethod);
  const isGatewayMethod = GATEWAY_METHODS.includes(paymentMethod);
  // 80G cash rule is INR-specific (Income-tax ₹2,000 limit).
  const cashOverLimit = paymentMethod === "CASH" && effectiveAmount > 2000 && isINR;

  /** Currency-aware money formatting for the selected display currency. */
  const money = (n: number) => formatMoney(n, currency);

  const paymentOptions = useMemo(() => {
    const list: { value: string; label: string; icon: typeof Smartphone }[] = [];
    // UPI rails are INR-only — the option disappears for other currencies.
    if (isINR)
      list.push({ value: "UPI", label: "UPI — GPay / PhonePe / Paytm", icon: Smartphone });
    if (gatewayEnabled)
      list.push({
        value: gatewayProvider,
        label: `Card / Netbanking — ${providerLabel}`,
        icon: CreditCard,
      });
    list.push(
      { value: "BANK_TRANSFER", label: "Bank transfer (NEFT / IMPS)", icon: Building2 },
      { value: "CASH", label: "Cash via volunteer collection", icon: Banknote },
      { value: "CHEQUE", label: "Cheque / demand draft", icon: Receipt }
    );
    return list;
  }, [isINR, gatewayEnabled, gatewayProvider, providerLabel]);

  // Org currency drives the switcher default; the select is hidden (and the
  // org currency forced) when the currencySwitcher flag is off.
  useEffect(() => {
    if (org?.currency) setCurrency(org.currency);
  }, [org?.currency]);

  // Flags turning off force-safe state.
  useEffect(() => {
    if (!recurringOn) setGiftType("ONE_TIME");
  }, [recurringOn]);
  useEffect(() => {
    if (!anonymousOn) setAnonymous(false);
  }, [anonymousOn]);

  // Reset the quick-amount selection when the currency changes (the first
  // render keeps the initial default).
  const currencyMounted = React.useRef(false);
  useEffect(() => {
    if (!currencyMounted.current) {
      currencyMounted.current = true;
      return;
    }
    setAmount(presetsFor(currency)[0] ?? 500);
    setCustomAmount("");
  }, [currency]);

  // If the selected method vanishes (currency switch, gateway turned off),
  // fall back to the first available option.
  useEffect(() => {
    if (paymentOptions.length > 0 && !paymentOptions.some((m) => m.value === paymentMethod))
      setPaymentMethod(paymentOptions[0].value);
  }, [paymentOptions, paymentMethod]);

  const upiId = org?.upiId || ORG_DEFAULTS.upiId;
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    "UnitedAngelReach"
  )}&am=${effectiveAmount}&cu=INR&tn=${encodeURIComponent("UAR Donation")}`;

  /* ---------------- step validation ---------------- */
  const validateStep = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 1 || s === 2) {
      if (!Number.isFinite(effectiveAmount) || effectiveAmount < minAmount)
        e.amount = minDonation
          ? `${selected?.title ?? "This campaign"} has a minimum gift of ${formatMoney(minDonation, currency)} — please adjust your amount.`
          : `Please choose at least ${money(10)} — the minimum we can process.`;
      else if (effectiveAmount > sliderMax)
        e.amount = `For gifts above ${money(sliderMax)}, please contact care@unitedangelreach.org.`;
    }
    if (s === 2) {
      if (name.trim().length < 2) e.name = "Please enter your full name.";
      const emailErr = emailRule(false)(email);
      if (emailErr) e.email = "A valid email is needed for your 80G receipt.";
      const phoneErr = phoneRule(true)(phone);
      if (phoneErr) e.phone = phoneErr;
      const panErr = panRule(true)(pan);
      if (panErr) e.pan = "PAN looks invalid — format is ABCDE1234F.";
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

  const finishDonation = (info: ReceiptInfo, confirmed = false) => {
    setReceipt(info);
    goTo(4);
    void refreshLive(); // pull fresh raisedAmounts + recent donations
    toast.success(
      confirmed
        ? `Payment confirmed — receipt ${info.receiptNumber}.`
        : `Thank you! Receipt ${info.receiptNumber} generated.`
    );
  };

  /** Razorpay: open hosted checkout, verify the signed callback, settle. */
  const openRazorpay = async (
    order: Extract<GatewayOrder, { provider: "RAZORPAY" }>,
    info: ReceiptInfo
  ) => {
    try {
      if (!window.Razorpay) await loadScript("https://checkout.razorpay.com/v1/checkout.js");
    } catch {
      toast.error("Razorpay checkout could not be loaded — check your connection and try again.");
      return;
    }
    if (!window.Razorpay) {
      toast.error("Razorpay checkout is unavailable right now.");
      return;
    }
    const rzp = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: org?.orgName ?? ORG_DEFAULTS.orgName,
      description: selected ? `Donation — ${selected.title}` : "Donation — general fund",
      prefill: { name: name.trim(), email: email.trim(), contact: phone.trim() || undefined },
      theme: { color: "#059669" },
      onerror: (r) =>
        toast.error(r?.error?.description ?? "Razorpay checkout failed — please try again."),
      modal: {
        ondismiss: () => toast.info("Payment window closed — press Confirm gift to try again."),
      },
      handler: async (r) => {
        try {
          await post("/api/payments/verify", {
            razorpay_order_id: r.razorpay_order_id,
            razorpay_payment_id: r.razorpay_payment_id,
            razorpay_signature: r.razorpay_signature,
          });
          finishDonation(info, true);
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : "Payment verification failed — our team will reconcile your receipt."
          );
        }
      },
    });
    rzp.open();
  };

  /** Cashfree: v3 drop-in modal, verify on success, settle. */
  const openCashfree = async (
    order: Extract<GatewayOrder, { provider: "CASHFREE"}>,
    info: ReceiptInfo
  ) => {
    try {
      if (!window.Cashfree) await loadScript("https://sdk.cashfree.com/js/v3/cashfree.js");
      if (!window.Cashfree) throw new Error("sdk-missing");
      const cf = new window.Cashfree({ mode: order.testMode ? "sandbox" : "production" });
      cf.checkout({
        paymentSessionId: order.paymentSessionId,
        redirectTarget: "_modal",
        onSuccess: async () => {
          try {
            await post("/api/payments/verify", { orderId: order.orderId });
            finishDonation(info, true);
          } catch (err) {
            toast.error(
              err instanceof Error
                ? err.message
                : "Payment verification failed — our team will reconcile your receipt."
            );
          }
        },
        onError: () => toast.error("Cashfree checkout failed — please try again."),
      });
    } catch {
      toast.error("Cashfree checkout unavailable");
    }
  };

  const submit = async () => {
    if (!validateStep(2)) {
      goTo(2);
      return;
    }
    setBusy(true);
    try {
      const res = await post<DonationCreateResult>("/api/donations", {
        donorName: name.trim(),
        donorEmail: email.trim(),
        donorPhone: phone.trim() || undefined,
        amount: effectiveAmount,
        currency,
        type: giftType,
        category: selected
          ? (CATEGORY_BY_SLUG[selected.slug ?? ""] ?? "GENERAL")
          : "GENERAL",
        paymentMethod,
        campaignId: selected ? selected.id : undefined,
        foodEventId: foodEvent?.id,
        message: message.trim() || undefined,
        isAnonymous: anonymous,
        pan: pan.trim() || undefined,
      });
      const info: ReceiptInfo = {
        receiptNumber: res.receiptNumber,
        amount: res.amount,
        currency: res.currency ?? currency,
        type: res.type,
        campaignTitle: res.campaign?.title ?? selected?.title ?? "General fund",
      };
      if (!res.checkoutPending) {
        finishDonation(info);
        return;
      }
      // Gateway checkout — create the provider order, then hand the donor to
      // the provider's hosted/SDK checkout. Verification settles the donation.
      const order = await post<GatewayOrder>("/api/payments", { receiptNumber: res.receiptNumber });
      if (order.provider === "STRIPE") {
        setRedirectProvider("Stripe");
        window.location.assign(order.checkoutUrl);
        return;
      }
      if (order.provider === "RAZORPAY") {
        openRazorpay(order, info);
        return;
      }
      if (order.provider === "CASHFREE") {
        await openCashfree(order, info);
        return;
      }
      throw new Error("This payment provider is not supported.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Donation failed — please try again"
      );
    } finally {
      setBusy(false);
      setRedirectProvider(null);
    }
  };

  const resetAll = () => {
    setReceipt(null);
    setAmount(presetsFor(currency)[0] ?? 1000);
    setCustomAmount("");
    setGiftType("ONE_TIME");
    setMessage("");
    setAnonymous(false);
    setPaymentMethod("UPI");
    setErrors({});
    void refreshLive(); // "Donate again" must show the REVISED totals
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
              {formatMoney(receipt.amount, receipt.currency)}
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
              <span className="font-semibold">{formatMoney(receipt.amount, receipt.currency)}</span>
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

          {/* Offline methods: pending-verification note */}
          {OFFLINE_METHODS.includes(paymentMethod) && (
            <div
              className="mx-auto mt-4 max-w-sm rounded-lg border border-teal-500/25 bg-teal-500/10 p-3.5 text-left text-xs leading-relaxed"
              role="status"
            >
              <p className="flex items-center gap-1.5 font-semibold text-teal-700 dark:text-teal-300">
                <ShieldCheck className="size-3.5" aria-hidden /> Verified within 2 working days
              </p>
              <p className="mt-1 text-muted-foreground">
                Offline gifts are recorded as pending — our team verifies the
                payment and issues your 80G receipt after verification. We&rsquo;ll
                email {email.trim() || "you"} the moment it&rsquo;s confirmed.
              </p>
            </div>
          )}

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

          {paymentMethod === "CASH" && receipt.amount > 2000 && receipt.currency === "INR" ? (
            <p className="mx-auto mt-6 max-w-md rounded-lg border border-amber-500/25 bg-amber-500/10 p-3.5 text-left text-xs leading-relaxed text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mr-1 inline size-3.5" aria-hidden />
              <strong>Cash donations above ₹2,000 are not eligible for 80G deduction</strong>{" "}
              (Income Tax Act). This receipt is valid as your donation record — for a
              tax-deductible gift, choose UPI, bank transfer or cheque next time.
            </p>
          ) : (
            <p className="mx-auto mt-6 max-w-md text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mr-1 inline size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              Donations are eligible for deduction under Section 80G.{" "}
              {pan.trim()
                ? "Your PAN is on the receipt — it's tax-ready."
                : "Add PAN next time and the receipt is issued tax-ready."}{" "}
              A copy is on its way to {email.trim() || "your email"}.
            </p>
          )}
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_460px]">
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

                    {/* Segmented toggle — Monthly hidden when the recurring flag is off */}
                    <div
                      role="radiogroup"
                      aria-label="Gift frequency"
                      className="grid grid-cols-2 gap-1.5 rounded-xl border bg-muted/50 p-1.5"
                    >
                      {[
                        { v: "ONE_TIME" as const, label: "One-time", hint: "Give once, right now" },
                        ...(recurringOn
                          ? [{ v: "RECURRING" as const, label: "Monthly", hint: "Sustain a programme" }]
                          : []),
                      ].map((opt) => (
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

                    {/* Currency switcher (public feature flag) */}
                    {currencySwitcherOn && (
                      <div className="space-y-1.5">
                        <Label htmlFor="d-currency">Currency</Label>
                        <Select value={currency} onValueChange={setCurrency}>
                          <SelectTrigger id="d-currency" className="h-11">
                            <SelectValue placeholder="Choose currency" />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {CURRENCIES.map((c) => (
                              <SelectItem key={c.code} value={c.code}>
                                {c.code} — {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Preset amounts */}
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Label className="text-sm font-semibold">Pick an amount</Label>
                        {minDonation !== null && (
                          <Badge
                            variant="outline"
                            className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300"
                          >
                            <Info className="mr-1 size-3" aria-hidden />
                            Minimum {formatMoney(minDonation, currency)} for {selected?.title}
                          </Badge>
                        )}
                      </div>
                      <div
                        className={cn(
                          "mt-2 grid grid-cols-3 gap-2",
                          presetsFor(currency).length > 4 ? "sm:grid-cols-5" : "sm:grid-cols-4"
                        )}
                      >
                        {presetsFor(currency).map((p) => {
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
                              {formatMoney(p, currency)}
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
                            {getCurrency(currency).symbol}
                          </span>
                          <Input
                            id="custom-amount"
                            type="number"
                            inputMode="numeric"
                            min={sliderMin}
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
                          Math.min(sliderMax, Math.max(sliderMin, amount || sliderMin)),
                        ]}
                        min={sliderMin}
                        max={sliderMax}
                        step={sliderStep}
                        onValueChange={(v) => {
                          setAmount(v[0] ?? sliderMin);
                          setCustomAmount("");
                        }}
                        aria-label={`Donation amount: ${money(amount)}`}
                      />
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>{formatMoney(sliderMin, currency)}</span>
                        <span>{formatMoney(sliderMax / 2, currency)}</span>
                        <span>{formatMoney(sliderMax, currency)}</span>
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
                          {money(effectiveAmount || 0)}{" "}
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
                      {foodEvent && (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                          <span>
                            Sponsoring distribution <strong>{foodEvent.title}</strong> — {new Date(foodEvent.eventDate).toLocaleDateString("en-IN", { dateStyle: "medium" })}, {foodEvent.venue}
                          </span>
                          <button type="button" className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400" onClick={() => setFoodEvent(null)}>
                            Remove
                          </button>
                        </div>
                      )}
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
                      {errors.amount && (
                        <p
                          id="amount-error"
                          className="text-xs font-medium text-red-600 dark:text-red-400"
                          role="alert"
                        >
                          {errors.amount}
                        </p>
                      )}
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
                          aria-describedby={errors.pan ? "pan-error" : "pan-hint"}
                        />
                        {errors.pan ? (
                          <p id="pan-error" className="text-xs font-medium text-red-600 dark:text-red-400" role="alert">
                            {errors.pan}
                          </p>
                        ) : (
                          <p id="pan-hint" className="text-xs text-muted-foreground">
                            Required for 80G tax benefits. Format ABCDE1234F.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* 80G explainer */}
                    {cashOverLimit && (
                      <div
                        className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/10 p-4"
                        role="alert"
                      >
                        <AlertTriangle
                          className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
                          aria-hidden
                        />
                        <p className="text-sm leading-relaxed text-amber-800 dark:text-amber-300">
                          Cash donations above ₹2,000 are not eligible for 80G deduction
                          (Income Tax Act). For a tax-deductible gift, choose UPI, bank
                          transfer or cheque on the next step.
                        </p>
                      </div>
                    )}
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

                    {/* Anonymous + message — toggle hidden (and forced off) when the flag is off */}
                    {anonymousOn && (
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
                    )}

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
                          {money(effectiveAmount)}
                          {giftType === "RECURRING" ? " / month" : ""}
                        </span>{" "}
                        {selected ? `to ${selected.title}` : "to the general fund"}.
                      </p>
                    </div>

                    {/* Offline methods: pending-verification banner */}
                    {isOfflineMethod && (
                      <div
                        className="flex items-start gap-2.5 rounded-lg border border-teal-500/25 bg-teal-500/10 p-3.5"
                        role="status"
                      >
                        <Info
                          className="mt-0.5 size-4 shrink-0 text-teal-600 dark:text-teal-400"
                          aria-hidden
                        />
                        <p className="text-sm leading-relaxed text-foreground">
                          Offline gifts are verified by our team within 2 working days —
                          your 80G receipt is issued after verification.
                        </p>
                      </div>
                    )}

                    {/* Method select */}
                    <div className="space-y-1.5">
                      <Label htmlFor="d-method">Payment method</Label>
                      <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                        <SelectTrigger id="d-method" className="h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {paymentOptions.map((m) => (
                            <SelectItem key={m.value} value={m.value}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {currency !== "INR" && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Info className="size-3.5 shrink-0" aria-hidden />
                          UPI accepts INR only — switch the currency to INR to pay by UPI.
                        </p>
                      )}
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
                              {money(effectiveAmount)}
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

                    {/* Real gateway checkout — provider-hosted, PCI-compliant */}
                    {isGatewayMethod && (
                      <div className="rounded-xl border p-4">
                        <div className="flex items-center gap-2">
                          <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <Lock className="size-5" aria-hidden />
                          </span>
                          <div>
                            <p className="text-sm font-bold">
                              Card / Netbanking — {providerLabel}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Hosted checkout by {providerLabel}
                            </p>
                          </div>
                        </div>
                        <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                          <ShieldCheck
                            className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                            aria-hidden
                          />
                          You&rsquo;ll finish the payment on {providerLabel}&rsquo;s secure,
                          PCI-DSS-compliant checkout — no card data ever touches our
                          servers. We only record the payment reference against your
                          80G receipt.
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
                        {effectiveAmount > 2000 && (
                          <p className="mt-3 flex items-start gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            Cash donations above ₹2,000 are not eligible for 80G deduction
                            (Income Tax Act). For a tax-deductible gift, use UPI, bank
                            transfer or cheque.
                          </p>
                        )}
                      </div>
                    )}

                    {paymentMethod === "CHEQUE" && (
                      <div className="rounded-xl border p-4 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="flex size-9 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
                            <Receipt className="size-5" aria-hidden />
                          </span>
                          <p className="font-bold">Cheque / demand draft</p>
                        </div>
                        <p className="mt-3 text-muted-foreground">
                          Draw the cheque in favour of <strong>United Angel Reach Trust</strong> —
                          a volunteer collects it with a numbered acknowledgement, or courier it
                          to our Bengaluru office. It&rsquo;s verified within 2 working days of
                          receipt.
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
                    {busy && redirectProvider ? (
                      <>
                        <Loader2 className="size-5 animate-spin" aria-hidden /> Redirecting to{" "}
                        {redirectProvider}
                      </>
                    ) : (
                      <>
                        <Heart className="size-5" aria-hidden /> Confirm gift {money(effectiveAmount)}
                      </>
                    )}
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
        <div className="min-w-0 space-y-4">
          {/* Campaign progress — Milaap-style hero for the selected fund */}
          {selected && selectedSlug && (
            <Card className="overflow-hidden p-0">
              {coverImageOf(selected) ? (
                <img
                  src={coverImageOf(selected) as string}
                  alt=""
                  className="aspect-[21/9] w-full object-cover"
                />
              ) : (
                <div
                  className={cn(
                    "flex aspect-[21/9] w-full items-center justify-center",
                    accentSoft(selected.accent).chip
                  )}
                >
                  <CampaignIcon
                    icon={selected.icon ?? CAMPAIGN_CONTENT[selectedSlug]?.icon ?? "heart"}
                    className="size-10 opacity-60"
                  />
                </div>
              )}
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      You&rsquo;re supporting
                    </p>
                    <Link
                      href={`/campaigns/${selectedSlug}`}
                      className="mt-0.5 block truncate font-bold hover:underline"
                    >
                      {selected.title}
                    </Link>
                  </div>
                  <Badge className="shrink-0 border-0 bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">
                    <Landmark className="mr-1 size-3" aria-hidden /> 80G
                  </Badge>
                </div>
                {(() => {
                  const pct =
                    selected.targetAmount > 0
                      ? Math.min(100, Math.round((selected.raisedAmount / selected.targetAmount) * 100))
                      : 0;
                  return (
                    <>
                      <Progress
                        value={pct}
                        className="mt-3 h-2.5"
                        aria-label={`${pct}% raised`}
                      />
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                            {formatINRCompact(selected.raisedAmount)}
                          </span>{" "}
                          raised of {formatINRCompact(selected.targetAmount)}
                        </span>
                        <span className="font-semibold text-foreground">{pct}%</span>
                      </div>
                      {typeof selected.supporterCount === "number" && selected.supporterCount > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {selected.supporterCount} supporter{selected.supporterCount === 1 ? "" : "s"} so far —
                          be one of them.
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            </Card>
          )}

          {/* Running summary */}
          <Card className="p-0">
            <div className="flex items-center justify-between rounded-t-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3 text-white">
              <h3 className="text-xs font-bold uppercase tracking-wide">Your gift</h3>
              <Sparkles className="size-4" aria-hidden />
            </div>
            <div className="p-5">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400">
                {money(effectiveAmount || 0)}
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
                <span className="max-w-[60%] truncate text-right font-semibold">
                  {paymentOptions.find((m) => m.value === paymentMethod)?.label ?? paymentMethod}
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
                paymentMethod === "CASH" && effectiveAmount > 2000 && isINR
                  ? { icon: AlertTriangle, label: "No 80G (cash rule)" }
                  : { icon: Landmark, label: "80G eligible" },
                { icon: ShieldCheck, label: "Secure" },
                isOfflineMethod
                  ? { icon: Receipt, label: "Verified in 2 days" }
                  : { icon: Zap, label: "Immediate impact" },
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
            </div>
          </Card>

          {/* Where money goes — accent-chip rows */}
          <Card className="p-5">
            <h3 className="flex items-center gap-2 font-semibold">
              <HandCoins className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />{" "}
              Where it goes
            </h3>
            <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
              {[
                { amt: "₹500", desc: "one family's ration kit, QR-traced to their door", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
                { amt: "₹1,000", desc: "a school cyber-safety session for 50 seniors or students", chip: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400" },
                { amt: "₹10,000", desc: "a year of monthly follow-ups for one person in recovery", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
              ].map((r) => (
                <li key={r.amt} className="flex items-start gap-2.5">
                  <span className={cn("shrink-0 rounded-lg px-2 py-0.5 text-xs font-bold", r.chip)}>
                    {r.amt}
                  </span>
                  <span className="leading-snug">{r.desc}</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Tax & compliance — what Indian donors are told by policy */}
          <Card className="p-5">
            <h3 className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />{" "}
              Tax &amp; transparency
            </h3>
            <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-muted-foreground">
              <li className="flex items-start gap-2">
                <Landmark className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <span>
                  Registered under <strong className="text-foreground">12A/12AB</strong>; donations
                  are deductible <strong className="text-foreground">50% under Section 80G</strong>{" "}
                  for Indian taxpayers.{" "}
                  <Link href="/policies" className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
                    Tax policy
                  </Link>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Receipt className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <span>
                  Share your PAN and the receipt ships tax-ready; the annual statement (Form 10BE)
                  is filed with the Income Tax Department.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                <span>
                  Cash gifts above ₹2,000 don&rsquo;t qualify for 80G (Income Tax Act) — pay
                  online to claim the deduction.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <span>
                  Refund window and grievance contact are in our{" "}
                  <Link href="/policies" className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
                    donation &amp; refund policy
                  </Link>
                  . Audited accounts published yearly.
                </span>
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
                      {formatMoney(d.amount, d.currency ?? "INR")}
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
