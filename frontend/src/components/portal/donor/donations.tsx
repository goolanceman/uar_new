"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CreditCard,
  HandCoins,
  Landmark,
  Pause,
  Play,
  ReceiptText,
  RefreshCw,
  Repeat,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch, post } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatMoney, formatDate, titleCase, DEFAULT_CURRENCY } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { DataField } from "@/components/shared/data-field";
import { StatusBadge, humanize } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportMenu, downloadCsv, type CsvColumn } from "@/components/shared/csv";
import { ViewSwitcher, useViewPref, type DataViewMode } from "@/components/shared/view-switcher";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  asArray,
  currentFyLabel,
  estimateDeduction,
  fyLabel,
  fyRange,
  fyStartYear,
  fyTimestamps,
  is80gEligible,
  openReceipt,
  payPendingDonation,
} from "./portal-utils";

interface Donation {
  id: string;
  receiptNumber: string;
  amount: number;
  currency?: string;
  type: string; // ONE_TIME | RECURRING
  category: string;
  paymentMethod: string; // UPI | RAZORPAY | STRIPE | CASH | BANK_TRANSFER | CHEQUE
  paymentStatus: string; // PENDING | COMPLETED | FAILED | REFUNDED | CANCELLED
  receiptStatus?: string | null; // PENDING | ISSUED | CANCELLED | REISSUED
  transactionId?: string | null;
  message?: string | null;
  createdAt: string;
  campaign?: { title: string } | null;
}

const CATEGORIES = [
  "GENERAL",
  "FOOD_DISTRIBUTION",
  "SANITARY_PADS",
  "MEDICAL",
  "AWARENESS",
  "SAFETY",
  "ANIMAL",
  "MOBILITY",
  "EDUCATION_SUPPORT",
  "EMERGENCY",
] as const;

const CATEGORY_STYLES: Record<string, string> = {
  GENERAL: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  FOOD_DISTRIBUTION: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  SANITARY_PADS: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-400",
  MEDICAL: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  AWARENESS: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  SAFETY: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
  ANIMAL: "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-400",
  MOBILITY: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  EDUCATION_SUPPORT: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  EMERGENCY: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
};

function eightyGNote(d: Donation): string {
  if (d.paymentStatus !== "COMPLETED")
    return `80G receipts are issued for completed payments only — this donation is ${humanize(d.paymentStatus).toLowerCase()}.`;
  if ((d.paymentMethod ?? "").toUpperCase() === "CASH" && d.amount > 2000)
    return `Not 80G-eligible: cash gifts above ${formatMoney(2000, "INR")} do not qualify for tax deduction (Sec 80G).`;
  if (!d.receiptNumber)
    return "Receipt number will appear once the payment is reconciled by the finance team.";
  return "Eligible for 50% deduction u/s 80G — quote the receipt number in your ITR filing.";
}

/** A monthly-giving commitment (GET /api/donations/recurring/mine). */
interface RecurringCommitment {
  id: string;
  amount: number;
  currency: string;
  recurringFrequency: string; // WEEKLY | MONTHLY | QUARTERLY | YEARLY
  recurringStatus: string; // ACTIVE | PAUSED | CANCELLED
  nextChargeAt: string | null;
  createdAt: string;
  category?: string;
  campaign?: { id: string; title: string } | null;
  installmentCount: number;
  paidTotal: number;
  installments: Array<{
    id: string;
    receiptNumber: string;
    amount: number;
    currency: string;
    paymentStatus: string;
    createdAt: string;
  }>;
}

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  QUARTERLY: "quarterly",
  YEARLY: "yearly",
};

const CSV_COLUMNS: CsvColumn<Donation>[] = [
  { header: "Receipt no.", value: (d) => d.receiptNumber },
  { header: "Date", value: (d) => formatDate(d.createdAt) },
  { header: "Campaign", value: (d) => d.campaign?.title ?? "General fund" },
  { header: "Type", value: (d) => titleCase(d.type) },
  { header: "Category", value: (d) => titleCase(d.category) },
  { header: "Method", value: (d) => titleCase(d.paymentMethod) },
  { header: "Status", value: (d) => titleCase(d.paymentStatus) },
  { header: "Receipt status", value: (d) => titleCase(d.receiptStatus ?? "Issued") },
  { header: "Amount", value: (d) => d.amount },
  { header: "Currency", value: (d) => d.currency || DEFAULT_CURRENCY },
  { header: "80G eligible", value: (d) => (is80gEligible(d) ? "Yes" : "No") },
];

export default function DonorDonations({ user }: { user: SessionUser }) {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [recurring, setRecurring] = useState<RecurringCommitment[]>([]);
  const [pan, setPan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Monthly-giving actions
  const [recurringBusy, setRecurringBusy] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    { commitment: RecurringCommitment; action: "PAUSED" | "ACTIVE" | "CANCELLED" } | null
  >(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  // Org default currency for the aggregate strip (each row keeps its own).
  const [orgCurrency, setOrgCurrency] = useState<string>(DEFAULT_CURRENCY);

  // Filters
  const [fy, setFy] = useState(String(fyStartYear()));
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [category, setCategory] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");

  const [view, setView] = useViewPref("donor-donations", "table");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, me, pub, rec] = await Promise.all([
        get<unknown>("/api/donations?mine=1"),
        get<{ user?: { pan?: string | null } | null }>("/api/auth/me").catch(() => null),
        get<{ currency?: string }>("/api/settings/public").catch(() => null),
        // Monthly-giving commitments — 404-safe for backends older than this feature
        get<unknown>("/api/donations/recurring/mine").catch(() => []),
      ]);
      setDonations(asArray<Donation>(d));
      setRecurring(asArray<RecurringCommitment>(rec));
      setPan(me?.user?.pan ?? null);
      if (pub?.currency) setOrgCurrency(pub.currency);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load donations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fyOptions = useMemo(() => {
    const years = new Set<number>([fyStartYear()]);
    donations.forEach((d) => years.add(fyStartYear(new Date(d.createdAt))));
    return Array.from(years).sort((a, b) => b - a);
  }, [donations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inFy = fy === "all"
      ? () => true
      : (() => {
          const { start, end } = fyTimestamps(Number(fy));
          return (t: number) => t >= start && t <= end;
        })();
    const fromT = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toT = to ? new Date(`${to}T23:59:59`).getTime() : null;
    return donations.filter((d) => {
      if (!inFy(new Date(d.createdAt).getTime())) return false;
      if (status !== "all" && d.paymentStatus !== status) return false;
      if (type !== "all" && d.type !== type) return false;
      if (category !== "all" && d.category !== category) return false;
      if (fromT && new Date(d.createdAt).getTime() < fromT) return false;
      if (toT && new Date(d.createdAt).getTime() > toT) return false;
      if (
        q &&
        !`${d.receiptNumber} ${d.campaign?.title ?? "general fund"} ${d.message ?? ""} ${titleCase(d.category)}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [donations, fy, status, type, category, from, to, query]);

  /* --------------------------- FY totals strip --------------------------- */
  const stripBase = useMemo(() => {
    if (fy === "all") return filtered.filter((d) => d.paymentStatus === "COMPLETED");
    const { start, end } = fyTimestamps(Number(fy));
    return donations.filter((d) => {
      const t = new Date(d.createdAt).getTime();
      return t >= start && t <= end && d.paymentStatus === "COMPLETED";
    });
  }, [donations, filtered, fy]);
  const stripTotal = stripBase.reduce((s, d) => s + (d.amount || 0), 0);
  const stripEligible = stripBase.filter(is80gEligible);
  const stripDeduction = Math.round(stripEligible.reduce((s, d) => s + (d.amount || 0), 0) * 0.5);
  const stripLabel = fy === "all" ? "All time" : fyLabel(Number(fy));
  // Aggregates keep the plain sum but are labelled with the org currency; a
  // muted note discloses mixed-currency giving. No FX conversion anywhere.
  const mixedCurrency =
    new Set(stripBase.map((d) => d.currency || DEFAULT_CURRENCY)).size > 1;

  const clearFilters = () => {
    setFy(String(fyStartYear()));
    setStatus("all");
    setType("all");
    setCategory("all");
    setFrom("");
    setTo("");
    setQuery("");
  };

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.info("Nothing to export with the current filters");
      return;
    }
    downloadCsv(`uar-donations-${stripLabel.replace(/\s/g, "-").toLowerCase()}`, CSV_COLUMNS, filtered);
    toast.success(`Exported ${filtered.length} donation${filtered.length === 1 ? "" : "s"} to CSV`);
  };

  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  /* ------------------------ monthly giving actions ----------------------- */
  const runRecurringAction = async () => {
    if (!confirmAction) return;
    const { commitment, action } = confirmAction;
    setConfirmBusy(true);
    try {
      await patch(`/api/donations/recurring/${commitment.id}`, { recurringStatus: action });
      toast.success(
        action === "PAUSED"
          ? "Monthly giving paused — no reminders while it's paused."
          : action === "ACTIVE"
            ? "Monthly giving resumed."
            : "Monthly giving cancelled."
      );
      setConfirmAction(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the commitment");
    } finally {
      setConfirmBusy(false);
    }
  };

  const payInstallment = async (c: RecurringCommitment) => {
    setRecurringBusy(c.id);
    try {
      const created = await post<{
        receiptNumber: string;
        checkoutPending?: boolean;
      }>("/api/donations", {
        amount: c.amount,
        currency: c.currency || undefined,
        recurringParentId: c.id,
        campaignId: c.campaign?.id || undefined,
        paymentMethod: "RAZORPAY",
        donorName: user.name,
        donorEmail: user.email,
      });
      if (!created.checkoutPending) {
        toast.success(`Installment recorded — receipt ${created.receiptNumber}.`);
        await load();
        return;
      }
      const result = await payPendingDonation({
        receiptNumber: created.receiptNumber,
        description: c.campaign?.title ? `Monthly giving — ${c.campaign.title}` : "Monthly giving installment",
        name: user.name,
        email: user.email,
      });
      if (result.ok) {
        toast.success("Payment confirmed — thank you for your continued giving!");
        await load();
      } else {
        toast.error(result.error);
        if (result.redirectToDonate) navigate("/donate");
        else await load(); // verification may have settled server-side — refresh
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not pay this installment");
    } finally {
      setRecurringBusy(null);
    }
  };

  /* ------------------------------- rows ---------------------------------- */
  const renderDetail = (d: Donation) => (
    <div className="grid gap-4 rounded-lg bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <DataField label="Receipt number" value={d.receiptNumber || "—"} mono copy={Boolean(d.receiptNumber)} />
      <DataField label="Payment method" value={titleCase(d.paymentMethod)} />
      <DataField label="Transaction ID" value={d.transactionId ?? "—"} mono={Boolean(d.transactionId)} copy={Boolean(d.transactionId)} />
      <DataField label="Campaign" value={d.campaign?.title ?? "General fund"} />
      <DataField label="Receipt status" value={titleCase(d.receiptStatus ?? "Issued")} />
      <DataField label="Date" value={formatDate(d.createdAt)} />
      <div className="sm:col-span-2 lg:col-span-3">
        <p className="flex items-start gap-2 rounded-lg border border-teal-500/20 bg-teal-500/5 p-3 text-xs text-muted-foreground">
          <Landmark className="mt-0.5 size-3.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
          {eightyGNote(d)}
        </p>
      </div>
      {d.message && (
        <div className="sm:col-span-2 lg:col-span-3">
          <p className="border-l-2 border-primary/30 pl-2 text-xs italic text-muted-foreground">
            “{d.message}”
          </p>
        </div>
      )}
    </div>
  );

  const rowActions = (d: Donation) =>
    d.paymentStatus === "COMPLETED" && d.receiptNumber ? (
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 gap-1 sm:min-h-9"
        onClick={(e) => {
          e.stopPropagation();
          openReceipt(d.receiptNumber);
        }}
        aria-label={`Open 80G receipt ${d.receiptNumber}`}
      >
        <ReceiptText className="size-4" aria-hidden="true" />
        80G receipt
      </Button>
    ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="My donations"
        description={
          loading
            ? "Loading your giving history…"
            : `${filtered.length} of ${donations.length} donation${donations.length === 1 ? "" : "s"} in view`
        }
        icon={<HandCoins className="size-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              columns={CSV_COLUMNS}
              rows={filtered}
              filename="uar-donations"
              disabled={loading || filtered.length === 0}
              extraItems={
                <button
                  type="button"
                  onClick={exportCsv}
                  className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <ReceiptText className="size-4" aria-hidden="true" />
                  Export FY statement CSV
                </button>
              }
            />
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-1.5 sm:min-h-9"
              onClick={load}
              aria-label="Refresh donations"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
          </div>
        }
      />

      {/* PAN banner */}
      {!loading && !pan && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200"
        >
          <ShieldAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">Add PAN in Profile to enable 80G receipts.</span>{" "}
            Without it your receipts print without the PAN needed for ITR filing.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 border-amber-500/40 text-amber-900 hover:bg-amber-500/20 dark:text-amber-200 sm:min-h-9"
            onClick={() => navigate("/donor/profile")}
          >
            Open profile
          </Button>
        </div>
      )}

      {/* FY totals strip */}
      <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`${stripLabel} given`}
          value={loading ? "" : formatMoney(stripTotal, orgCurrency)}
          hint={`${stripBase.length} completed`}
          icon={<HandCoins className="size-5" />}
          accent="emerald"
          loading={loading}
        />
        <StatCard
          label="80G-eligible"
          value={loading ? "" : formatMoney(stripEligible.reduce((s, d) => s + d.amount, 0), orgCurrency)}
          hint={`${stripEligible.length} of ${stripBase.length} receipts`}
          icon={<ReceiptText className="size-5" />}
          accent="teal"
          loading={loading}
        />
        <StatCard
          label="Est. deduction"
          value={loading ? "" : formatMoney(stripDeduction, orgCurrency)}
          hint="50% u/s 80G, indicative"
          icon={<Landmark className="size-5" />}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="Filtered view"
          value={
            loading
              ? ""
              : formatMoney(
                  filtered.filter((d) => d.paymentStatus === "COMPLETED").reduce((s, d) => s + d.amount, 0),
                  orgCurrency
                )
          }
          hint={`${filtered.length} rows match current filters`}
          icon={<Search className="size-5" />}
          accent="lime"
          loading={loading}
        />
      </div>
      {mixedCurrency && (
        <p className="text-xs text-muted-foreground" role="note">
          Amounts shown in {orgCurrency} — donations in other currencies are
          listed with their own currency below.
        </p>
      )}
      </div>

      {/* ---------------------- Monthly giving ---------------------- */}
      <SectionCard
        title="Monthly giving"
        description="Your recurring commitments — every installment is one you approve"
        icon={<Repeat className="size-5" />}
      >
        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : recurring.length === 0 ? (
          <EmptyState
            icon={<Repeat className="size-5" />}
            title="No monthly commitments yet"
            hint="Set up a recurring gift from the Donate page — you choose the amount and cadence, approve each installment and can pause anytime."
          >
            <Button className="min-h-11" onClick={() => navigate("/donate")}>
              <Repeat className="size-4" aria-hidden="true" />
              Start monthly giving
            </Button>
          </EmptyState>
        ) : (
          <div className="grid gap-3">
            {recurring.map((c) => {
              const nextDue = c.nextChargeAt ? new Date(c.nextChargeAt) : null;
              const active = c.recurringStatus === "ACTIVE";
              const settled = c.installments.filter((i) => i.paymentStatus === "COMPLETED");
              return (
                <div key={c.id} className="rounded-xl border bg-background p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold">
                          {c.campaign?.title ?? "General fund"}
                        </p>
                        <StatusBadge status={c.recurringStatus} />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatMoney(c.amount, c.currency || DEFAULT_CURRENCY)}{" "}
                        {FREQUENCY_LABELS[c.recurringFrequency] ?? "recurring"} ·{" "}
                        {c.installmentCount} installment{c.installmentCount === 1 ? "" : "s"} paid{" "}
                        ({formatMoney(c.paidTotal, c.currency || DEFAULT_CURRENCY)})
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {nextDue && active
                          ? `Next installment due ${formatDate(nextDue.toISOString())} — we'll remind you, you approve the payment.`
                          : active
                            ? "Next date is being scheduled — pay your first installment below."
                            : c.recurringStatus === "PAUSED"
                              ? "Paused — resume anytime to keep the reminders coming."
                              : "Cancelled — start a new commitment from the Donate page."}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {active && (
                        <Button
                          size="sm"
                          className="min-h-11 gap-1.5 sm:min-h-9"
                          disabled={recurringBusy === c.id}
                          onClick={() => payInstallment(c)}
                          aria-label={`Pay the current installment for ${c.campaign?.title ?? "monthly giving"}`}
                        >
                          <CreditCard className="size-4" aria-hidden="true" />
                          Pay installment
                        </Button>
                      )}
                      {(c.recurringStatus === "ACTIVE" || c.recurringStatus === "PAUSED") && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11 gap-1.5 sm:min-h-9"
                            onClick={() => setConfirmAction({ commitment: c, action: c.recurringStatus === "ACTIVE" ? "PAUSED" : "ACTIVE" })}
                            aria-label={c.recurringStatus === "ACTIVE" ? "Pause monthly giving" : "Resume monthly giving"}
                          >
                            {c.recurringStatus === "ACTIVE" ? (
                              <>
                                <Pause className="size-4" aria-hidden="true" /> Pause
                              </>
                            ) : (
                              <>
                                <Play className="size-4" aria-hidden="true" /> Resume
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11 gap-1.5 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 sm:min-h-9"
                            onClick={() => setConfirmAction({ commitment: c, action: "CANCELLED" })}
                            aria-label="Cancel monthly giving"
                          >
                            <XCircle className="size-4" aria-hidden="true" />
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {c.installments.length > 0 && (
                    <details className="mt-3 border-t pt-3">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                        Previous payments ({settled.length} of {c.installments.length} shown settled)
                      </summary>
                      <div className="mt-2 grid gap-1.5">
                        {c.installments.map((i) => (
                          <div key={i.id} className="flex items-center justify-between gap-3 text-xs">
                            <span className="font-mono text-muted-foreground">{i.receiptNumber}</span>
                            <span className="text-muted-foreground">{formatDate(i.createdAt)}</span>
                            <StatusBadge status={i.paymentStatus} />
                            <span className="font-semibold">
                              {formatMoney(i.amount, i.currency || c.currency || DEFAULT_CURRENCY)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Toolbar — filters + view switcher */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="min-w-[9rem] flex-1 space-y-1.5">
          <Label htmlFor="don-fy">Financial year</Label>
          <Select value={fy} onValueChange={setFy}>
            <SelectTrigger id="don-fy" className="w-full" aria-label="Filter by financial year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              {fyOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {fyLabel(y)} · Apr {y} → Mar {y + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[8rem] space-y-1.5">
          <Label htmlFor="don-status">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="don-status" className="w-full" aria-label="Filter by payment status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["COMPLETED", "PENDING", "FAILED", "REFUNDED", "CANCELLED"].map((s) => (
                <SelectItem key={s} value={s}>
                  {titleCase(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[8rem] space-y-1.5">
          <Label htmlFor="don-type">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="don-type" className="w-full" aria-label="Filter by donation type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="ONE_TIME">One time</SelectItem>
              <SelectItem value="RECURRING">Recurring</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[8rem] space-y-1.5">
          <Label htmlFor="don-category">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="don-category" className="w-full" aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {titleCase(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="don-from">From</Label>
          <Input
            id="don-from"
            type="date"
            className="w-[9.5rem]"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Filter from date"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="don-to">To</Label>
          <Input
            id="don-to"
            type="date"
            className="w-[9.5rem]"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Filter to date"
          />
        </div>
        <div className="min-w-[11rem] flex-1 space-y-1.5">
          <Label htmlFor="don-search">Search</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="don-search"
              className="pl-9"
              placeholder="Receipt, campaign, message…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <ViewSwitcher
          value={view}
          onChange={(m: DataViewMode) => setView(m)}
          options={["table", "list"]}
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : donations.length === 0 ? (
        <SectionCard title="Donations" icon={<HandCoins className="size-5" />}>
          <EmptyState
            icon={<HandCoins className="size-5" />}
            title="No donations yet"
            hint="Your generosity fuels ration kits, medicines, animal care and safe corridors. Every rupee is tracked to the ground."
          >
            <Button className="min-h-11" onClick={() => navigate("/donate")}>
              <HandCoins className="size-4" aria-hidden="true" />
              Make your first donation
            </Button>
          </EmptyState>
        </SectionCard>
      ) : filtered.length === 0 ? (
        <SectionCard title="Donations" icon={<Search className="size-5" />}>
          <EmptyState
            icon={<Search className="size-5" />}
            title="Nothing matches these filters"
            hint="Try widening the year, status or category — or clear the search."
          >
            <Button variant="outline" className="min-h-11" onClick={clearFilters}>
              Clear filters
            </Button>
          </EmptyState>
        </SectionCard>
      ) : view === "table" ? (
        <SectionCard
          title="Giving history"
          description="Click any row to expand the full donation sheet"
          bodyClassName="px-0"
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" aria-label="Expand" />
                  <TableHead>Receipt</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Towards</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">80G</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const expanded = expandedId === d.id;
                  return (
                    <Fragment key={d.id}>
                    <TableRow
                      className={cn("cursor-pointer", expanded && "bg-muted/50")}
                      onClick={() => toggleExpand(d.id)}
                      aria-expanded={expanded}
                    >
                      <TableCell>
                        {expanded ? (
                          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-xs font-semibold">{d.receiptNumber}</p>
                        <p className="mt-0.5 md:hidden text-xs text-muted-foreground">
                          {titleCase(d.type)} · {titleCase(d.paymentStatus)}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(d.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-52 truncate">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "hidden size-1.5 rounded-full sm:inline-block",
                              "bg-muted-foreground/40"
                            )}
                            aria-hidden="true"
                          />
                          {d.campaign?.title ?? "General fund"}
                        </span>
                        <span
                          className={cn(
                            "mt-1 inline-block rounded-full border px-1.5 text-[10px]",
                            CATEGORY_STYLES[d.category] ?? CATEGORY_STYLES.GENERAL
                          )}
                        >
                          {titleCase(d.category)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {titleCase(d.type)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <StatusBadge status={d.paymentStatus} />
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatMoney(d.amount, d.currency || DEFAULT_CURRENCY)}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {rowActions(d) ?? (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={8} className="px-4 pb-4">
                          {renderDetail(d)}
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      ) : (
        <div className="grid gap-3">
          {filtered.map((d) => {
            const expanded = expandedId === d.id;
            return (
              <div key={d.id} className="rounded-xl border bg-card shadow-sm">
                <button
                  type="button"
                  onClick={() => toggleExpand(d.id)}
                  aria-expanded={expanded}
                  className="flex w-full flex-wrap items-start gap-3 p-4 text-left outline-none transition hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
                >
                  <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">
                    {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{d.receiptNumber}</span>
                      <StatusBadge status={d.paymentStatus} />
                      <span
                        className={cn(
                          "rounded-full border px-1.5 text-[10px]",
                          CATEGORY_STYLES[d.category] ?? CATEGORY_STYLES.GENERAL
                        )}
                      >
                        {titleCase(d.category)}
                      </span>
                    </div>
                    <p className="truncate text-sm font-semibold">
                      {d.campaign?.title ?? "General fund"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {titleCase(d.paymentMethod)} · {formatDate(d.createdAt)}
                    </p>
                  </div>
                  <p className="text-lg font-bold text-primary">{formatMoney(d.amount, d.currency || DEFAULT_CURRENCY)}</p>
                </button>
                {expanded && (
                  <div className="border-t p-4 sm:p-5">
                    {renderDetail(d)}
                    <div className="mt-3 flex justify-end">{rowActions(d)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Monthly-giving pause/resume/cancel confirmation */}
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title={
          confirmAction?.action === "PAUSED"
            ? "Pause this monthly commitment?"
            : confirmAction?.action === "CANCELLED"
              ? "Cancel this monthly commitment?"
              : "Resume this monthly commitment?"
        }
        recordName={
          confirmAction
            ? `${confirmAction.commitment.campaign?.title ?? "General fund"} · ${formatMoney(
                confirmAction.commitment.amount,
                confirmAction.commitment.currency || DEFAULT_CURRENCY
              )} ${FREQUENCY_LABELS[confirmAction.commitment.recurringFrequency] ?? ""}`.trim()
            : null
        }
        description={
          confirmAction?.action === "CANCELLED"
            ? "Cancelling stops all future reminders and installments for this commitment. This cannot be undone — start a new commitment anytime from the Donate page."
            : confirmAction?.action === "PAUSED"
              ? "Pausing stops reminders while you take a break — resume anytime."
              : "Resuming brings back the reminders and the pay-installment action."
        }
        confirmLabel={
          confirmAction?.action === "PAUSED"
            ? "Yes, pause"
            : confirmAction?.action === "CANCELLED"
              ? "Yes, cancel commitment"
              : "Yes, resume"
        }
        loading={confirmBusy}
        onConfirm={runRecurringAction}
      />
    </div>
  );
}
