"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Download,
  HandCoins,
  RefreshCw,
  Search,
  ShieldAlert,
  Table2,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatINR, formatDate, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { DataField } from "@/components/shared/data-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface Donation {
  id: string;
  receiptNumber: string;
  amount: number;
  type: string; // ONE_TIME | RECURRING
  category: string;
  paymentMethod: string; // UPI | RAZORPAY | STRIPE | CASH | BANK_TRANSFER
  paymentStatus: string; // PENDING | COMPLETED | FAILED | REFUNDED
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

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        status === "COMPLETED" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        status === "PENDING" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        (status === "FAILED" || status === "REFUNDED") &&
          "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
      )}
    >
      {titleCase(status)}
    </Badge>
  );
}

export default function DonorDonations({ user }: { user: SessionUser }) {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [pan, setPan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [year, setYear] = useState("all");
  const [type, setType] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  // View sheet
  const [sheet, setSheet] = useState<Donation | null>(null);
  const [copiedReceipt, setCopiedReceipt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, me] = await Promise.all([
        get<unknown>("/api/donations?mine=1"),
        get<unknown>("/api/auth/me").catch(() => null),
      ]);
      setDonations(asArray<Donation>(d));
      const u =
        me && typeof me === "object" && "user" in (me as Record<string, unknown>)
          ? (me as { user?: { pan?: string | null } | null }).user
          : null;
      setPan(u?.pan ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load donations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const years = useMemo(() => {
    const set = new Set(
      donations.map((d) => String(new Date(d.createdAt).getFullYear()))
    );
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [donations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return donations.filter((d) => {
      if (year !== "all" && String(new Date(d.createdAt).getFullYear()) !== year)
        return false;
      if (type !== "all" && d.type !== type) return false;
      if (category !== "all" && d.category !== category) return false;
      if (
        q &&
        !`${d.receiptNumber} ${d.campaign?.title ?? "general fund"} ${d.message ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [donations, year, type, category, query]);

  const total = filtered
    .filter((d) => d.paymentStatus === "COMPLETED")
    .reduce((s, d) => s + (d.amount || 0), 0);

  const copyReceipt = async (receiptNumber: string) => {
    try {
      await navigator.clipboard.writeText(receiptNumber);
      setCopiedReceipt(receiptNumber);
      toast.success("Receipt number copied");
      setTimeout(() => setCopiedReceipt(null), 1500);
    } catch {
      toast.error("Copy failed — long-press to copy manually");
    }
  };

  const openReceipt = (receiptNumber: string) => {
    window.open(`/api/receipts/${encodeURIComponent(receiptNumber)}/html`, "_blank", "noopener");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="My donations"
        description={
          loading
            ? "Loading your giving history…"
            : `${filtered.length} of ${donations.length} donation${donations.length === 1 ? "" : "s"} · ${formatINR(total)} completed in view`
        }
        icon={<HandCoins className="size-5" />}
        actions={
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

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="don-year">Year</Label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger id="don-year" className="w-full">
              <SelectValue placeholder="All years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="don-type">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="don-type" className="w-full">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="ONE_TIME">One time</SelectItem>
              <SelectItem value="RECURRING">Recurring</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="don-category">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="don-category" className="w-full">
              <SelectValue placeholder="All categories" />
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
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <SectionCard title="Donations" icon={<HandCoins className="size-5" />}>
          {donations.length === 0 ? (
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
          ) : (
            <EmptyState
              icon={<Search className="size-5" />}
              title="Nothing matches these filters"
              hint="Try widening the year, type or category — or clear the search."
            >
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  setYear("all");
                  setType("all");
                  setCategory("all");
                  setQuery("");
                }}
              >
                Clear filters
              </Button>
            </EmptyState>
          )}
        </SectionCard>
      ) : (
        <div className="grid gap-3">
          {filtered.map((d) => (
            <div
              key={d.id}
              className="rounded-xl border bg-card p-4 shadow-sm sm:p-5"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyReceipt(d.receiptNumber)}
                      className="group inline-flex min-h-11 items-center gap-1 rounded-md font-mono text-xs text-muted-foreground outline-none transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                      aria-label={`Copy receipt number ${d.receiptNumber}`}
                    >
                      {d.receiptNumber}
                      {copiedReceipt === d.receiptNumber ? (
                        <Check className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      ) : (
                        <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                      )}
                    </button>
                    <Badge
                      variant="outline"
                      className="rounded-full text-[10px] text-muted-foreground"
                    >
                      {titleCase(d.type)}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full text-[10px]",
                        CATEGORY_STYLES[d.category] ?? CATEGORY_STYLES.GENERAL
                      )}
                    >
                      {titleCase(d.category)}
                    </Badge>
                    <StatusBadge status={d.paymentStatus} />
                  </div>
                  <p className="truncate text-sm font-semibold">
                    {d.campaign?.title ?? "General fund"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {titleCase(d.paymentMethod)} · {formatDate(d.createdAt)}
                  </p>
                  {d.message && (
                    <p className="mt-1 border-l-2 border-primary/30 pl-2 text-xs italic text-muted-foreground">
                      “{d.message}”
                    </p>
                  )}
                </div>
                <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <p className="text-lg font-bold text-primary sm:mr-2">
                    {formatINR(d.amount)}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 gap-1.5 sm:min-h-9"
                    onClick={() => setSheet(d)}
                    aria-label={`View donation sheet for ${d.receiptNumber}`}
                  >
                    <Table2 className="size-4" aria-hidden="true" />
                    View sheet
                  </Button>
                  {d.paymentStatus === "COMPLETED" && d.receiptNumber && (
                    <Button
                      size="sm"
                      className="min-h-11 gap-1.5 sm:min-h-9"
                      onClick={() => openReceipt(d.receiptNumber)}
                      aria-label={`Download 80G receipt ${d.receiptNumber}`}
                    >
                      <Download className="size-4" aria-hidden="true" />
                      Download receipt
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------- Donation sheet dialog ---------- */}
      <Dialog open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Donation sheet</DialogTitle>
            <DialogDescription>
              {sheet ? `Receipt ${sheet.receiptNumber} · ${formatDate(sheet.createdAt)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {sheet && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <DataField label="Receipt number" value={sheet.receiptNumber} mono copy />
                <DataField label="Amount" value={formatINR(sheet.amount)} />
                <DataField label="Date" value={formatDate(sheet.createdAt)} />
                <DataField label="Type" value={titleCase(sheet.type)} />
                <DataField label="Category" value={titleCase(sheet.category)} />
                <DataField label="Payment method" value={titleCase(sheet.paymentMethod)} />
                <DataField label="Status" value={titleCase(sheet.paymentStatus)} />
                <DataField
                  label="Transaction ID"
                  value={sheet.transactionId ?? "—"}
                  mono={Boolean(sheet.transactionId)}
                  copy={Boolean(sheet.transactionId)}
                />
                <DataField
                  label="Campaign"
                  value={sheet.campaign?.title ?? "General fund"}
                />
                <DataField label="Donated by" value={user.name} />
              </div>
              {sheet.message && (
                <p className="rounded-lg bg-muted/40 p-3 text-sm italic text-muted-foreground">
                  “{sheet.message}”
                </p>
              )}
              <Separator />
              {sheet.paymentStatus === "COMPLETED" ? (
                pan ? (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Download className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    Your PAN ({pan}) prints on the 80G receipt — claim 50% deduction
                    u/s 80G while filing your ITR.
                  </p>
                ) : (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                    <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                    PAN missing — the receipt will print without PAN. Add it in your
                    Profile for a clean ITR filing.
                  </p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">
                  80G receipts are issued for completed payments only. This donation
                  is {titleCase(sheet.paymentStatus).toLowerCase()}.
                </p>
              )}
            </div>
          )}
          {sheet?.paymentStatus === "COMPLETED" && (
            <Button
              className="min-h-11 w-full gap-1.5"
              onClick={() => openReceipt(sheet.receiptNumber)}
            >
              <Download className="size-4" aria-hidden="true" />
              Download 80G receipt
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
