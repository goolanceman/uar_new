"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "@/lib/router";
import { get, post } from "@/lib/api-client";
import { cn, formatINR, timeAgo, titleCase } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Section, EmptyState, CampaignIcon, accentClasses } from "@/components/public/shared";
import { CAMPAIGN_CONTENT } from "@/components/public/campaign-data";
import {
  CheckCircle2,
  Dog,
  Flower2,
  HandCoins,
  Heart,
  Loader2,
  Lock,
  Package,
  Pill,
  ReceiptText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

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
  featured?: boolean;
}

interface RecentDonation {
  id: string;
  donorName: string;
  amount: number;
  isAnonymous?: boolean;
  type?: string;
  createdAt?: string;
  campaign?: { title?: string } | null;
  campaignId?: string | null;
}

const PRESETS = [500, 1000, 2500, 5000, 10000];

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
  { value: "UPI", label: "UPI (GPay / PhonePe / Paytm)" },
  { value: "RAZORPAY", label: "Card / Netbanking (Razorpay)" },
  { value: "BANK_TRANSFER", label: "Bank transfer (NEFT/IMPS)" },
  { value: "CASH", label: "Cash (volunteer collection)" },
];

export function DonatePage() {
  const { query } = useRoute();
  const { user } = useAuth();

  const [campaigns, setCampaigns] = useState<LiveCampaign[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("general");
  const [amount, setAmount] = useState<number>(1000);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [monthly, setMonthly] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pan, setPan] = useState("");
  const [message, setMessage] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("UPI");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{
    receiptNumber: string;
    amount: number;
    type: string;
  } | null>(null);
  const [recent, setRecent] = useState<RecentDonation[] | null>(null);

  const slugFromUrl = query.get("campaign");

  // Load campaigns + recent donations
  useEffect(() => {
    let alive = true;
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
    if (found) setSelectedId(found.id);
  }, [slugFromUrl, campaigns]);

  // Prefill donor details from session
  useEffect(() => {
    if (!user) return;
    setName((n) => n || user.name || "");
    setEmail((e) => e || user.email || "");
    setPhone((p) => p || user.phone || "");
  }, [user]);

  const selected = useMemo(
    () => campaigns?.find((c) => c.id === selectedId) ?? null,
    [campaigns, selectedId]
  );

  const effectiveAmount = customAmount ? Number(customAmount) || 0 : amount;

  const submit = async () => {
    if (effectiveAmount < 10) {
      toast.error("Minimum donation is ₹10");
      return;
    }
    if (!name.trim()) {
      toast.error("Please enter your name");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error("Please enter a valid email (for the 80G receipt)");
      return;
    }
    setBusy(true);
    try {
      const res = await post<{ receiptNumber: string; amount: number; type: string }>(
        "/api/donations",
        {
          donorName: name.trim(),
          donorEmail: email.trim(),
          donorPhone: phone.trim() || undefined,
          amount: effectiveAmount,
          type: monthly ? "RECURRING" : "ONE_TIME",
          category: selected ? (CATEGORY_BY_SLUG[selected.slug ?? ""] ?? "GENERAL") : "GENERAL",
          paymentMethod,
          campaignId: selected ? selected.id : undefined,
          message: message.trim() || undefined,
          isAnonymous: anonymous,
          pan: pan.trim() || undefined,
        }
      );
      setReceipt(res);
      toast.success(`Thank you! Receipt ${res.receiptNumber} generated.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Donation failed — please try again");
    } finally {
      setBusy(false);
    }
  };

  const resetAll = () => {
    setReceipt(null);
    setAmount(1000);
    setCustomAmount("");
    setMonthly(false);
    setMessage("");
    setAnonymous(false);
  };

  /* ---------------- SUCCESS CARD ---------------- */
  if (receipt) {
    return (
      <Section className="mx-auto max-w-xl">
        <Card className="p-8 text-center">
          <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="size-9" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Thank you, {name.split(" ")[0]}!</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your {monthly ? "monthly " : ""}gift of{" "}
            <span className="font-bold text-foreground">{formatINR(receipt.amount)}</span> has been
            recorded.
          </p>
          <div className="mx-auto mt-5 max-w-sm rounded-xl border bg-muted/40 p-4 text-left text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Receipt</span>
              <Badge variant="outline" className="font-mono">
                {receipt.receiptNumber}
              </Badge>
            </div>
            <Separator className="my-3" />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Type</span>
              <span className="font-semibold">{titleCase(receipt.type)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Fund</span>
              <span className="font-semibold">{selected?.title ?? "General fund"}</span>
            </div>
          </div>
          <p className="mx-auto mt-5 max-w-md text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mr-1 inline size-4 text-emerald-600" aria-hidden />
            Donations to United Angel Reach Trust are eligible for deduction under Section 80G of
            the Income-tax Act. If you provided PAN, your receipt is on its way to your email.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button className="bg-emerald-600 hover:bg-emerald-700" asChild>
              <Link href="/donor">Open Donor Portal</Link>
            </Button>
            <Button variant="outline" onClick={resetAll}>
              <Heart className="size-4" aria-hidden /> Donate again
            </Button>
          </div>
        </Card>
      </Section>
    );
  }

  /* ---------------- FORM ---------------- */
  return (
    <Section
      title="Donate"
      subtitle="≥92% of every rupee reaches programmes. Every kit, pad and medicine is QR-traced to a doorstep."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* ------- Left: form ------- */}
        <Card className="p-5 sm:p-6">
          {/* Fund picker */}
          <p className="text-sm font-bold">1 · Choose a fund</p>
          <div className="mt-3 grid gap-2" role="radiogroup" aria-label="Donation fund">
            {campaigns === null ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))
            ) : (
              <>
                <FundRadio
                  checked={selectedId === "general"}
                  onSelect={() => setSelectedId("general")}
                  title="General fund — where it's needed most"
                  subtitle="Ops desk routes it to the highest-need programme this week"
                  accent="emerald"
                  icon="heart"
                />
                {campaigns
                  .filter((c) => c.status !== "CANCELLED")
                  .map((c) => (
                    <FundRadio
                      key={c.id}
                      checked={selectedId === c.id}
                      onSelect={() => setSelectedId(c.id)}
                      title={c.title}
                      subtitle={c.tagline ?? ""}
                      accent={c.accent ?? CAMPAIGN_CONTENT[c.slug ?? ""]?.accent ?? "emerald"}
                      icon={c.icon ?? CAMPAIGN_CONTENT[c.slug ?? ""]?.icon ?? "heart"}
                    />
                  ))}
              </>
            )}
          </div>

          <Separator className="my-6" />

          {/* Amount */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold">2 · Amount</p>
            <div className="flex items-center gap-2">
              <span className={cn("text-xs", monthly ? "font-semibold text-emerald-700" : "text-muted-foreground")}>
                Monthly
              </span>
              <Switch
                checked={monthly}
                onCheckedChange={setMonthly}
                aria-label="Make this a monthly recurring donation"
              />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setAmount(p);
                  setCustomAmount("");
                }}
                aria-pressed={!customAmount && amount === p}
                className={cn(
                  "min-h-[44px] rounded-lg border text-sm font-semibold transition",
                  !customAmount && amount === p
                    ? "border-emerald-600 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-500/30"
                    : "bg-background hover:bg-accent"
                )}
              >
                ₹{p.toLocaleString("en-IN")}
              </button>
            ))}
          </div>
          <div className="mt-2 max-w-xs">
            <Label htmlFor="custom-amount" className="text-xs text-muted-foreground">
              Or enter a custom amount (₹)
            </Label>
            <Input
              id="custom-amount"
              type="number"
              min={10}
              placeholder="e.g. 18000"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              className="mt-1"
            />
          </div>

          <Separator className="my-6" />

          {/* Donor details */}
          <p className="text-sm font-bold">3 · Your details</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="d-name">Full name *</Label>
              <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-email">Email *</Label>
              <Input
                id="d-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-phone">Phone</Label>
              <Input id="d-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-pan">
                PAN <span className="font-normal text-muted-foreground">(optional — for 80G)</span>
              </Label>
              <Input
                id="d-pan"
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                placeholder="ABCDE1234F"
                maxLength={10}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="d-msg">Message (optional)</Label>
              <Textarea
                id="d-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="A word for the team or the family you're helping…"
                rows={2}
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={anonymous} onCheckedChange={(v) => setAnonymous(v === true)} />
              Give anonymously — my name won&rsquo;t appear on public lists
            </label>
          </div>

          <Separator className="my-6" />

          {/* Payment */}
          <p className="text-sm font-bold">4 · Payment method</p>
          <div className="mt-3 max-w-sm space-y-1.5">
            <Label htmlFor="d-method">How would you like to pay?</Label>
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

          <Button
            size="lg"
            className="mt-6 h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
            onClick={submit}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="size-5 animate-spin" aria-hidden /> Processing…
              </>
            ) : (
              <>
                <Heart className="size-5" aria-hidden /> Give {formatINR(effectiveAmount)}
                {monthly ? " / month" : ""}
              </>
            )}
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden /> 80G eligible · audited accounts · QR-traced impact
          </p>
        </Card>

        {/* ------- Right: where money goes ------- */}
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="flex items-center gap-2 font-semibold">
              <HandCoins className="size-5 text-emerald-600" aria-hidden /> Where your money goes
            </h3>
            <ul className="mt-4 space-y-3.5 text-sm">
              <li className="flex gap-3">
                <Package className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
                <span>
                  <span className="font-bold">₹950</span> — one family&rsquo;s ration kit for 30
                  days, QR-traced to their door
                </span>
              </li>
              <li className="flex gap-3">
                <Flower2 className="mt-0.5 size-5 shrink-0 text-pink-600" aria-hidden />
                <span>
                  <span className="font-bold">₹18,000</span> — one school&rsquo;s pad bank for a
                  full year (120 girls)
                </span>
              </li>
              <li className="flex gap-3">
                <Pill className="mt-0.5 size-5 shrink-0 text-teal-600" aria-hidden />
                <span>
                  <span className="font-bold">₹150–2,500</span> — a chronic patient&rsquo;s monthly
                  medicines (Jan Aushadhi rates)
                </span>
              </li>
              <li className="flex gap-3">
                <Dog className="mt-0.5 size-5 shrink-0 text-lime-600" aria-hidden />
                <span>
                  <span className="font-bold">₹900</span> — a street dog&rsquo;s food for a month,
                  fed by volunteers
                </span>
              </li>
            </ul>
            <Separator className="my-4" />
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">Administration cost</span>
                <span className="font-bold text-emerald-700">&lt; 8%</span>
              </div>
              <Progress value={8} className="mt-2 h-2" aria-label="Less than 8 percent admin cost" />
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                ≥92% reaches programmes directly. Accounts are audited annually; 80G &amp; 12A
                registered. Receipts carry your PAN when provided.
              </p>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="flex items-center gap-2 font-semibold">
              <ReceiptText className="size-5 text-emerald-600" aria-hidden /> Recent donations
            </h3>
            {recent === null ? (
              <div className="mt-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded-lg" />
                ))}
              </div>
            ) : recent.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Be the first today"
                hint="Recent gifts will appear here — anonymously if you prefer."
                className="border-0 bg-transparent p-4"
              />
            ) : (
              <ul className="mt-4 max-h-64 space-y-2.5 overflow-y-auto pr-1 scrollbar-thin">
                {recent.slice(0, 20).map((d) => (
                  <li key={d.id} className="flex items-center gap-2.5 text-sm">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
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
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {timeAgo(d.createdAt)}
                      </span>
                    </span>
                    <span className="shrink-0 font-bold text-emerald-700">
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

function FundRadio({
  checked,
  onSelect,
  title,
  subtitle,
  accent,
  icon,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  subtitle?: string;
  accent: string;
  icon: string;
}) {
  const a = accentClasses(accent);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "flex min-h-[44px] items-center gap-3 rounded-lg border p-3 text-left transition",
        checked
          ? "border-emerald-600 bg-emerald-50/60 ring-2 ring-emerald-500/30"
          : "bg-background hover:bg-accent"
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          a.bg100,
          a.text700
        )}
      >
        <CampaignIcon icon={icon} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {subtitle && (
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        )}
      </span>
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
          checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-input"
        )}
      >
        {checked && <CheckCircle2 className="size-3.5" />}
      </span>
    </button>
  );
}
