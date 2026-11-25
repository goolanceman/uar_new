"use client";

/**
 * Donations — premium admin ledger (round-5 design system).
 *
 * - StatCards: FY collected (server completedSum), all-time count, pending,
 *   refunded total
 * - Server-side pagination + filters (status/type/category/method/date-range)
 *   + debounced search over name / email / receipt / txn, with active-filter
 *   chips, clear-all and a live result count in one toolbar row
 * - Table view = DataTable (height="fill", sticky header, skeleton rows,
 *   built-in premium pager); grid/list persist via useViewPref
 * - Full-screen DetailSheet (eyebrow, status chip, 80G + Edit header actions)
 *   showing every Donation field; Record/Edit FormSheet (lg) with rule-factory
 *   validation and dirty tracking
 * - Refund (FormSheet sm + ConfirmDialog), Delete (ConfirmDialog), CSV export
 */

import { useEffect, useMemo, useState } from "react";
import {
  Clock3,
  ExternalLink,
  Eye,
  IndianRupee,
  Megaphone,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Trash2,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  DEFAULT_CURRENCY,
  financialYear,
  formatDate,
  formatDateTime,
  formatINR,
  formatMoney,
  initials,
  titleCase,
} from "@/lib/format";
import { CURRENCIES, getCurrency } from "@/lib/settings-core";
import {
  amountRule,
  dateRule,
  emailRule,
  fieldError,
  panRule,
  phoneRule,
  required,
} from "@/lib/validators";
import { navigate } from "@/lib/router";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { DataField } from "@/components/shared/data-field";
import {
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  SwitchField,
  TextareaField,
  TextField,
} from "@/components/shared/form-fields";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import {
  PaginationBar,
  PageSizeSelect,
  ViewSwitcher,
  useViewPref,
  type DataViewMode,
} from "@/components/shared/view-switcher";
import { StatusBadge, humanize } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ------------------------------- types ------------------------------------ */

interface DonationRow {
  id: string;
  donorId?: string | null;
  donorName: string;
  donorEmail: string;
  donorPhone?: string | null;
  amount: number;
  currency?: string;
  type: string;
  recurringFrequency?: string | null;
  nextChargeAt?: string | null;
  category: string;
  paymentMethod: string;
  paymentProvider?: string | null;
  paymentStatus: string;
  transactionId?: string | null;
  gatewayOrderId?: string | null;
  fees?: number | null;
  netAmount?: number | null;
  settlementDate?: string | null;
  receiptNumber: string;
  receiptStatus?: string;
  receiptIssuedAt?: string | null;
  refundAmount?: number | null;
  refundReason?: string | null;
  refundedAt?: string | null;
  internalNotes?: string | null;
  campaignId?: string | null;
  campaign?: { id?: string; title?: string; accent?: string } | null;
  message?: string | null;
  isAnonymous: boolean;
  pan?: string | null;
  createdAt: string;
  updatedAt?: string;
  donorRef?: { id: string; category?: string | null; tags?: string | null } | null;
}

interface DonationsEnvelope {
  items?: DonationRow[];
  total?: number;
  page?: number;
  pages?: number;
  completedSum?: number;
}

interface CampaignLite {
  id: string;
  title: string;
}

interface DonationFormState {
  donorName: string;
  donorEmail: string;
  donorPhone: string;
  isAnonymous: boolean;
  pan: string;
  amount: string;
  currency: string;
  type: string;
  recurringFrequency: string;
  nextChargeAt: string;
  category: string;
  campaignId: string;
  paymentMethod: string;
  paymentProvider: string;
  transactionId: string;
  gatewayOrderId: string;
  paymentStatus: string;
  fees: string;
  settlementDate: string;
  receiptStatus: string;
  internalNotes: string;
}

/* ----------------------------- option constants ---------------------------- */

const TYPE_OPTIONS = [
  { value: "ONE_TIME", label: "One-time" },
  { value: "RECURRING", label: "Recurring" },
];

const CATEGORY_OPTIONS = [
  { value: "GENERAL", label: "General" },
  { value: "MEDICAL", label: "Medical" },
  { value: "FOOD_DISTRIBUTION", label: "Food distribution" },
  { value: "SANITARY_PADS", label: "Sanitary pads" },
  { value: "EDUCATION_SUPPORT", label: "Education support" },
  { value: "EMERGENCY", label: "Emergency relief" },
  { value: "ANIMAL_WELFARE", label: "Animal welfare" },
  { value: "MOBILITY", label: "Mobility" },
  { value: "AWARENESS", label: "Awareness" },
];

const METHOD_OPTIONS = [
  { value: "UPI", label: "UPI" },
  { value: "RAZORPAY", label: "Razorpay" },
  { value: "CARD", label: "Card" },
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
];

const STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "REFUNDED", label: "Refunded" },
  { value: "CANCELLED", label: "Cancelled" },
];

const PROVIDER_OPTIONS = [
  { value: "MANUAL", label: "Manual / offline" },
  { value: "RAZORPAY", label: "Razorpay" },
  { value: "CASHFREE", label: "Cashfree" },
  { value: "PAYU", label: "PayU" },
  { value: "STRIPE", label: "Stripe" },
];

const RECEIPT_STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "ISSUED", label: "Issued" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REISSUED", label: "Reissued" },
];

const FREQ_OPTIONS = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "YEARLY", label: "Yearly" },
];

// Full catalog from the settings currency table — per-row labels carry the
// currency's own symbol.
const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} (${c.symbol})`,
}));

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label])
);

const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  METHOD_OPTIONS.map((o) => [o.value, o.label])
);

/* ------------------------------- helpers ---------------------------------- */

function toDateInput(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function emptyDonationForm(): DonationFormState {
  return {
    donorName: "",
    donorEmail: "",
    donorPhone: "",
    isAnonymous: false,
    pan: "",
    amount: "",
    currency: "INR",
    type: "ONE_TIME",
    recurringFrequency: "MONTHLY",
    nextChargeAt: "",
    category: "GENERAL",
    campaignId: "NONE",
    paymentMethod: "UPI",
    paymentProvider: "NONE",
    transactionId: "",
    gatewayOrderId: "",
    paymentStatus: "PENDING",
    fees: "0",
    settlementDate: "",
    receiptStatus: "PENDING",
    internalNotes: "",
  };
}

function donationFormFromRow(d: DonationRow): DonationFormState {
  return {
    donorName: d.donorName ?? "",
    donorEmail: d.donorEmail ?? "",
    donorPhone: d.donorPhone ?? "",
    isAnonymous: Boolean(d.isAnonymous),
    pan: d.pan ?? "",
    amount: d.amount != null ? String(d.amount) : "",
    currency: d.currency || "INR",
    type: d.type || "ONE_TIME",
    recurringFrequency: d.recurringFrequency || "MONTHLY",
    nextChargeAt: toDateInput(d.nextChargeAt),
    category: d.category || "GENERAL",
    campaignId: d.campaignId || "NONE",
    paymentMethod: d.paymentMethod || "UPI",
    paymentProvider: d.paymentProvider || "NONE",
    transactionId: d.transactionId ?? "",
    gatewayOrderId: d.gatewayOrderId ?? "",
    paymentStatus: d.paymentStatus || "PENDING",
    fees: d.fees != null && Number(d.fees) !== 0 ? String(d.fees) : "0",
    settlementDate: toDateInput(d.settlementDate),
    receiptStatus: d.receiptStatus || "PENDING",
    internalNotes: d.internalNotes ?? "",
  };
}

function validateDonationForm(
  f: DonationFormState,
  mode: "create" | "edit"
): Record<string, string | null> {
  const errs: Record<string, string | null> = {
    donorName: fieldError(f.donorName, [required("Donor name")]),
    donorEmail: fieldError(f.donorEmail, [emailRule()]),
    donorPhone: fieldError(f.donorPhone, [phoneRule(true)]),
    pan: fieldError(f.pan, [panRule(true)]),
    amount: fieldError(f.amount, [amountRule({ min: 1, label: "Amount" })]),
    nextChargeAt:
      f.type === "RECURRING" ? fieldError(f.nextChargeAt, [dateRule(false)]) : null,
    settlementDate:
      mode === "edit" ? fieldError(f.settlementDate, [dateRule(true)]) : null,
    fees: null,
  };
  if (mode === "edit" && f.fees.trim() !== "") {
    const n = Number(f.fees);
    if (!Number.isFinite(n) || n < 0)
      errs.fees = "Fees must be zero or a positive number";
  }
  return errs;
}

function DonorAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary",
        className
      )}
    >
      {initials(name)}
    </span>
  );
}

function RowActions({
  row,
  onView,
  onEdit,
  onRefund,
  onDelete,
}: {
  row: DonationRow;
  onView: () => void;
  onEdit: () => void;
  onRefund: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Actions for donation ${row.receiptNumber}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={onView}>
          <Eye className="size-4" /> View detail
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="size-4" /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onRefund}
          disabled={row.paymentStatus === "REFUNDED"}
        >
          <RotateCcw className="size-4" /> Refund
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="size-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ListSkeleton({ mode }: { mode: "grid" | "list" }) {
  if (mode === "grid") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {[0, 1, 2].map((s) => (
        <div key={s} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ detail sheet ------------------------------- */

function DetailContent({ d }: { d: DonationRow }) {
  const cashOverLimit = d.paymentMethod === "CASH" && Number(d.amount) > 2000;
  const hasRefund =
    Number(d.refundAmount ?? 0) > 0 ||
    d.paymentStatus === "REFUNDED" ||
    Boolean(d.refundReason);

  return (
    <div className="flex flex-col gap-6">
      {/* Donor */}
      <DetailSection
        title="Donor"
        description="Identity used on the receipt and in the donor CRM."
        actions={
          d.donorRef ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => navigate("/admin/donors")}
            >
              Open donor CRM
            </Button>
          ) : undefined
        }
      >
        <DetailGrid cols={2}>
          <DataField
            label="Donor name"
            value={d.isAnonymous ? `${d.donorName} (anonymous)` : d.donorName}
          />
          <DataField label="Email" value={d.donorEmail} copy />
          <DataField label="Phone" value={d.donorPhone ?? ""} />
          <DataField label="PAN" value={d.pan ?? ""} mono copy />
          <DataField label="Anonymous" value={d.isAnonymous ? "Yes" : "No"} />
          <DataField
            label="Donor CRM profile"
            value={
              d.donorRef
                ? d.donorRef.category
                  ? `Linked · ${humanize(d.donorRef.category)}`
                  : "Linked"
                : "Not linked"
            }
          />
          <DataField
            label="Donor message"
            value={d.message ?? ""}
            className="sm:col-span-2"
          />
        </DetailGrid>
      </DetailSection>

      {/* Gift */}
      <DetailSection
        title="Gift"
        description="What was given and which fund it supports."
        actions={
          d.campaignId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => navigate("/admin/campaigns")}
            >
              <ExternalLink className="size-4" /> Open campaigns
            </Button>
          ) : undefined
        }
      >
        <DetailGrid cols={2}>
          <DataField label="Amount" value={formatMoney(d.amount, d.currency || DEFAULT_CURRENCY)} />
          <DataField label="Currency" value={d.currency || DEFAULT_CURRENCY} />
          <DataField
            label="Type"
            value={
              d.type === "RECURRING"
                ? `Recurring${d.recurringFrequency ? ` · ${titleCase(d.recurringFrequency)}` : ""}`
                : "One-time"
            }
          />
          <DataField
            label="Category"
            value={CATEGORY_LABEL[d.category] ?? titleCase(d.category)}
          />
          <DataField
            label="Campaign"
            value={d.campaign?.title ?? "General fund (not linked)"}
          />
          {d.type === "RECURRING" ? (
            <DataField label="Next charge at" value={formatDate(d.nextChargeAt)} />
          ) : null}
        </DetailGrid>
      </DetailSection>

      {/* Payment */}
      <DetailSection title="Payment">
        <DetailGrid cols={2}>
          <DataField label="Payment status" value={<StatusBadge status={d.paymentStatus} />} />
          <DataField
            label="Method"
            value={`${METHOD_LABEL[d.paymentMethod] ?? titleCase(d.paymentMethod)}${
              d.paymentProvider ? ` · ${titleCase(d.paymentProvider)}` : ""
            }`}
          />
          <DataField label="Transaction ID" value={d.transactionId ?? ""} mono copy />
          <DataField label="Gateway order ID" value={d.gatewayOrderId ?? ""} mono copy />
          <DataField
            label="Gateway fees"
            value={d.fees != null ? formatMoney(d.fees, d.currency || DEFAULT_CURRENCY) : ""}
          />
          <DataField
            label="Net amount"
            value={d.netAmount != null ? formatMoney(d.netAmount, d.currency || DEFAULT_CURRENCY) : ""}
          />
          <DataField label="Settlement date" value={formatDate(d.settlementDate)} />
        </DetailGrid>
      </DetailSection>

      {/* Receipt + 80G */}
      <DetailSection
        title="Receipt & 80G"
        description="Receipts open as print-ready A4 documents."
        actions={
          d.receiptNumber && d.paymentStatus === "COMPLETED" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                window.open(`/api/receipts/${d.receiptNumber}/html`, "_blank", "noopener,noreferrer")
              }
            >
              <ExternalLink className="size-4" /> Open 80G receipt
            </Button>
          ) : undefined
        }
      >
        <DetailGrid cols={2}>
          <DataField label="Receipt number" value={d.receiptNumber} mono copy />
          <DataField label="Receipt status" value={<StatusBadge status={d.receiptStatus} />} />
          <DataField label="Issued at" value={formatDateTime(d.receiptIssuedAt)} />
        </DetailGrid>
        {cashOverLimit ? (
          <p
            role="note"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300"
          >
            Cash donations above {formatMoney(2000, "INR")} are not eligible for an 80G deduction
            (Income Tax Act). Issue a courtesy receipt only — do not promise tax
            benefits to the donor.
          </p>
        ) : d.paymentStatus === "COMPLETED" ? (
          <p
            role="note"
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300"
          >
            Eligible under section 80G — the donor can claim this gift in their
            income-tax return.
          </p>
        ) : (
          <p
            role="note"
            className="rounded-lg border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          >
            The 80G receipt becomes claimable once the payment is marked
            Completed.
          </p>
        )}
      </DetailSection>

      {/* Refund */}
      {hasRefund ? (
        <DetailSection title="Refund">
          <DetailGrid cols={2}>
            <DataField
              label="Refund amount"
              value={d.refundAmount != null ? formatMoney(d.refundAmount, d.currency || DEFAULT_CURRENCY) : ""}
            />
            <DataField label="Refunded at" value={formatDateTime(d.refundedAt)} />
            <DataField
              label="Refund reason"
              value={d.refundReason ?? ""}
              className="sm:col-span-2"
            />
          </DetailGrid>
        </DetailSection>
      ) : null}

      {/* Internal notes */}
      <DetailSection
        title="Internal notes"
        description="Never shown to donors."
      >
        <p className="min-h-10 whitespace-pre-wrap rounded-lg border bg-muted/30 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
          {d.internalNotes || "—"}
        </p>
      </DetailSection>

      {/* Record */}
      <DetailSection title="Record">
        <DetailGrid cols={2}>
          <DataField label="Donation ID" value={d.id} mono copy />
          <DataField label="Created" value={formatDateTime(d.createdAt)} />
          <DataField label="Last updated" value={formatDateTime(d.updatedAt)} />
        </DetailGrid>
      </DetailSection>
    </div>
  );
}

/* --------------------------------- view ----------------------------------- */

const CSV_COLUMNS: CsvColumn<DonationRow>[] = [
  { header: "Receipt #", value: (d) => d.receiptNumber },
  { header: "Donor", value: (d) => (d.isAnonymous ? "Anonymous" : d.donorName) },
  { header: "Email", value: (d) => d.donorEmail },
  { header: "Amount", value: (d) => d.amount },
  { header: "Currency", value: (d) => d.currency ?? "INR" },
  { header: "Type", value: (d) => d.type },
  { header: "Category", value: (d) => d.category },
  { header: "Method", value: (d) => d.paymentMethod },
  { header: "Status", value: (d) => d.paymentStatus },
  { header: "Date", value: (d) => formatDate(d.createdAt) },
  { header: "Campaign", value: (d) => d.campaign?.title ?? "" },
];

export default function DonationsView() {
  const [view, setView] = useViewPref("donations");

  // list state
  const [items, setItems] = useState<DonationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [listToken, setListToken] = useState(0);

  // filters
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [category, setCategory] = useState("ALL");
  const [method, setMethod] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  // stats
  const [statsLoading, setStatsLoading] = useState(true);
  const [stats, setStats] = useState({
    fyCollected: 0,
    allTime: 0,
    pending: 0,
    refundedTotal: 0,
    refundedCount: 0,
  });

  // campaigns for the form select
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);

  // create / edit form
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<DonationRow | null>(null);
  const [form, setForm] = useState<DonationFormState>(emptyDonationForm);
  const [initialFormJson, setInitialFormJson] = useState(
    JSON.stringify(emptyDonationForm())
  );
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);

  // detail sheet
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<DonationRow | null>(null);
  const [detail, setDetail] = useState<DonationRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // refund
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundConfirm, setRefundConfirm] = useState(false);
  const [refundTarget, setRefundTarget] = useState<DonationRow | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundInitial, setRefundInitial] = useState({ amount: "", reason: "" });
  const [refundErr, setRefundErr] = useState<string | null>(null);
  const [refundSaving, setRefundSaving] = useState(false);

  // delete
  const [deleteTarget, setDeleteTarget] = useState<DonationRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = JSON.stringify(form) !== initialFormJson;
  const refundDirty =
    refundAmount !== refundInitial.amount || refundReason !== refundInitial.reason;
  const hasFilters =
    q !== "" ||
    status !== "ALL" ||
    type !== "ALL" ||
    category !== "ALL" ||
    method !== "ALL" ||
    from !== "" ||
    to !== "";

  const setF = <K extends keyof DonationFormState>(
    k: K,
    v: DonationFormState[K]
  ) => setForm((prev) => ({ ...prev, [k]: v }));

  const refresh = () => {
    setListToken((t) => t + 1);
    void loadStats();
  };

  /* ------------------------------ data loads ------------------------------ */

  async function loadStats() {
    setStatsLoading(true);
    try {
      const now = new Date();
      const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      const fyFrom = `${fyStartYear}-04-01`;
      const [fyRes, allRes, pendingRes, refundedRes] = await Promise.all([
        get<DonationsEnvelope>(
          `/api/donations?page=1&limit=1&status=COMPLETED&from=${fyFrom}`
        ),
        get<DonationsEnvelope>("/api/donations?page=1&limit=1"),
        get<DonationsEnvelope>("/api/donations?page=1&limit=1&status=PENDING"),
        get<DonationsEnvelope>("/api/donations?page=1&limit=500&status=REFUNDED"),
      ]);
      const refunded = refundedRes.items ?? [];
      setStats({
        fyCollected: fyRes.completedSum ?? 0,
        allTime: allRes.total ?? 0,
        pending: pendingRes.total ?? 0,
        refundedTotal: refunded.reduce(
          (s, d) => s + Number(d.refundAmount ?? d.amount ?? 0),
          0
        ),
        refundedCount: refunded.length,
      });
    } catch {
      toast.error("Could not load donation statistics");
    } finally {
      setStatsLoading(false);
    }
  }

  useEffect(() => {
    void loadStats();
  }, []);

  // debounce search → q
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // main list fetch (server-side filters + pagination)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (q) params.set("q", q);
    if (status !== "ALL") params.set("status", status);
    if (type !== "ALL") params.set("type", type);
    if (category !== "ALL") params.set("category", category);
    if (method !== "ALL") params.set("method", method);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    get<DonationsEnvelope>(`/api/donations?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        const ps = data.pages ?? 1;
        const p = data.page ?? page;
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(data.total ?? 0);
        setPages(ps);
        if (p > ps) setPage(ps); // clamp when the list shrinks
      })
      .catch((e: unknown) => {
        if (!cancelled)
          toast.error(e instanceof Error ? e.message : "Could not load donations");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, status, type, category, method, from, to, page, limit, listToken]);

  // campaigns for the form select
  useEffect(() => {
    let cancelled = false;
    get<CampaignLite[]>("/api/campaigns?all=1")
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setCampaigns(rows);
      })
      .catch(() => {
        // select falls back to "General fund" only
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // detail fetch when the sheet opens
  useEffect(() => {
    if (!detailOpen || !detailTarget) return;
    let cancelled = false;
    setDetailLoading(true);
    get<DonationRow>(`/api/donations/${detailTarget.id}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        // keep the seeded row data
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailOpen, detailTarget]);

  const campaignOptions = useMemo(
    () => [
      { value: "NONE", label: "General fund (no campaign)" },
      ...campaigns.map((c) => ({ value: c.id, label: c.title })),
    ],
    [campaigns]
  );

  /* ------------------------------- handlers ------------------------------- */

  const openCreate = () => {
    setFormMode("create");
    setEditing(null);
    const f = emptyDonationForm();
    setForm(f);
    setInitialFormJson(JSON.stringify(f));
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (row: DonationRow) => {
    setFormMode("edit");
    setEditing(row);
    const f = donationFormFromRow(row);
    setForm(f);
    setInitialFormJson(JSON.stringify(f));
    setErrors({});
    setFormOpen(true);
  };

  const openDetail = (row: DonationRow) => {
    setDetailTarget(row);
    setDetail(row); // seed instantly, refresh from the API
    setDetailOpen(true);
  };

  const openRefund = (row: DonationRow) => {
    setRefundTarget(row);
    setRefundAmount(String(row.amount ?? ""));
    setRefundReason("");
    setRefundInitial({ amount: String(row.amount ?? ""), reason: "" });
    setRefundErr(null);
    setRefundOpen(true);
  };

  const submitRefundStep = () => {
    if (!refundTarget) return;
    const err = fieldError(refundAmount, [amountRule({ min: 1, label: "Refund amount" })]);
    if (err) {
      setRefundErr(err);
      return;
    }
    if (Number(refundAmount) > Number(refundTarget.amount)) {
      setRefundErr("Refund cannot exceed the donation amount");
      return;
    }
    setRefundErr(null);
    setRefundConfirm(true);
  };

  const confirmRefund = async () => {
    if (!refundTarget) return;
    setRefundSaving(true);
    try {
      await patch(`/api/donations/${refundTarget.id}`, {
        refundAmount: Number(refundAmount),
        refundReason: refundReason.trim() || null,
      });
      toast.success(
        `Refund of ${formatMoney(Number(refundAmount), refundTarget.currency || DEFAULT_CURRENCY)} recorded · ${refundTarget.receiptNumber}`
      );
      setRefundConfirm(false);
      setRefundOpen(false);
      setRefundTarget(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the refund");
    } finally {
      setRefundSaving(false);
    }
  };

  const askDelete = (row: DonationRow) => {
    setDeleteTarget(row);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del(`/api/donations/${deleteTarget.id}`);
      toast.success(`Donation ${deleteTarget.receiptNumber} deleted`);
      const wasLastRow = items.length <= 1;
      setDeleteOpen(false);
      setDeleteTarget(null);
      if (wasLastRow && page > 1) {
        setPage(page - 1); // triggers a refetch via deps
        void loadStats();
      } else {
        refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the donation");
    } finally {
      setDeleting(false);
    }
  };

  const submitForm = async () => {
    const errs = validateDonationForm(form, formMode);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setSaving(true);
    try {
      if (formMode === "create") {
        const created = await post<{ receiptNumber: string }>("/api/donations", {
          donorName: form.donorName.trim(),
          donorEmail: form.donorEmail.trim().toLowerCase(),
          donorPhone: form.donorPhone.trim() || null,
          pan: form.pan.trim().toUpperCase() || null,
          amount: Number(form.amount),
          currency: form.currency,
          type: form.type,
          recurringFrequency:
            form.type === "RECURRING" ? form.recurringFrequency : null,
          category: form.category,
          paymentMethod: form.paymentMethod,
          paymentProvider:
            form.paymentProvider === "NONE" ? null : form.paymentProvider,
          transactionId: form.transactionId.trim() || null,
          gatewayOrderId: form.gatewayOrderId.trim() || null,
          campaignId: form.campaignId === "NONE" ? null : form.campaignId,
          isAnonymous: form.isAnonymous,
        });
        toast.success(`Donation recorded · Receipt ${created.receiptNumber}`);
      } else if (editing) {
        await patch(`/api/donations/${editing.id}`, {
          donorName: form.donorName.trim(),
          donorEmail: form.donorEmail.trim().toLowerCase(),
          donorPhone: form.donorPhone.trim() || null,
          pan: form.pan.trim().toUpperCase() || null,
          isAnonymous: form.isAnonymous,
          amount: Number(form.amount),
          currency: form.currency,
          type: form.type,
          recurringFrequency:
            form.type === "RECURRING" ? form.recurringFrequency : null,
          nextChargeAt:
            form.type === "RECURRING" && form.nextChargeAt
              ? new Date(form.nextChargeAt).toISOString()
              : null,
          category: form.category,
          campaignId: form.campaignId === "NONE" ? null : form.campaignId,
          paymentMethod: form.paymentMethod,
          paymentProvider:
            form.paymentProvider === "NONE" ? null : form.paymentProvider,
          transactionId: form.transactionId.trim() || null,
          gatewayOrderId: form.gatewayOrderId.trim() || null,
          paymentStatus: form.paymentStatus,
          fees: form.fees.trim() === "" ? 0 : Number(form.fees),
          settlementDate: form.settlementDate
            ? new Date(form.settlementDate).toISOString()
            : null,
          receiptStatus: form.receiptStatus,
          internalNotes: form.internalNotes.trim() || null,
        });
        toast.success(`Donation ${editing.receiptNumber} updated`);
      }
      setFormOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the donation");
    } finally {
      setSaving(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setQ("");
    setStatus("ALL");
    setType("ALL");
    setCategory("ALL");
    setMethod("ALL");
    setFrom("");
    setTo("");
    setPage(1);
  };

  /* ---------------------------- table + toolbar ---------------------------- */

  const filterChips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (q) filterChips.push({ key: "q", label: `“${q}”`, clear: () => setSearch("") });
  if (status !== "ALL")
    filterChips.push({ key: "status", label: humanize(status), clear: () => setStatus("ALL") });
  if (type !== "ALL")
    filterChips.push({ key: "type", label: humanize(type), clear: () => setType("ALL") });
  if (category !== "ALL")
    filterChips.push({
      key: "category",
      label: CATEGORY_LABEL[category] ?? titleCase(category),
      clear: () => setCategory("ALL"),
    });
  if (method !== "ALL")
    filterChips.push({
      key: "method",
      label: METHOD_LABEL[method] ?? titleCase(method),
      clear: () => setMethod("ALL"),
    });
  if (from)
    filterChips.push({ key: "from", label: `From ${formatDate(from)}`, clear: () => setFrom("") });
  if (to) filterChips.push({ key: "to", label: `To ${formatDate(to)}`, clear: () => setTo("") });

  const emptyNode = (
    <EmptyState
      icon={<ReceiptText className="size-6" />}
      title={hasFilters ? "No donations match your filters" : "No donations recorded yet"}
      hint={
        hasFilters
          ? "Try widening the date range or clearing the filters below."
          : "Record the first gift — online or offline — to start the ledger."
      }
    >
      <div className="flex flex-wrap items-center justify-center gap-2">
        {hasFilters ? (
          <Button variant="outline" size="sm" onClick={clearFilters}>
            <X className="size-4" /> Clear filters
          </Button>
        ) : null}
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" /> Record donation
        </Button>
      </div>
    </EmptyState>
  );

  const donationColumns: DataTableColumn<DonationRow>[] = [
    { key: "receiptNumber", header: "Receipt #", mono: true },
    { key: "donor", header: "Donor" },
    { key: "amount", header: "Amount", align: "right", mono: true, className: "font-semibold" },
    { key: "type", header: "Type", hideBelow: "md" },
    { key: "category", header: "Category", hideBelow: "lg" },
    { key: "method", header: "Method", hideBelow: "lg" },
    { key: "status", header: "Status" },
    { key: "date", header: "Date", hideBelow: "md" },
    { key: "campaign", header: "Campaign", hideBelow: "lg" },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right" },
  ];

  const renderDonationCell = (d: DonationRow, col: DataTableColumn<DonationRow>) => {
    switch (col.key) {
      case "receiptNumber":
        return d.receiptNumber;
      case "donor":
        return (
          <div className="flex max-w-[220px] flex-col">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="truncate">{d.donorName}</span>
              {d.isAnonymous ? (
                <span className="flex shrink-0 items-center gap-0.5 rounded-full border bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                  <UserX className="size-3" aria-hidden="true" /> Anon
                </span>
              ) : null}
            </span>
            <span className="truncate text-xs text-muted-foreground">{d.donorEmail}</span>
          </div>
        );
      case "amount":
        return formatMoney(d.amount, d.currency || DEFAULT_CURRENCY);
      case "type":
        return <span className="text-xs">{humanize(d.type)}</span>;
      case "category":
        return <span className="text-xs">{CATEGORY_LABEL[d.category] ?? titleCase(d.category)}</span>;
      case "method":
        return (
          <span className="text-xs">
            {METHOD_LABEL[d.paymentMethod] ?? titleCase(d.paymentMethod)}
          </span>
        );
      case "status":
        return <StatusBadge status={d.paymentStatus} />;
      case "date":
        return <span className="text-xs">{formatDate(d.createdAt)}</span>;
      case "campaign":
        return (
          <span className="block max-w-[160px] truncate text-xs text-muted-foreground">
            {d.campaign?.title ?? "General fund"}
          </span>
        );
      case "actions":
        return (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <RowActions
              row={d}
              onView={() => openDetail(d)}
              onEdit={() => openEdit(d)}
              onRefund={() => openRefund(d)}
              onDelete={() => askDelete(d)}
            />
          </div>
        );
      default:
        return null;
    }
  };

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Donations"
        description="Every rupee in and out — receipts, gateways, refunds and 80G compliance."
        icon={<ReceiptText className="size-5" />}
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Record donation
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Collected this FY"
          value={formatINR(stats.fyCollected)}
          icon={<IndianRupee className="size-5" />}
          accent="emerald"
          hint={`${financialYear(new Date())} · completed payments`}
          loading={statsLoading}
        />
        <StatCard
          label="All-time donations"
          value={String(stats.allTime)}
          icon={<ReceiptText className="size-5" />}
          accent="teal"
          hint="Every gift recorded"
          loading={statsLoading}
        />
        <StatCard
          label="Pending"
          value={String(stats.pending)}
          icon={<Clock3 className="size-5" />}
          accent="amber"
          hint="Awaiting staff verification"
          loading={statsLoading}
        />
        <StatCard
          label="Refunded total"
          value={formatINR(stats.refundedTotal)}
          icon={<RotateCcw className="size-5" />}
          accent="red"
          hint={`${stats.refundedCount} refund${stats.refundedCount === 1 ? "" : "s"} processed`}
          loading={statsLoading}
        />
      </div>

      {/* Ledger */}
      <SectionCard
        title="Donation ledger"
        description={
          total > 0
            ? `${total} record${total === 1 ? "" : "s"} · filtered server-side`
            : "Search, filter and reconcile every gift"
        }
        icon={<ReceiptText className="size-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              columns={CSV_COLUMNS}
              rows={items}
              filename={`uar-donations-${new Date().toISOString().slice(0, 10)}`}
              disabled={loading || items.length === 0}
            />
            <ViewSwitcher value={view} onChange={setView} />
          </div>
        }
        bodyClassName="flex flex-col gap-4"
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, receipt, txn…"
              aria-label="Search donations"
              className="h-8 pl-8 text-sm"
            />
          </div>

          {/* status */}
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger size="sm" aria-label="Filter by status" className="w-[128px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* type */}
          <Select
            value={type}
            onValueChange={(v) => {
              setType(v);
              setPage(1);
            }}
          >
            <SelectTrigger size="sm" aria-label="Filter by type" className="w-[112px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              {TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* category */}
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(v);
              setPage(1);
            }}
          >
            <SelectTrigger size="sm" aria-label="Filter by category" className="w-[136px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {CATEGORY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* method */}
          <Select
            value={method}
            onValueChange={(v) => {
              setMethod(v);
              setPage(1);
            }}
          >
            <SelectTrigger size="sm" aria-label="Filter by payment method" className="w-[128px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All methods</SelectItem>
              {METHOD_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            aria-label="From date"
            className="h-8 w-[140px] text-xs"
          />
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            aria-label="To date"
            className="h-8 w-[140px] text-xs"
          />

          {filterChips.map((chip) => (
            <Badge key={chip.key} variant="outline" className="gap-1 pr-1 text-xs font-medium">
              {chip.label}
              <button
                type="button"
                aria-label={`Clear ${chip.label} filter`}
                onClick={chip.clear}
                className="rounded-full p-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}

          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters} aria-label="Clear all filters">
              <X className="size-4" /> Clear all
            </Button>
          ) : null}

          <span
            className="ml-auto text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            {loading ? "Loading…" : `${total} result${total === 1 ? "" : "s"}`}
          </span>
        </div>

        {/* Content */}
        {view === "table" ? (
          <DataTable
            columns={donationColumns}
            rows={items}
            rowKey={(d) => d.id}
            loading={loading}
            skeletonRows={9}
            height="fill"
            fillOffset={520}
            onRowClick={openDetail}
            page={page}
            pages={pages}
            total={total}
            pageSize={limit}
            onPage={setPage}
            onPageSize={(n) => {
              setLimit(n);
              setPage(1);
            }}
            itemLabel="donations"
            empty={emptyNode}
          >
            {renderDonationCell}
          </DataTable>
        ) : loading ? (
          <ListSkeleton mode={view} />
        ) : items.length === 0 ? (
          emptyNode
        ) : view === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((d) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(d)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openDetail(d);
                }}
                className="flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <DonorAvatar name={d.isAnonymous ? "Anonymous" : d.donorName} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        <span className="truncate">{d.donorName}</span>
                        {d.isAnonymous ? (
                          <UserX
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.donorEmail}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={d.paymentStatus} />
                </div>

                <div className="flex items-end justify-between gap-2">
                  <p className="text-xl font-bold tracking-tight tabular-nums">
                    {formatMoney(d.amount, d.currency || DEFAULT_CURRENCY)}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {d.receiptNumber}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    {CATEGORY_LABEL[d.category] ?? titleCase(d.category)}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {humanize(d.type)}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDate(d.createdAt)}
                  </span>
                </div>

                {d.campaign?.title ? (
                  <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <Megaphone className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{d.campaign.title}</span>
                  </p>
                ) : null}

                <div
                  className="mt-auto flex items-center justify-between border-t pt-2.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button variant="ghost" size="sm" onClick={() => openDetail(d)}>
                    <Eye className="size-3.5" /> View
                  </Button>
                  <RowActions
                    row={d}
                    onView={() => openDetail(d)}
                    onEdit={() => openEdit(d)}
                    onRefund={() => openRefund(d)}
                    onDelete={() => askDelete(d)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col divide-y rounded-lg border">
            {items.map((d) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(d)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openDetail(d);
                }}
                className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <DonorAvatar name={d.isAnonymous ? "Anonymous" : d.donorName} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{d.donorName}</span>
                    <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
                      {d.receiptNumber}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {CATEGORY_LABEL[d.category] ?? titleCase(d.category)} ·{" "}
                    {METHOD_LABEL[d.paymentMethod] ?? titleCase(d.paymentMethod)} ·{" "}
                    {formatDate(d.createdAt)}
                  </p>
                </div>
                <StatusBadge status={d.paymentStatus} className="hidden sm:inline-flex" />
                <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {formatMoney(d.amount, d.currency || DEFAULT_CURRENCY)}
                </span>
                <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <RowActions
                    row={d}
                    onView={() => openDetail(d)}
                    onEdit={() => openEdit(d)}
                    onRefund={() => openRefund(d)}
                    onDelete={() => askDelete(d)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination (grid / list — the DataTable pager covers the table view) */}
        {view !== "table" && !loading && items.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <PaginationBar
              page={page}
              pages={pages}
              total={total}
              onPage={setPage}
              itemLabel="donations"
            />
            <PageSizeSelect
              value={limit}
              onChange={(n) => {
                setLimit(n);
                setPage(1);
              }}
            />
          </div>
        ) : null}
      </SectionCard>

      {/* Detail sheet — full-screen, all Donation fields */}
      <DetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        eyebrow="Donations"
        title={detail?.receiptNumber ?? "Donation detail"}
        description={
          detail
            ? `${detail.isAnonymous ? "Anonymous donor" : detail.donorName} · ${detail.donorEmail} · recorded ${formatDateTime(detail.createdAt)}`
            : "Loading donation…"
        }
        status={detail ? <StatusBadge status={detail.paymentStatus} /> : undefined}
        loading={detailLoading && !detail}
        actions={
          detail ? (
            <>
              {detail.receiptNumber && detail.paymentStatus === "COMPLETED" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(
                      `/api/receipts/${detail.receiptNumber}/html`,
                      "_blank",
                      "noopener,noreferrer"
                    )
                  }
                >
                  <ExternalLink className="size-4" /> 80G receipt
                </Button>
              ) : null}
              <Button size="sm" onClick={() => openEdit(detail)}>
                <Pencil className="size-4" /> Edit
              </Button>
            </>
          ) : undefined
        }
      >
        {detail && !detailLoading ? <DetailContent d={detail} /> : <DetailSkeleton />}
      </DetailSheet>

      {/* Record / Edit form */}
      <FormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        size="lg"
        title={formMode === "create" ? "Record donation" : `Edit donation · ${editing?.receiptNumber ?? ""}`}
        description={
          formMode === "create"
            ? "Log an online or offline gift. A receipt number is generated automatically."
            : "Update donor, payment or receipt details. Campaign totals are recalculated automatically."
        }
        submitLabel={formMode === "create" ? "Record donation" : "Save changes"}
        onSubmit={submitForm}
        loading={saving}
        dirty={dirty}
      >
        <FormSection title="Donor" description="Identity used on the receipt and in the donor CRM.">
          <FieldGrid>
            <TextField
              label="Donor name"
              required
              value={form.donorName}
              onChange={(v) => setF("donorName", v)}
              error={errors.donorName}
              placeholder="Priya Verma"
            />
            <TextField
              label="Email"
              required
              type="email"
              inputMode="email"
              value={form.donorEmail}
              onChange={(v) => setF("donorEmail", v)}
              error={errors.donorEmail}
              placeholder="priya@example.com"
            />
            <TextField
              label="Phone"
              inputMode="tel"
              value={form.donorPhone}
              onChange={(v) => setF("donorPhone", v)}
              error={errors.donorPhone}
              placeholder="9876543210"
            />
            <TextField
              label="PAN"
              value={form.pan}
              onChange={(v) => setF("pan", v.toUpperCase())}
              error={errors.pan}
              hint="Needed for 80G receipts — format ABCDE1234F"
              placeholder="ABCDE1234F"
            />
          </FieldGrid>
          <SwitchField
            label="Anonymous donor"
            hint="Hides the donor name on public walls and reports."
            checked={form.isAnonymous}
            onChange={(v) => setF("isAnonymous", v)}
          />
        </FormSection>

        <FormSection title="Donation">
          <FieldGrid>
            <TextField
              label="Amount"
              required
              prefix={getCurrency(form.currency).symbol}
              inputMode="decimal"
              value={form.amount}
              onChange={(v) => setF("amount", v)}
              error={errors.amount}
              placeholder="5000"
            />
            <SelectField
              label="Currency"
              value={form.currency}
              onChange={(v) => setF("currency", v)}
              options={CURRENCY_OPTIONS}
            />
            <SelectField
              label="Type"
              value={form.type}
              onChange={(v) => setF("type", v)}
              options={TYPE_OPTIONS}
            />
            {form.type === "RECURRING" ? (
              <>
                <SelectField
                  label="Frequency"
                  value={form.recurringFrequency}
                  onChange={(v) => setF("recurringFrequency", v)}
                  options={FREQ_OPTIONS}
                />
                <TextField
                  label="Next charge date"
                  type="date"
                  value={form.nextChargeAt}
                  onChange={(v) => setF("nextChargeAt", v)}
                  error={errors.nextChargeAt}
                />
              </>
            ) : null}
            <SelectField
              label="Category"
              value={form.category}
              onChange={(v) => setF("category", v)}
              options={CATEGORY_OPTIONS}
            />
            <SelectField
              label="Campaign"
              value={form.campaignId}
              onChange={(v) => setF("campaignId", v)}
              options={campaignOptions}
              placeholder="General fund"
            />
          </FieldGrid>
        </FormSection>

        <FormSection
          title="Payment"
          description={
            formMode === "create"
              ? "Offline methods (cash, bank transfer, cheque) are saved as Pending until a staff member verifies them."
              : undefined
          }
        >
          <FieldGrid>
            <SelectField
              label="Method"
              value={form.paymentMethod}
              onChange={(v) => setF("paymentMethod", v)}
              options={METHOD_OPTIONS}
            />
            <SelectField
              label="Provider"
              value={form.paymentProvider}
              onChange={(v) => setF("paymentProvider", v)}
              options={[{ value: "NONE", label: "Not set" }, ...PROVIDER_OPTIONS]}
              placeholder="Not set"
            />
            <TextField
              label="Transaction ID"
              value={form.transactionId}
              onChange={(v) => setF("transactionId", v)}
              placeholder="pay_NxLmK…"
            />
            <TextField
              label="Gateway order ID"
              value={form.gatewayOrderId}
              onChange={(v) => setF("gatewayOrderId", v)}
              placeholder="order_NxLmK…"
            />
            {formMode === "edit" ? (
              <>
                <SelectField
                  label="Payment status"
                  value={form.paymentStatus}
                  onChange={(v) => setF("paymentStatus", v)}
                  options={STATUS_OPTIONS}
                />
                <TextField
                  label="Gateway fees"
                  prefix={getCurrency(form.currency).symbol}
                  inputMode="decimal"
                  value={form.fees}
                  onChange={(v) => setF("fees", v)}
                  error={errors.fees}
                  hint="Net amount = donation − fees"
                />
                <TextField
                  label="Settlement date"
                  type="date"
                  value={form.settlementDate}
                  onChange={(v) => setF("settlementDate", v)}
                  error={errors.settlementDate}
                />
              </>
            ) : null}
          </FieldGrid>
        </FormSection>

        {formMode === "edit" ? (
          <FormSection
            title="Receipt & notes"
            description="80G receipt tracking and internal remarks (never shown to donors)."
          >
            <FieldGrid>
              <SelectField
                label="Receipt status"
                value={form.receiptStatus}
                onChange={(v) => setF("receiptStatus", v)}
                options={RECEIPT_STATUS_OPTIONS}
              />
            </FieldGrid>
            <TextareaField
              label="Internal notes"
              value={form.internalNotes}
              onChange={(v) => setF("internalNotes", v)}
              rows={3}
              placeholder="Verification remarks, cheque numbers, follow-ups…"
            />
          </FormSection>
        ) : null}
      </FormSheet>

      {/* Refund form (sm) */}
      <FormSheet
        open={refundOpen}
        onOpenChange={(o) => {
          setRefundOpen(o);
          if (!o) setRefundConfirm(false);
        }}
        size="sm"
        title={`Refund · ${refundTarget?.receiptNumber ?? ""}`}
        description={`Record a refund against ${formatMoney(refundTarget?.amount ?? 0, refundTarget?.currency || DEFAULT_CURRENCY)} from ${
          refundTarget?.donorName ?? "the donor"
        }. The payment status flips to Refunded automatically.`}
        submitLabel="Continue"
        onSubmit={submitRefundStep}
        loading={refundSaving}
        dirty={refundDirty}
      >
        <TextField
          label="Refund amount"
          required
          prefix={getCurrency(refundTarget?.currency).symbol}
          inputMode="decimal"
          value={refundAmount}
          onChange={(v) => {
            setRefundAmount(v);
            setRefundErr(null);
          }}
          error={refundErr}
          hint="Full or partial — cannot exceed the donation amount."
        />
        <TextareaField
          label="Reason"
          value={refundReason}
          onChange={setRefundReason}
          rows={3}
          placeholder="Duplicate donation, donor request, campaign closed…"
        />
      </FormSheet>

      <ConfirmDialog
        open={refundConfirm}
        onOpenChange={setRefundConfirm}
        title="Confirm refund"
        recordName={
          refundTarget
            ? `${formatMoney(Number(refundAmount), refundTarget.currency || DEFAULT_CURRENCY)} · ${refundTarget.donorName} · ${refundTarget.receiptNumber}`
            : null
        }
        description="The donation will be marked Refunded and the receipt loses 80G validity. This action is logged in the activity trail."
        confirmLabel="Record refund"
        loading={refundSaving}
        onConfirm={confirmRefund}
      />

      {/* Delete */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete donation"
        recordName={
          deleteTarget
            ? `${deleteTarget.receiptNumber} · ${formatMoney(deleteTarget.amount, deleteTarget.currency || DEFAULT_CURRENCY)} · ${deleteTarget.donorName}`
            : null
        }
        description="This permanently removes the payment record and recalculates the linked campaign total. Donor CRM profiles are kept."
        confirmLabel="Delete donation"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
