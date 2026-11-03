"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Download,
  Eye,
  HandCoins,
  Inbox,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  financialYear,
  formatDateTime,
  formatINR,
  formatINRCompact,
  titleCase,
} from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ------------------------------ types & helpers ----------------------------- */

interface DonationRow {
  id: string;
  donorId?: string | null;
  donorName: string;
  donorEmail: string;
  donorPhone?: string | null;
  amount: number;
  type: string;
  category: string;
  paymentMethod: string;
  paymentStatus: string;
  transactionId?: string | null;
  receiptNumber: string;
  campaignId?: string | null;
  campaign?: { title?: string } | null;
  message?: string | null;
  isAnonymous: boolean;
  pan?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CampaignLite {
  id: string;
  title: string;
}

const DONATION_TYPES = ["ONE_TIME", "RECURRING"];
const PAYMENT_STATUSES = ["PENDING", "COMPLETED", "FAILED", "REFUNDED"];
const PAYMENT_METHODS = ["UPI", "RAZORPAY", "STRIPE", "CASH", "BANK_TRANSFER"];
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
];

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function statusTone(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "PENDING":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "FAILED":
      return "bg-red-500/10 text-red-700 dark:text-red-400";
    case "REFUNDED":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
        statusTone(status)
      )}
    >
      {titleCase(status)}
    </span>
  );
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Normalises an Indian mobile number → 10 digits, or null when invalid. */
function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const trimmed = digits.length > 10 && digits.startsWith("91") ? digits.slice(2) : digits;
  return trimmed.length === 10 ? trimmed : null;
}

const emptyEditForm = {
  donorName: "",
  donorEmail: "",
  donorPhone: "",
  amount: "",
  type: "ONE_TIME",
  category: "GENERAL",
  paymentMethod: "UPI",
  paymentStatus: "COMPLETED",
  transactionId: "",
  campaignId: "",
  message: "",
  isAnonymous: false,
  pan: "",
};

/* ---------------------------------- view ----------------------------------- */

export default function DonationsView() {
  const [rows, setRows] = useState<DonationRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // filters (client-side over the fetched window)
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [category, setCategory] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // dialogs / sheets
  const [viewTarget, setViewTarget] = useState<DonationRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...emptyEditForm });
  const [editTarget, setEditTarget] = useState<DonationRow | null>(null);
  const [editForm, setEditForm] = useState({ ...emptyEditForm });
  const [deleteTarget, setDeleteTarget] = useState<DonationRow | null>(null);
  const [refundTarget, setRefundTarget] = useState<DonationRow | null>(null);

  /* ------------------------------- data load ------------------------------ */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<DonationRow[] | { items?: DonationRow[] }>(
        "/api/donations?limit=500"
      );
      setRows(Array.isArray(data) ? data : (data.items ?? []));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load donations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    get<CampaignLite[] | { items?: CampaignLite[] }>("/api/campaigns?all=1")
      .then((d) => setCampaigns(Array.isArray(d) ? d : (d.items ?? [])))
      .catch(() => setCampaigns([]));
  }, []);

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const campaignTitle = useCallback(
    (d: DonationRow) =>
      d.campaign?.title ??
      campaigns.find((c) => c.id === d.campaignId)?.title ??
      "General Fund",
    [campaigns]
  );

  /* ------------------------------- filtering ------------------------------ */

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const fromDate = from ? new Date(`${from}T00:00:00`) : null;
    const toDate = to ? new Date(`${to}T23:59:59.999`) : null;
    return rows.filter((d) => {
      if (status !== "ALL" && d.paymentStatus !== status) return false;
      if (type !== "ALL" && d.type !== type) return false;
      if (category !== "ALL" && d.category !== category) return false;
      if (needle) {
        const hay = `${d.donorName} ${d.donorEmail} ${d.receiptNumber} ${d.transactionId ?? ""} ${d.message ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      const created = new Date(d.createdAt);
      if (fromDate && created < fromDate) return false;
      if (toDate && created > toDate) return false;
      return true;
    });
  }, [rows, search, status, type, category, from, to]);

  const hasFilters =
    search.trim() !== "" ||
    status !== "ALL" ||
    type !== "ALL" ||
    category !== "ALL" ||
    from !== "" ||
    to !== "";

  const resetFilters = () => {
    setQ("");
    setStatus("ALL");
    setType("ALL");
    setCategory("ALL");
    setFrom("");
    setTo("");
  };

  /* --------------------------------- stats -------------------------------- */

  const stats = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let monthTotal = 0;
    let todayTotal = 0;
    let completedSum = 0;
    let completedCount = 0;
    let pending = 0;
    for (const d of rows) {
      const created = new Date(d.createdAt);
      if (d.paymentStatus === "COMPLETED") {
        if (created >= monthStart) monthTotal += d.amount;
        if (created >= todayStart) todayTotal += d.amount;
        completedSum += d.amount;
        completedCount += 1;
      }
      if (d.paymentStatus === "PENDING") pending += 1;
    }
    return {
      monthTotal,
      todayTotal,
      pending,
      avg: completedCount > 0 ? completedSum / completedCount : 0,
    };
  }, [rows]);

  /* ------------------------------- mutations ------------------------------ */

  const openEdit = (d: DonationRow) => {
    if (!d?.id) {
      toast.error("This donation has no record id — cannot edit");
      return;
    }
    setEditTarget(d);
    setEditForm({
      donorName: d.donorName ?? "",
      donorEmail: d.donorEmail ?? "",
      donorPhone: d.donorPhone ?? "",
      amount: d.amount !== undefined && d.amount !== null ? String(d.amount) : "",
      type: d.type ?? "ONE_TIME",
      category: d.category ?? "GENERAL",
      paymentMethod: d.paymentMethod ?? "UPI",
      paymentStatus: d.paymentStatus ?? "COMPLETED",
      transactionId: d.transactionId ?? "",
      campaignId: d.campaignId ?? "",
      message: d.message ?? "",
      isAnonymous: Boolean(d.isAnonymous),
      pan: d.pan ?? "",
    });
  };

  const validateForm = (f: typeof emptyEditForm): string | null => {
    if (!f.donorName.trim()) return "Donor name is required";
    if (!f.donorEmail.trim()) return "Donor email is required";
    if (!EMAIL_RE.test(f.donorEmail.trim())) return "Enter a valid email address";
    const amount = Number(f.amount);
    if (!Number.isFinite(amount) || amount <= 0) return "Amount must be greater than zero";
    if (f.donorPhone.trim() && !normalisePhone(f.donorPhone)) return "Phone must be a 10-digit mobile number";
    if (f.pan.trim() && !PAN_RE.test(f.pan.trim().toUpperCase()))
      return "PAN must match the format ABCDE1234F";
    return null;
  };

  const createDonation = async () => {
    const err = validateForm(createForm);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      await post("/api/donations", {
        donorName: createForm.donorName.trim(),
        donorEmail: createForm.donorEmail.trim(),
        donorPhone: createForm.donorPhone.trim() || undefined,
        amount: Number(createForm.amount),
        type: createForm.type,
        category: createForm.category,
        paymentMethod: createForm.paymentMethod,
        campaignId: createForm.campaignId || undefined,
        message: createForm.message.trim() || undefined,
        isAnonymous: createForm.isAnonymous,
        pan: createForm.pan.trim().toUpperCase() || undefined,
      });
      toast.success("Donation recorded — receipt generated");
      setCreateOpen(false);
      setCreateForm({ ...emptyEditForm });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record donation");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editTarget?.id) {
      toast.error("No donation selected — close the dialog and try again");
      return;
    }
    const err = validateForm(editForm);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      await patch(`/api/donations/${editTarget.id}`, {
        donorName: editForm.donorName.trim(),
        donorEmail: editForm.donorEmail.trim(),
        donorPhone: editForm.donorPhone.trim() || null,
        amount: Number(editForm.amount),
        type: editForm.type,
        category: editForm.category,
        paymentMethod: editForm.paymentMethod,
        paymentStatus: editForm.paymentStatus,
        transactionId: editForm.transactionId.trim() || null,
        campaignId: editForm.campaignId || null,
        message: editForm.message.trim() || null,
        isAnonymous: editForm.isAnonymous,
        pan: editForm.pan.trim().toUpperCase() || null,
      });
      toast.success(`Receipt ${editTarget.receiptNumber} updated`);
      setEditTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update donation");
    } finally {
      setSaving(false);
    }
  };

  const markRefunded = async () => {
    if (!refundTarget?.id) return;
    setSaving(true);
    try {
      await patch(`/api/donations/${refundTarget.id}`, { paymentStatus: "REFUNDED" });
      toast.success(`Receipt ${refundTarget.receiptNumber} marked refunded`);
      setRefundTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to mark refund");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;
    setSaving(true);
    try {
      await del(`/api/donations/${deleteTarget.id}`);
      toast.success("Donation deleted");
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete donation");
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const out: (string | number)[][] = [
      ["Receipt", "Donor", "Email", "Phone", "Amount", "Type", "Category", "Method", "Status", "Transaction", "Campaign", "Anonymous", "Date"],
      ...filtered.map((d) => [
        d.receiptNumber,
        d.donorName,
        d.donorEmail,
        d.donorPhone ?? "",
        d.amount,
        d.type,
        d.category,
        d.paymentMethod,
        d.paymentStatus,
        d.transactionId ?? "",
        campaignTitle(d),
        d.isAnonymous ? "Yes" : "No",
        formatDateTime(d.createdAt),
      ]),
    ];
    downloadCsv(`uar-donations-${new Date().toISOString().slice(0, 10)}.csv`, out);
    toast.success(`Exported ${filtered.length} donation${filtered.length === 1 ? "" : "s"} to CSV`);
  };

  const open80G = (receiptNumber: string) => {
    window.open(`/api/receipts/${encodeURIComponent(receiptNumber)}/html`, "_blank", "noopener");
  };

  /* ------------------------------ row actions ----------------------------- */

  const rowActions = (d: DonationRow, withLabels = false) => (
    <div className={cn("items-center", withLabels ? "flex flex-wrap gap-2" : "flex justify-end gap-1")}>
      <Button
        size={withLabels ? "sm" : "icon"}
        variant="ghost"
        className={withLabels ? "" : "size-11 md:size-9"}
        aria-label={`View donation ${d.receiptNumber}`}
        onClick={() => setViewTarget(d)}
      >
        <Eye className="size-4" />
        {withLabels && <span>View</span>}
      </Button>
      <Button
        size={withLabels ? "sm" : "icon"}
        variant="ghost"
        className={withLabels ? "" : "size-11 md:size-9"}
        aria-label={`Edit donation ${d.receiptNumber}`}
        onClick={() => openEdit(d)}
      >
        <Pencil className="size-4" />
        {withLabels && <span>Edit</span>}
      </Button>
      <Button
        size={withLabels ? "sm" : "icon"}
        variant="ghost"
        className={withLabels ? "" : "size-11 md:size-9"}
        aria-label={`Mark donation ${d.receiptNumber} refunded`}
        disabled={d.paymentStatus === "REFUNDED"}
        onClick={() => setRefundTarget(d)}
      >
        <RotateCcw className="size-4" />
        {withLabels && <span>Refund</span>}
      </Button>
      <Button
        size={withLabels ? "sm" : "icon"}
        variant="ghost"
        className={cn(withLabels ? "text-red-600 hover:bg-red-500/10 hover:text-red-700" : "size-11 md:size-9 text-red-600 hover:bg-red-500/10 hover:text-red-700")}
        aria-label={`Delete donation ${d.receiptNumber}`}
        onClick={() => setDeleteTarget(d)}
      >
        <Trash2 className="size-4" />
        {withLabels && <span>Delete</span>}
      </Button>
    </div>
  );

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Donations"
        description="Every rupee received — filter, reconcile, export and issue 80G receipts."
        icon={<HandCoins className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0} aria-label="Export filtered donations to CSV">
              <Download className="size-4" /> Export CSV
            </Button>
            <Button onClick={() => setCreateOpen(true)} aria-label="Record new donation">
              <Plus className="size-4" /> Record donation
            </Button>
          </>
        }
      />

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
        <StatCard
          label="This month"
          value={formatINRCompact(stats.monthTotal)}
          icon={<TrendingUp className="size-5" aria-hidden="true" />}
          accent="emerald"
          hint={`${financialYear(new Date())} · month to date`}
          loading={loading}
        />
        <StatCard
          label="Today"
          value={formatINRCompact(stats.todayTotal)}
          icon={<Wallet className="size-5" aria-hidden="true" />}
          accent="teal"
          hint="received since midnight"
          loading={loading}
        />
        <StatCard
          label="Pending"
          value={String(stats.pending)}
          icon={<Inbox className="size-5" aria-hidden="true" />}
          accent="amber"
          hint="awaiting confirmation"
          loading={loading}
        />
        <StatCard
          label="Avg gift"
          value={formatINRCompact(stats.avg)}
          icon={<HandCoins className="size-5" aria-hidden="true" />}
          accent="fuchsia"
          hint="across completed donations"
          loading={loading}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search donor, email, receipt or transaction…"
              className="pl-9"
              aria-label="Search donations"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Filter by payment status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {PAYMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Filter by donation type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                {DONATION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t === "RECURRING" ? "Monthly" : "One-time"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="don-from" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="size-3.5" aria-hidden="true" /> From
          </Label>
          <Input id="don-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="Filter from date" />
          <Label htmlFor="don-to" className="text-xs text-muted-foreground">To</Label>
          <Input id="don-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="Filter to date" />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} aria-label="Reset all filters">
              Reset filters
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
            {loading ? "Loading…" : `${filtered.length} of ${rows.length} shown`}
          </span>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden rounded-xl border bg-card md:block">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ReceiptText className="size-6" aria-hidden="true" />}
              title="No donations found"
              hint={hasFilters ? "Try widening the date range or clearing filters." : "Record your first donation to get started."}
            >
              {hasFilters ? (
                <Button variant="outline" size="sm" onClick={resetFilters}>Clear filters</Button>
              ) : (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" /> Record donation
                </Button>
              )}
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Donor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden xl:table-cell">Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Date</TableHead>
                  <TableHead className="hidden lg:table-cell">Campaign</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{d.receiptNumber}</TableCell>
                    <TableCell>
                      <p className="max-w-44 truncate font-medium">
                        {d.donorName}
                        {d.isAnonymous && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">Anonymous</span>}
                      </p>
                      <p className="max-w-44 truncate text-xs text-muted-foreground">{d.donorEmail}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">{formatINR(d.amount)}</TableCell>
                    <TableCell>
                      <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", d.type === "RECURRING" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground")}>
                        {d.type === "RECURRING" ? "Monthly" : "One-time"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">{titleCase(d.category)}</TableCell>
                    <TableCell><StatusPill status={d.paymentStatus} /></TableCell>
                    <TableCell className="hidden whitespace-nowrap text-sm lg:table-cell">{formatDateTime(d.createdAt)}</TableCell>
                    <TableCell className="hidden max-w-40 truncate text-sm lg:table-cell">{campaignTitle(d)}</TableCell>
                    <TableCell className="text-right">{rowActions(d)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Mobile stacked cards */}
      <div className="space-y-3 md:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="size-6" aria-hidden="true" />}
            title="No donations found"
            hint={hasFilters ? "Try widening the date range or clearing filters." : "Record your first donation to get started."}
          >
            {hasFilters ? (
              <Button variant="outline" size="sm" onClick={resetFilters}>Clear filters</Button>
            ) : (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" /> Record donation
              </Button>
            )}
          </EmptyState>
        ) : (
          filtered.map((d) => (
            <article key={d.id} className="space-y-2.5 rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{d.receiptNumber}</p>
                  <p className="truncate text-sm font-semibold">
                    {d.donorName}
                    {d.isAnonymous && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">Anonymous</span>}
                  </p>
                </div>
                <p className="shrink-0 text-base font-bold">{formatINR(d.amount)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill status={d.paymentStatus} />
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", d.type === "RECURRING" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground")}>
                  {d.type === "RECURRING" ? "Monthly" : "One-time"}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{titleCase(d.category)}</span>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {campaignTitle(d)} · {formatDateTime(d.createdAt)}
              </p>
              <div className="border-t pt-2">{rowActions(d, true)}</div>
            </article>
          ))
        )}
      </div>

      {/* ------------------------------ View sheet ---------------------------- */}
      <Sheet open={!!viewTarget} onOpenChange={(o) => !o && setViewTarget(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2">
              <ReceiptText className="size-4 text-primary" aria-hidden="true" />
              {viewTarget?.receiptNumber ?? "Donation"}
            </SheetTitle>
            <SheetDescription>
              {viewTarget ? `${viewTarget.donorName} · ${formatINR(viewTarget.amount)} · ${formatDateTime(viewTarget.createdAt)}` : ""}
            </SheetDescription>
          </SheetHeader>
          {viewTarget && (
            <div className="flex-1 space-y-4 px-4 pb-6">
              <SectionCard title="Donor" icon={<ReceiptText className="size-4" aria-hidden="true" />}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <DataField label="Name" value={viewTarget.isAnonymous ? `${viewTarget.donorName} (anonymous)` : viewTarget.donorName} />
                  <DataField label="Email" value={viewTarget.donorEmail} copy />
                  <DataField label="Phone" value={viewTarget.donorPhone} copy />
                  <DataField label="PAN" value={viewTarget.pan} mono copy />
                  <DataField label="Anonymous" value={viewTarget.isAnonymous ? "Yes" : "No"} />
                  <DataField label="Donor ID" value={viewTarget.donorId} mono />
                </div>
                {viewTarget.message && (
                  <blockquote className="mt-4 rounded-md border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-xs italic text-muted-foreground">
                    “{viewTarget.message}”
                  </blockquote>
                )}
              </SectionCard>

              <SectionCard title="Payment" icon={<Wallet className="size-4" aria-hidden="true" />}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <DataField label="Amount" value={formatINR(viewTarget.amount)} />
                  <DataField label="Type" value={titleCase(viewTarget.type)} />
                  <DataField label="Category" value={titleCase(viewTarget.category)} />
                  <DataField label="Method" value={titleCase(viewTarget.paymentMethod)} />
                  <DataField label="Status" value={<StatusPill status={viewTarget.paymentStatus} />} />
                  <DataField label="Transaction ID" value={viewTarget.transactionId} mono copy />
                  <DataField label="Created" value={formatDateTime(viewTarget.createdAt)} />
                  <DataField label="Updated" value={formatDateTime(viewTarget.updatedAt)} />
                </div>
              </SectionCard>

              <SectionCard title="Receipt & campaign" icon={<HandCoins className="size-4" aria-hidden="true" />}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <DataField label="Receipt number" value={viewTarget.receiptNumber} mono copy />
                  <DataField label="Campaign" value={campaignTitle(viewTarget)} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => open80G(viewTarget.receiptNumber)}
                    aria-label="Open 80G receipt in a new tab"
                  >
                    <ReceiptText className="size-4" /> Open 80G receipt
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setViewTarget(null);
                      openEdit(viewTarget);
                    }}
                    aria-label="Edit this donation"
                  >
                    <Pencil className="size-4" /> Edit donation
                  </Button>
                </div>
              </SectionCard>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* --------------------------- Record dialog ---------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record donation</DialogTitle>
            <DialogDescription>Log an offline or manual contribution. A receipt number is generated automatically.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="dc-name">Donor name *</Label>
                <Input id="dc-name" value={createForm.donorName} onChange={(e) => setCreateForm({ ...createForm, donorName: e.target.value })} placeholder="Full name" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dc-email">Donor email *</Label>
                <Input id="dc-email" type="email" value={createForm.donorEmail} onChange={(e) => setCreateForm({ ...createForm, donorEmail: e.target.value })} placeholder="donor@example.org" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="dc-amount">Amount (₹) *</Label>
                <Input id="dc-amount" type="number" min="1" value={createForm.amount} onChange={(e) => setCreateForm({ ...createForm, amount: e.target.value })} placeholder="5000" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dc-phone">Phone (10 digits)</Label>
                <Input id="dc-phone" type="tel" inputMode="numeric" value={createForm.donorPhone} onChange={(e) => setCreateForm({ ...createForm, donorPhone: e.target.value })} placeholder="9876543210" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="dc-pan">PAN (for 80G)</Label>
                <Input id="dc-pan" value={createForm.pan} onChange={(e) => setCreateForm({ ...createForm, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" className="font-mono uppercase" />
              </div>
              <div className="grid gap-2">
                <Label>Campaign</Label>
                <Select value={createForm.campaignId || "none"} onValueChange={(v) => setCreateForm({ ...createForm, campaignId: v === "none" ? "" : v })}>
                  <SelectTrigger aria-label="Select campaign"><SelectValue placeholder="General donation" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General donation</SelectItem>
                    {campaigns.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={createForm.type} onValueChange={(v) => setCreateForm({ ...createForm, type: v })}>
                  <SelectTrigger aria-label="Donation type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DONATION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t === "RECURRING" ? "Monthly" : "One-time"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={createForm.category} onValueChange={(v) => setCreateForm({ ...createForm, category: v })}>
                  <SelectTrigger aria-label="Donation category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Method</Label>
                <Select value={createForm.paymentMethod} onValueChange={(v) => setCreateForm({ ...createForm, paymentMethod: v })}>
                  <SelectTrigger aria-label="Payment method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="dc-anon" className="text-sm">Anonymous donation</Label>
                <p className="text-xs text-muted-foreground">Hide the donor name on public walls of giving</p>
              </div>
              <Switch id="dc-anon" checked={createForm.isAnonymous} onCheckedChange={(v) => setCreateForm({ ...createForm, isAnonymous: v })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dc-message">Message</Label>
              <Textarea id="dc-message" value={createForm.message} onChange={(e) => setCreateForm({ ...createForm, message: e.target.value })} placeholder="Optional note from the donor" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createDonation} disabled={saving}>{saving ? "Saving…" : "Record donation"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------- Edit dialog ---------------------------- */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit donation</DialogTitle>
            <DialogDescription>
              {editTarget ? `Receipt ${editTarget.receiptNumber} · ${editTarget.donorName}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="de-name">Donor name *</Label>
                <Input id="de-name" value={editForm.donorName} onChange={(e) => setEditForm({ ...editForm, donorName: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="de-email">Donor email *</Label>
                <Input id="de-email" type="email" value={editForm.donorEmail} onChange={(e) => setEditForm({ ...editForm, donorEmail: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="de-amount">Amount (₹) *</Label>
                <Input id="de-amount" type="number" min="1" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="de-phone">Phone</Label>
                <Input id="de-phone" type="tel" inputMode="numeric" value={editForm.donorPhone} onChange={(e) => setEditForm({ ...editForm, donorPhone: e.target.value })} placeholder="10 digits" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="de-pan">PAN</Label>
                <Input id="de-pan" value={editForm.pan} onChange={(e) => setEditForm({ ...editForm, pan: e.target.value.toUpperCase() })} className="font-mono uppercase" placeholder="ABCDE1234F" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={editForm.type} onValueChange={(v) => setEditForm({ ...editForm, type: v })}>
                  <SelectTrigger aria-label="Donation type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DONATION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t === "RECURRING" ? "Monthly" : "One-time"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={editForm.category} onValueChange={(v) => setEditForm({ ...editForm, category: v })}>
                  <SelectTrigger aria-label="Donation category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Method</Label>
                <Select value={editForm.paymentMethod} onValueChange={(v) => setEditForm({ ...editForm, paymentMethod: v })}>
                  <SelectTrigger aria-label="Payment method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Payment status</Label>
                <Select value={editForm.paymentStatus} onValueChange={(v) => setEditForm({ ...editForm, paymentStatus: v })}>
                  <SelectTrigger aria-label="Payment status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="de-txn">Transaction ID</Label>
                <Input id="de-txn" value={editForm.transactionId} onChange={(e) => setEditForm({ ...editForm, transactionId: e.target.value })} className="font-mono" placeholder="UPI / gateway reference" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Campaign</Label>
              <Select value={editForm.campaignId || "none"} onValueChange={(v) => setEditForm({ ...editForm, campaignId: v === "none" ? "" : v })}>
                <SelectTrigger aria-label="Linked campaign"><SelectValue placeholder="General donation" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">General donation</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="de-message">Message</Label>
              <Textarea id="de-message" value={editForm.message} onChange={(e) => setEditForm({ ...editForm, message: e.target.value })} rows={2} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="de-anon" className="text-sm">Anonymous donation</Label>
                <p className="text-xs text-muted-foreground">Hide the donor name on public walls of giving</p>
              </div>
              <Switch id="de-anon" checked={editForm.isAnonymous} onCheckedChange={(v) => setEditForm({ ...editForm, isAnonymous: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------- Refund confirm --------------------------- */}
      <AlertDialog open={!!refundTarget} onOpenChange={(o) => !o && setRefundTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark donation refunded?</AlertDialogTitle>
            <AlertDialogDescription>
              {refundTarget
                ? `Receipt ${refundTarget.receiptNumber} from ${refundTarget.donorName} (${formatINR(refundTarget.amount)}) will be marked REFUNDED. Campaign totals are recalculated automatically.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={(e) => {
                e.preventDefault();
                markRefunded();
              }}
            >
              {saving ? "Marking…" : "Mark refunded"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --------------------------- Delete confirm --------------------------- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete donation?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Receipt ${deleteTarget.receiptNumber} from ${deleteTarget.donorName} (${formatINR(deleteTarget.amount)}) will be permanently removed. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {saving ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
