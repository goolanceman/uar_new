"use client";

/**
 * Campaigns (admin) — rebuilt on the round-5 design system.
 *
 * - KPI stat strip (total / active / raised / beneficiaries reached)
 * - Toolbar: debounced search + status/category filters + active-filter chips
 *   + result count in one row; ViewSwitcher (table / grid / list, persisted)
 *   and CSV export in the card header
 * - Table view = DataTable (height="fill", sticky header, skeleton rows,
 *   built-in premium pager)
 * - Create/Edit via FormSheet (full-screen composer: identity / goal /
 *   branding / schedule / team / media / budget / settings) with inline
 *   validation, dirty tracking and an unsaved-changes guard
 * - Full-screen DetailSheet: complete campaign 360 (funding, schedule,
 *   coordinator, budget breakdown, media & SEO, reach, record)
 * - Row actions: View / Edit / Duplicate / one-click Featured & Urgent
 *   toggles (PATCH + toast) / Activate / Pause / Complete (ConfirmDialog) /
 *   Delete (blocked when funds were raised)
 * - Tiny Featured/Urgent pills in table cells, grid cards and the detail header
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Baby,
  BarChart3,
  CheckCircle2,
  Copy,
  Eye,
  Flower2,
  Heart,
  HeartHandshake,
  IndianRupee,
  Loader2,
  MapPin,
  MoreHorizontal,
  Package,
  Pause,
  PawPrint,
  Pencil,
  Phone,
  Pill,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Siren,
  Smartphone,
  Sprout,
  Star,
  Trash2,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { del, get, patch, post } from "@/lib/api-client";
import { CAMPAIGN_STATUSES } from "@/lib/campaigns";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatINR, formatINRCompact, titleCase } from "@/lib/format";
import { amountRule, phoneRule, required } from "@/lib/validators";
import { PageHeader } from "@/components/shared/page-header";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import {
  PaginationBar,
  PageSizeSelect,
  useViewPref,
  ViewSwitcher,
  type DataViewMode,
} from "@/components/shared/view-switcher";
import {
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import {
  Field,
  FieldGrid,
  FormSection,
  SelectField,
  SwitchField,
  TextareaField,
  TextField,
} from "@/components/shared/form-fields";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  FilePickButton,
  fileUrl,
  type FileAssetView,
} from "@/components/shared/file-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRowBusy } from "@/hooks/use-row-busy";
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

/* ------------------------------ types & helpers ---------------------------- */

interface BudgetHead {
  head: string;
  amount: number;
}

interface Campaign {
  id: string;
  code: string;
  title: string;
  slug?: string | null;
  tagline?: string | null;
  description: string;
  category: string;
  targetAmount: number;
  raisedAmount: number;
  status: string;
  icon: string;
  accent: string;
  urgent?: boolean;
  taxEligible?: boolean;
  minDonation?: number | null;
  videoUrl?: string | null;
  gallery?: string | null;
  coverImage?: string | null;
  budgetBreakdown?: string | null;
  coordinatorName?: string | null;
  coordinatorPhone?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
  helpline?: string | null;
  featured: boolean;
  beneficiaries: number;
  volunteersEngaged: number;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface BudgetRow {
  head: string;
  amount: string;
}

interface CampaignAnalytics {
  campaigns: {
    total: number;
    draft: number;
    active: number;
    paused: number;
    completed: number;
    cancelled: number;
    featured: number;
    urgent: number;
    totalRaised: number;
    totalTarget: number;
  };
  category: Array<{ category: string; count: number; raised: number; target: number }>;
  status: Array<{ status: string; count: number }>;
  monthly: Array<{ label: string; amount: number; count: number }>;
  topCampaigns: Array<{
    id: string;
    title: string;
    status: string;
    raised: number;
    target: number;
    pct: number;
  }>;
  reach: { beneficiaries: number; volunteersEngaged: number };
}

interface CampaignFormState {
  title: string;
  slug: string;
  slugTouched: boolean;
  tagline: string;
  description: string;
  category: string;
  icon: string;
  accent: string;
  targetAmount: string;
  minDonation: string;
  taxEligible: boolean;
  featured: boolean;
  urgent: boolean;
  startDate: string;
  endDate: string;
  location: string;
  coordinatorName: string;
  coordinatorPhone: string;
  helpline: string;
  videoUrl: string;
  gallery: string;
  coverImage: string;
  seoTitle: string;
  seoDescription: string;
  budget: BudgetRow[];
  status: string;
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
];
const STATUSES = CAMPAIGN_STATUSES;

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "shield-alert": ShieldAlert,
  smartphone: Smartphone,
  "heart-handshake": HeartHandshake,
  baby: Baby,
  pill: Pill,
  "paw-print": PawPrint,
  siren: Siren,
  package: Package,
  "flower-2": Flower2,
  heart: Heart,
};
const ICON_KEYS = Object.keys(ICONS);

/** Dark-safe accent classes for the 9 campaign accents. */
const ACCENTS: Record<string, { chip: string; dot: string; bar: string; ring: string }> = {
  orange: { chip: "bg-orange-500/10 text-orange-600 dark:text-orange-400", dot: "bg-orange-500", bar: "[&>div]:bg-orange-500", ring: "border-orange-500/30" },
  cyan: { chip: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400", dot: "bg-cyan-500", bar: "[&>div]:bg-cyan-500", ring: "border-cyan-500/30" },
  fuchsia: { chip: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400", dot: "bg-fuchsia-500", bar: "[&>div]:bg-fuchsia-500", ring: "border-fuchsia-500/30" },
  amber: { chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400", dot: "bg-amber-500", bar: "[&>div]:bg-amber-500", ring: "border-amber-500/30" },
  teal: { chip: "bg-teal-500/10 text-teal-600 dark:text-teal-400", dot: "bg-teal-500", bar: "[&>div]:bg-teal-500", ring: "border-teal-500/30" },
  lime: { chip: "bg-lime-500/10 text-lime-600 dark:text-lime-400", dot: "bg-lime-500", bar: "[&>div]:bg-lime-500", ring: "border-lime-500/30" },
  red: { chip: "bg-red-500/10 text-red-600 dark:text-red-400", dot: "bg-red-500", bar: "[&>div]:bg-red-500", ring: "border-red-500/30" },
  emerald: { chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", bar: "[&>div]:bg-emerald-500", ring: "border-emerald-500/30" },
  pink: { chip: "bg-pink-500/10 text-pink-600 dark:text-pink-400", dot: "bg-pink-500", bar: "[&>div]:bg-pink-500", ring: "border-pink-500/30" },
};
const ACCENT_KEYS = Object.keys(ACCENTS);

/** Hex fills for recharts (Tailwind classes don't work on SVG fill). */
const STATUS_HEX: Record<string, string> = {
  DRAFT: "#a1a1aa",
  ACTIVE: "#10b981",
  PAUSED: "#f59e0b",
  COMPLETED: "#14b8a6",
  CANCELLED: "#ef4444",
};
const CATEGORY_PALETTE = [
  "#f97316", "#06b6d4", "#d946ef", "#f59e0b", "#14b8a6",
  "#84cc16", "#ef4444", "#10b981", "#ec4899", "#6366f1",
];

const URL_RE = /^https?:\/\/\S+$/i;
// Gallery/cover images may be absolute http(s) URLs or site-relative
// file-manager assets served by /api/files/:id/file.
const IMAGE_URL_RE =
  /^(https?:\/\/\S+|\/api\/files\/[\w-]+\/file(\?\S*)?|\/(public|uploads?)\/\S+)$/i;

/** Success toasts for the one-click row-menu flag toggles. */
const FLAG_TOASTS: Record<"featured" | "urgent", { on: string; off: string }> = {
  featured: { on: "Now featured on the home page", off: "Removed from home page" },
  urgent: { on: "Marked urgent — public urgent appeal enabled", off: "Urgent flag cleared" },
};

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isoToDateInput(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Days until endDate (negative = ended, null = no deadline). */
function daysLeft(end?: string | null): number | null {
  if (!end) return null;
  const d = new Date(end);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

function pctOf(raised: number, target: number): number {
  return target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;
}

/** Gallery editor — live thumbnails for every photo with hover remove and
 *  hover set-cover actions, plus a manual "paste URL" row for external
 *  images (Unsplash, CDNs) that are not in the file library. */
function GalleryEditor({
  urls,
  cover,
  onPickCover,
  onRemove,
  onAddUrl,
}: {
  urls: string[];
  cover: string;
  onPickCover: (url: string) => void;
  onRemove: (url: string) => void;
  onAddUrl: (url: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const addDraft = () => {
    onAddUrl(draft);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      {urls.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {urls.map((url, i) => {
            const isCover = url === cover || (!cover && i === 0);
            return (
              <div
                key={url + i}
                className={cn(
                  "group relative size-20 overflow-hidden rounded-lg border-2 bg-muted/30",
                  isCover ? "border-emerald-500" : "border-transparent"
                )}
              >
                <img
                  src={url}
                  alt={`Gallery photo ${i + 1}`}
                  loading="lazy"
                  className="size-full object-cover"
                />
                {isCover && (
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-emerald-600 py-0.5 text-[10px] font-semibold text-white">
                    <Star className="size-2.5 fill-current" aria-hidden /> Cover
                  </span>
                )}
                {/* Touch devices keep the actions visible; pointer devices reveal them on hover. */}
                <button
                  type="button"
                  aria-label={`Remove gallery photo ${i + 1}`}
                  title="Remove"
                  onClick={() => onRemove(url)}
                  className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-1 text-foreground opacity-100 transition hover:bg-background focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
                {!isCover && (
                  <button
                    type="button"
                    aria-label={`Set gallery photo ${i + 1} as cover photo`}
                    title="Set as cover photo"
                    onClick={() => onPickCover(url)}
                    className="absolute bottom-0.5 right-0.5 rounded-full bg-background/80 p-1 text-foreground opacity-100 transition hover:bg-background focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100"
                  >
                    <Star className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          No photos yet — pick from the library or paste an image URL below.
        </p>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            }
          }}
          placeholder="Paste an image URL (https://unsplash.com/…)"
          aria-label="Add gallery image URL"
          className="h-11 min-w-0 flex-1"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 shrink-0"
          onClick={addDraft}
        >
          <Plus className="size-4" aria-hidden="true" /> Add
        </Button>
      </div>
    </div>
  );
}

function parseGallery(v?: string | null): string[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.map(String).map((s) => s.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseBudget(v?: string | null): BudgetHead[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => ({ head: String(x?.head ?? ""), amount: Number(x?.amount) || 0 }));
  } catch {
    return [];
  }
}

const emptyForm: CampaignFormState = {
  title: "",
  slug: "",
  slugTouched: false,
  tagline: "",
  description: "",
  category: "GENERAL",
  icon: "heart",
  accent: "emerald",
  targetAmount: "",
  minDonation: "",
  taxEligible: true,
  featured: false,
  urgent: false,
  startDate: "",
  endDate: "",
  location: "",
  coordinatorName: "",
  coordinatorPhone: "",
  helpline: "",
  videoUrl: "",
  gallery: "",
  coverImage: "",
  seoTitle: "",
  seoDescription: "",
  budget: [],
  status: "ACTIVE",
};

function validateForm(f: CampaignFormState): Record<string, string | null> {
  return {
    title: required("Title")(f.title),
    description: required("Description")(f.description),
    targetAmount: amountRule({ label: "Target amount" })(f.targetAmount),
    minDonation: amountRule({ optional: true, label: "Minimum donation" })(f.minDonation),
    endDate:
      f.startDate && f.endDate && f.endDate < f.startDate
        ? "End date cannot be before the start date"
        : null,
    coordinatorPhone: phoneRule(true)(f.coordinatorPhone),
    videoUrl:
      f.videoUrl.trim() && !URL_RE.test(f.videoUrl.trim())
        ? "Enter a valid URL starting with http(s)://"
        : null,
    gallery: (() => {
      const bad = f.gallery
        .split("\n")
        .map((s) => s.trim())
        .find((line) => line && !IMAGE_URL_RE.test(line));
      return bad ? `Not a valid image URL: ${bad.slice(0, 42)}` : null;
    })(),
  };
}

/* --------------------------- small presentational bits --------------------- */

function ProgressRing({ pct, accent }: { pct: number; accent: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const tone = ACCENTS[accent]?.chip ?? ACCENTS.emerald.chip;
  return (
    <div className={cn("relative mx-auto size-28", tone)}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (Math.min(100, pct) / 100) * c}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">
        {pct}%
      </span>
    </div>
  );
}

function DaysLeftChip({ end, className }: { end?: string | null; className?: string }) {
  const dl = daysLeft(end);
  if (dl === null) {
    return (
      <span className={cn("rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground", className)}>
        Ongoing
      </span>
    );
  }
  if (dl < 0) {
    return (
      <span className={cn("rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground", className)}>
        Ended
      </span>
    );
  }
  const cls =
    dl <= 3
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : dl <= 7
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-teal-500/10 text-teal-600 dark:text-teal-400";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", cls, className)}>
      {dl === 0 ? "Last day" : `${dl}d left`}
    </span>
  );
}

/** Tiny featured/urgent pills — table cells, grid cards, detail header. */
function CampaignFlagBadges({
  featured,
  urgent,
  className,
}: {
  featured: boolean;
  urgent: boolean;
  className?: string;
}) {
  if (!featured && !urgent) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
      {featured && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600 ring-1 ring-inset ring-amber-500/30 dark:text-amber-400">
          <Star className="size-3" aria-hidden="true" /> Featured
        </span>
      )}
      {urgent && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-inset ring-red-500/30 dark:text-red-400">
          <Zap className="size-3" aria-hidden="true" /> Urgent
        </span>
      )}
    </span>
  );
}

function ViewSkeleton({ view }: { view: DataViewMode }) {
  if (view === "table") {
    return (
      <div className="space-y-2 rounded-xl border bg-card p-4" aria-busy="true">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  if (view === "list") {
    return (
      <div className="space-y-2 rounded-xl border bg-card p-4" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-72 rounded-xl" />
      ))}
    </div>
  );
}

/* ---------------------------------- view ----------------------------------- */

export default function CampaignsView() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const { busyId, setBusyId } = useRowBusy();
  const [saving, setSaving] = useState(false);

  // tabs
  const [tab, setTab] = useState<"directory" | "analytics">("directory");
  const [analytics, setAnalytics] = useState<CampaignAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // filters (search is debounced into `query`)
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [category, setCategory] = useState("ALL");

  // view + pagination
  const [view, setView] = useViewPref("campaigns", "grid");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // form sheet
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CampaignFormState>({ ...emptyForm });
  const [snapshot, setSnapshot] = useState(JSON.stringify(emptyForm));
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // detail sheet + confirms
  const [viewTarget, setViewTarget] = useState<Campaign | null>(null);
  const [viewDonationCount, setViewDonationCount] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [completeTarget, setCompleteTarget] = useState<Campaign | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<Campaign[] | { items?: Campaign[] }>("/api/campaigns?all=1");
      setRows(Array.isArray(data) ? data : (data.items ?? []));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const data = await get<CampaignAnalytics>("/api/campaign-analytics");
      setAnalytics(data ?? null);
    } catch {
      setAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    void loadAnalytics();
  }, [load, loadAnalytics]);

  const refreshAll = useCallback(() => {
    void load();
    void loadAnalytics();
  }, [load, loadAnalytics]);

  // debounce search 300ms
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  // reset pagination when the result set changes
  useEffect(() => {
    setPage(1);
  }, [query, status, category, pageSize]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((c) => {
      if (status !== "ALL" && c.status !== status) return false;
      if (category !== "ALL" && c.category !== category) return false;
      if (needle) {
        const hay = `${c.title} ${c.code ?? ""} ${c.slug ?? ""} ${c.tagline ?? ""} ${c.location ?? ""} ${c.coordinatorName ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, query, status, category]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize]
  );

  // KPI strip — computed from the loaded directory, no extra API calls
  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((c) => c.status === "ACTIVE").length,
      raised: rows.reduce((s, c) => s + (Number(c.raisedAmount) || 0), 0),
      beneficiaries: rows.reduce((s, c) => s + (Number(c.beneficiaries) || 0), 0),
    }),
    [rows]
  );

  /* ------------------------------- validation ------------------------------ */

  const errors = useMemo(() => validateForm(form), [form]);
  const errorCount = useMemo(() => Object.values(errors).filter(Boolean).length, [errors]);

  const budgetError = useMemo(() => {
    for (const r of form.budget) {
      const hasHead = r.head.trim() !== "";
      const hasAmount = r.amount.trim() !== "";
      if (!hasHead && !hasAmount) continue;
      if (!hasHead) return "Every budget row needs a head";
      const n = Number(r.amount);
      if (!hasAmount || !Number.isFinite(n) || n < 0)
        return `Enter a valid amount for “${r.head.trim()}”`;
    }
    return null;
  }, [form.budget]);

  const budgetTotal = useMemo(
    () =>
      form.budget.reduce((s, r) => {
        const n = Number(r.amount);
        return r.head.trim() || r.amount.trim() ? s + (Number.isFinite(n) ? n : 0) : s;
      }, 0),
    [form.budget]
  );

  const dirty = JSON.stringify(form) !== snapshot;

  /* ------------------------------- form actions ---------------------------- */

  const handleFormOpenChange = (open: boolean) => {
    if (!open && dirty) {
      setConfirmDiscard(true);
      return;
    }
    setFormOpen(false);
  };

  const openCreate = () => {
    setEditingId(null);
    const f: CampaignFormState = { ...emptyForm, startDate: isoToDateInput(new Date().toISOString()) };
    setForm(f);
    setSnapshot(JSON.stringify(f));
    setFormOpen(true);
  };

  const openEdit = (c: Campaign) => {
    setEditingId(c.id);
    const f: CampaignFormState = {
      title: c.title ?? "",
      slug: c.slug ?? "",
      slugTouched: true,
      tagline: c.tagline ?? "",
      description: c.description ?? "",
      category: c.category ?? "GENERAL",
      icon: c.icon ?? "heart",
      accent: c.accent ?? "emerald",
      targetAmount: c.targetAmount !== undefined ? String(c.targetAmount) : "",
      minDonation: c.minDonation != null ? String(c.minDonation) : "",
      taxEligible: c.taxEligible !== false,
      featured: Boolean(c.featured),
      urgent: Boolean(c.urgent),
      startDate: isoToDateInput(c.startDate),
      endDate: isoToDateInput(c.endDate),
      location: c.location ?? "",
      coordinatorName: c.coordinatorName ?? "",
      coordinatorPhone: c.coordinatorPhone ?? "",
      helpline: c.helpline ?? "",
      videoUrl: c.videoUrl ?? "",
      gallery: parseGallery(c.gallery).join("\n"),
      coverImage: c.coverImage ?? "",
      seoTitle: c.seoTitle ?? "",
      seoDescription: c.seoDescription ?? "",
      budget: parseBudget(c.budgetBreakdown).map((b) => ({ head: b.head, amount: String(b.amount) })),
      status: c.status ?? "ACTIVE",
    };
    setForm(f);
    setSnapshot(JSON.stringify(f));
    setFormOpen(true);
  };

  const save = async () => {
    if (errorCount > 0 || budgetError) {
      toast.error(`${errorCount + (budgetError ? 1 : 0)} field(s) need attention`);
      return;
    }
    setSaving(true);
    try {
      const gallery = form.gallery
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      // Cover must be one of the gallery URLs; fall back to the first photo.
      const coverImage = gallery.includes(form.coverImage.trim())
        ? form.coverImage.trim()
        : gallery[0] ?? "";
      const budget = form.budget
        .map((r) => ({ head: r.head.trim(), amount: Number(r.amount) || 0 }))
        .filter((r) => r.head || r.amount > 0);
      const body = {
        title: form.title.trim(),
        slug: form.slug.trim() || undefined,
        tagline: form.tagline.trim() || undefined,
        description: form.description.trim(),
        category: form.category,
        targetAmount: Number(form.targetAmount),
        minDonation: form.minDonation.trim() ? Number(form.minDonation) : null,
        taxEligible: form.taxEligible,
        featured: form.featured,
        urgent: form.urgent,
        startDate: form.startDate ? dateInputToIso(form.startDate) : undefined,
        endDate: dateInputToIso(form.endDate),
        location: form.location.trim() || undefined,
        icon: form.icon,
        accent: form.accent,
        helpline: form.helpline.trim() || undefined,
        coordinatorName: form.coordinatorName.trim() || undefined,
        coordinatorPhone: form.coordinatorPhone.trim() || undefined,
        videoUrl: form.videoUrl.trim() || undefined,
        gallery,
        coverImage: coverImage || null,
        budgetBreakdown: budget,
        seoTitle: form.seoTitle.trim() || undefined,
        seoDescription: form.seoDescription.trim() || undefined,
        ...(editingId ? { status: form.status } : {}),
      };
      if (editingId) {
        await patch(`/api/campaigns/${editingId}`, body);
        toast.success("Campaign updated");
      } else {
        await post("/api/campaigns", body);
        toast.success("Campaign created");
      }
      setFormOpen(false);
      await Promise.all([load(), loadAnalytics()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save campaign");
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------- media library pickers ------------------------- */

  /** Appends library-picked URLs to the newline-separated gallery list (deduped). */
  const appendGalleryUrls = (files: FileAssetView[]) => {
    if (files.length === 0) return;
    setForm((f) => {
      const existing = f.gallery
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const merged = [...existing, ...files.map((x) => fileUrl(x.id)).filter((u) => !existing.includes(u))];
      return { ...f, gallery: merged.join("\n") };
    });
  };

  /** Sets the cover from the library. save() keeps coverImage only when it is
   *  part of the gallery list, so the picked URL is merged in as well. */
  const pickCoverUrl = (files: FileAssetView[]) => {
    const f = files[0];
    if (!f) return;
    const url = fileUrl(f.id);
    setForm((prev) => {
      const lines = prev.gallery
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const gallery = lines.includes(url) ? prev.gallery : [...lines, url].join("\n");
      return { ...prev, coverImage: url, gallery };
    });
  };

  /** Removes a URL from the newline-separated gallery list; a removed cover
   *  clears the cover (save() falls back to the first remaining photo). */
  const removeGalleryUrl = (url: string) => {
    setForm((f) => ({
      ...f,
      gallery: f.gallery
        .split("\n")
        .map((s) => s.trim())
        .filter((line) => line && line !== url)
        .join("\n"),
      coverImage: f.coverImage.trim() === url ? "" : f.coverImage,
    }));
  };

  /** Appends a manually pasted image URL (Unsplash, CDNs) to the gallery. */
  const addManualUrl = (raw: string) => {
    const url = raw.trim();
    if (!url) return;
    if (!IMAGE_URL_RE.test(url)) {
      toast.error("Enter a valid image URL (https://… or a library /api/files/… URL)");
      return;
    }
    setForm((f) => {
      const existing = f.gallery
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (existing.includes(url)) return { ...f, coverImage: f.coverImage || url };
      return { ...f, gallery: [...existing, url].join("\n") };
    });
  };

  /* ------------------------------ row actions ------------------------------ */

  const openView = (c: Campaign) => {
    setViewTarget(c);
    setViewDonationCount(null);
    get<unknown[] | { items?: unknown[]; total?: number }>(
      `/api/donations?campaignId=${encodeURIComponent(c.id)}&limit=1`
    )
      .then((d) => {
        if (Array.isArray(d)) setViewDonationCount(d.length);
        else setViewDonationCount(typeof d?.total === "number" ? d.total : (d.items?.length ?? 0));
      })
      .catch(() => setViewDonationCount(null));
  };

  const duplicate = async (c: Campaign) => {
    setBusyId(c.id);
    try {
      // slug is omitted on purpose — the server generates a fresh unique slug
      await post("/api/campaigns", {
        title: `${c.title} (Copy)`,
        tagline: c.tagline ?? undefined,
        description: c.description,
        category: c.category,
        targetAmount: c.targetAmount,
        startDate: c.startDate ?? undefined,
        endDate: c.endDate ?? null,
        location: c.location ?? undefined,
        icon: c.icon,
        accent: c.accent,
        helpline: c.helpline ?? undefined,
        featured: Boolean(c.featured),
        urgent: Boolean(c.urgent),
        taxEligible: c.taxEligible ?? true,
        minDonation: c.minDonation ?? null,
        videoUrl: c.videoUrl ?? undefined,
        gallery: parseGallery(c.gallery),
        coverImage: c.coverImage ?? undefined,
        budgetBreakdown: parseBudget(c.budgetBreakdown),
        coordinatorName: c.coordinatorName ?? undefined,
        coordinatorPhone: c.coordinatorPhone ?? undefined,
        seoTitle: c.seoTitle ?? undefined,
        seoDescription: c.seoDescription ?? undefined,
        status: c.status === "COMPLETED" || c.status === "CANCELLED" ? "DRAFT" : c.status,
      });
      toast.success(`Duplicated “${c.title}” — review the copy and activate it when ready.`);
      await Promise.all([load(), loadAnalytics()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Duplicate failed");
    } finally {
      setBusyId(null);
    }
  };

  const setStatusFor = async (c: Campaign, next: string) => {
    setBusyId(c.id);
    try {
      await patch(`/api/campaigns/${c.id}`, { status: next });
      toast.success(`${c.title} → ${titleCase(next)}`);
      await Promise.all([load(), loadAnalytics()]);
      setViewTarget((prev) => (prev && prev.id === c.id ? { ...prev, status: next } : prev));
      setCompleteTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setBusyId(null);
    }
  };

  /** One-click featured/urgent toggle from the row menu — PATCHes the single
   *  flag, toasts, refreshes both views and keeps the detail sheet in sync. */
  const toggleFlag = async (c: Campaign, field: "featured" | "urgent") => {
    const next = !c[field];
    setBusyId(c.id);
    try {
      await patch(
        `/api/campaigns/${c.id}`,
        field === "featured" ? { featured: next } : { urgent: next }
      );
      toast.success(next ? FLAG_TOASTS[field].on : FLAG_TOASTS[field].off);
      await Promise.all([load(), loadAnalytics()]);
      setViewTarget((prev) =>
        prev && prev.id === c.id
          ? field === "featured"
            ? { ...prev, featured: next }
            : { ...prev, urgent: next }
          : prev
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update flag");
    } finally {
      setBusyId(null);
    }
  };

  const requestDelete = (c: Campaign) => {
    if ((c.raisedAmount ?? 0) > 0) {
      toast.error(
        `${c.title} has ${formatINR(c.raisedAmount)} raised — campaigns with funds cannot be deleted. Pause it or mark it Complete instead.`
      );
      return;
    }
    setDeleteTarget(c);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await del(`/api/campaigns/${deleteTarget.id}`);
      toast.success("Campaign deleted");
      setDeleteTarget(null);
      setViewTarget(null);
      await Promise.all([load(), loadAnalytics()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete campaign");
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------ actions menu ----------------------------- */

  const RowMenu = ({ c }: { c: Campaign }) => {
    const hasFunds = (c.raisedAmount ?? 0) > 0;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 md:size-8"
            disabled={busyId !== null}
            aria-label={`Actions for campaign ${c.title}`}
            onClick={(e) => e.stopPropagation()}
          >
            {busyId === c.id ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => openView(c)}>
            <Eye className="size-4" /> View details
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openEdit(c)}>
            <Pencil className="size-4" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void duplicate(c)}>
            <Copy className="size-4" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={Boolean(c.featured)}
            onSelect={() => void toggleFlag(c, "featured")}
          >
            <Star className={cn("size-4", c.featured && "fill-current text-amber-500")} aria-hidden="true" />
            {c.featured ? "Remove from home page" : "Feature on home page"}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={Boolean(c.urgent)}
            onSelect={() => void toggleFlag(c, "urgent")}
          >
            <Zap className={cn("size-4", c.urgent && "text-red-500")} aria-hidden="true" />
            {c.urgent ? "Clear urgent flag" : "Mark urgent"}
          </DropdownMenuCheckboxItem>
          {(c.status === "DRAFT" || c.status === "PAUSED") && (
            <DropdownMenuItem onSelect={() => void setStatusFor(c, "ACTIVE")}>
              <CheckCircle2 className="size-4" /> Activate
            </DropdownMenuItem>
          )}
          {c.status === "ACTIVE" && (
            <DropdownMenuItem onSelect={() => void setStatusFor(c, "PAUSED")}>
              <Pause className="size-4" /> Pause
            </DropdownMenuItem>
          )}
          {(c.status === "ACTIVE" || c.status === "PAUSED") && (
            <DropdownMenuItem onSelect={() => setCompleteTarget(c)}>
              <CheckCircle2 className="size-4" /> Mark completed…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={hasFunds}
            onSelect={() => requestDelete(c)}
            className="text-red-600 focus:text-red-600 dark:text-red-400"
          >
            <Trash2 className="size-4" />
            {hasFunds ? "Delete — has donations" : "Delete"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const quickStatus = (c: Campaign) => {
    if (c.status === "ACTIVE") {
      return (
        <Button
          size="sm"
          variant="outline"
          disabled={busyId !== null}
          aria-label={`Pause campaign ${c.title}`}
          onClick={() => void setStatusFor(c, "PAUSED")}
        >
          Pause
        </Button>
      );
    }
    if (c.status === "DRAFT" || c.status === "PAUSED") {
      return (
        <Button
          size="sm"
          variant="outline"
          className="text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400"
          disabled={busyId !== null}
          aria-label={`Activate campaign ${c.title}`}
          onClick={() => void setStatusFor(c, "ACTIVE")}
        >
          Activate
        </Button>
      );
    }
    return null;
  };

  /* --------------------------------- CSV ----------------------------------- */

  const csvColumns: CsvColumn<Campaign>[] = [
    { header: "Title", value: (c) => c.title },
    { header: "Slug", value: (c) => c.slug ?? "" },
    { header: "Category", value: (c) => c.category },
    { header: "Status", value: (c) => c.status },
    { header: "Target (INR)", value: (c) => c.targetAmount },
    { header: "Raised (INR)", value: (c) => c.raisedAmount },
    { header: "Progress %", value: (c) => pctOf(c.raisedAmount, c.targetAmount) },
    { header: "Beneficiaries", value: (c) => c.beneficiaries },
    { header: "Volunteers", value: (c) => c.volunteersEngaged },
    { header: "Location", value: (c) => c.location ?? "" },
    { header: "Start date", value: (c) => formatDate(c.startDate) },
    { header: "End date", value: (c) => formatDate(c.endDate) },
    { header: "Days left", value: (c) => (daysLeft(c.endDate) === null ? "Ongoing" : String(daysLeft(c.endDate))) },
    { header: "Helpline", value: (c) => c.helpline ?? "" },
    { header: "Featured", value: (c) => (c.featured ? "Yes" : "No") },
    { header: "Urgent", value: (c) => (c.urgent ? "Yes" : "No") },
    { header: "80G eligible", value: (c) => (c.taxEligible === false ? "No" : "Yes") },
    { header: "Min donation (INR)", value: (c) => c.minDonation ?? "" },
    { header: "Coordinator", value: (c) => c.coordinatorName ?? "" },
    { header: "Coordinator phone", value: (c) => c.coordinatorPhone ?? "" },
    { header: "Video URL", value: (c) => c.videoUrl ?? "" },
    { header: "Budget heads", value: (c) => parseBudget(c.budgetBreakdown).map((b) => `${b.head}: ${b.amount}`).join(" | ") },
    { header: "SEO title", value: (c) => c.seoTitle ?? "" },
  ];

  /* ---------------------------- table + toolbar ---------------------------- */

  const filterChips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (query.trim())
    filterChips.push({ key: "q", label: `“${query.trim()}”`, clear: () => setSearch("") });
  if (status !== "ALL")
    filterChips.push({ key: "status", label: titleCase(status), clear: () => setStatus("ALL") });
  if (category !== "ALL")
    filterChips.push({
      key: "category",
      label: titleCase(category),
      clear: () => setCategory("ALL"),
    });

  const emptyNode = (
    <EmptyState
      icon={<Sprout className="size-6" aria-hidden="true" />}
      title={rows.length === 0 ? "No campaigns yet" : "No campaigns match the filters"}
      hint={
        rows.length === 0
          ? "Launch your first fundraising drive to start collecting donations."
          : "Try a different search term or clear the filters."
      }
    >
      {rows.length === 0 ? (
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" /> New campaign
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setSearch("");
            setQuery("");
            setStatus("ALL");
            setCategory("ALL");
          }}
        >
          Clear filters
        </Button>
      )}
    </EmptyState>
  );

  const campaignColumns: DataTableColumn<Campaign>[] = [
    { key: "campaign", header: "Campaign" },
    { key: "category", header: "Category", hideBelow: "lg" },
    { key: "status", header: "Status" },
    { key: "progress", header: "Progress", hideBelow: "md" },
    { key: "raised", header: "Raised", align: "right", mono: true },
    { key: "deadline", header: "Deadline", hideBelow: "lg" },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right" },
  ];

  const renderCampaignCell = (c: Campaign, col: DataTableColumn<Campaign>) => {
    const Icon = ICONS[c.icon] ?? Heart;
    const accent = ACCENTS[c.accent] ?? ACCENTS.emerald;
    const pct = pctOf(c.raisedAmount, c.targetAmount);
    switch (col.key) {
      case "campaign":
        return (
          <div className="flex items-center gap-2.5">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", accent.chip)}>
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                <span className="max-w-[200px] truncate">{c.title}</span>
                <CampaignFlagBadges featured={Boolean(c.featured)} urgent={Boolean(c.urgent)} />
              </p>
              <p className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
                <span>{c.code}</span>
                {c.slug && <span className="truncate">/{c.slug}</span>}
              </p>
            </div>
          </div>
        );
      case "category":
        return (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {titleCase(c.category)}
          </span>
        );
      case "status":
        return <StatusBadge status={c.status} />;
      case "progress":
        return (
          <div className="flex items-center gap-2">
            <Progress
              value={pct}
              className={cn("h-2 w-24", accent.bar)}
              aria-label={`${c.title} progress ${pct}%`}
            />
            <span className="text-xs text-muted-foreground">{pct}%</span>
          </div>
        );
      case "raised":
        return (
          <div className="flex flex-col items-end">
            <span>{formatINRCompact(c.raisedAmount)}</span>
            <span className="text-[11px] font-normal text-muted-foreground">
              of {formatINRCompact(c.targetAmount)}
            </span>
          </div>
        );
      case "deadline":
        return (
          <div className="flex flex-col items-start gap-1">
            <DaysLeftChip end={c.endDate} />
            <span className="text-[11px] text-muted-foreground">
              {c.endDate ? formatDate(c.endDate) : "No end date"}
            </span>
          </div>
        );
      case "actions":
        return (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <RowMenu c={c} />
          </div>
        );
      default:
        return null;
    }
  };

  /* --------------------------------- charts -------------------------------- */

  const categoryChart = (analytics?.category ?? [])
    .map((c, i) => ({
      name: titleCase(c.category),
      value: c.count,
      raised: c.raised,
      fill: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
    }))
    .filter((c) => c.value > 0);

  const statusChart = STATUSES.map((s) => ({
    status: titleCase(s),
    count: analytics?.status.find((x) => x.status === s)?.count ?? 0,
    fill: STATUS_HEX[s] ?? "#71717a",
  }));

  const monthlyChart = analytics?.monthly ?? [];

  /* -------------------------------- render --------------------------------- */

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Campaigns"
        description="Fundraising drives with live progress, budget transparency and status control."
        icon={<Sprout className="size-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" onClick={refreshAll} aria-label="Refresh campaign data">
              <RefreshCw className="size-4" aria-hidden="true" /> Refresh
            </Button>
            <Button onClick={openCreate} aria-label="Create new campaign">
              <Plus className="size-4" /> New campaign
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "directory" | "analytics")}>
        <TabsList className="h-auto w-full flex-wrap sm:w-auto">
          <TabsTrigger value="directory">
            Campaign directory
            <Badge variant="outline" className="ml-1.5 px-1.5 tabular-nums">
              {rows.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="mr-1 size-3.5" aria-hidden="true" /> Analytics
          </TabsTrigger>
        </TabsList>

      <TabsContent value="directory" className="mt-4 space-y-4 sm:space-y-6">

      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total campaigns"
          value={String(stats.total)}
          icon={<Sprout className="size-5" aria-hidden="true" />}
          accent="emerald"
          hint="All fundraising drives"
          loading={loading}
        />
        <StatCard
          label="Active now"
          value={String(stats.active)}
          icon={<Zap className="size-5" aria-hidden="true" />}
          accent="amber"
          hint="Accepting donations"
          loading={loading}
        />
        <StatCard
          label="Raised all-time"
          value={formatINRCompact(stats.raised)}
          icon={<IndianRupee className="size-5" aria-hidden="true" />}
          accent="teal"
          hint="Across every campaign"
          loading={loading}
        />
        <StatCard
          label="Beneficiaries reached"
          value={formatINRCompact(stats.beneficiaries)}
          icon={<Users className="size-5" aria-hidden="true" />}
          accent="fuchsia"
          hint="Sum of campaign reach"
          loading={loading}
        />
      </div>

      <SectionCard
        title="Campaign directory"
        icon={<Sprout className="size-4" aria-hidden="true" />}
        description={
          loading ? "Loading campaigns…" : `${filtered.length} of ${rows.length} campaigns`
        }
        bodyClassName="space-y-4"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              columns={csvColumns}
              rows={filtered}
              filename="uar-campaigns"
              disabled={loading || filtered.length === 0}
            />
            <ViewSwitcher value={view} onChange={setView} />
          </div>
        }
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
              placeholder="Search title, tagline, place…"
              className="h-8 pl-8 text-sm"
              aria-label="Search campaigns"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger size="sm" className="w-[130px] text-xs" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger size="sm" className="w-[140px] text-xs" aria-label="Filter by category">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

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

          {filterChips.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Clear all filters"
              onClick={() => {
                setSearch("");
                setQuery("");
                setStatus("ALL");
                setCategory("ALL");
              }}
            >
              <X className="size-4" /> Clear all
            </Button>
          ) : null}

          <span
            className="ml-auto text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            {loading ? "Loading…" : `${filtered.length} result${filtered.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {view === "table" ? (
          <DataTable
            columns={campaignColumns}
            rows={paged}
            rowKey={(c) => c.id}
            loading={loading}
            skeletonRows={8}
            height="fill"
            fillOffset={520}
            onRowClick={openView}
            page={safePage}
            pages={pages}
            total={filtered.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={setPageSize}
            itemLabel="campaigns"
            empty={emptyNode}
          >
            {renderCampaignCell}
          </DataTable>
        ) : loading ? (
          <ViewSkeleton view={view} />
        ) : filtered.length === 0 ? (
          emptyNode
        ) : view === "list" ? (
          <ul className="divide-y rounded-xl border bg-card">
            {paged.map((c) => {
              const Icon = ICONS[c.icon] ?? Heart;
              const accent = ACCENTS[c.accent] ?? ACCENTS.emerald;
              const pct = pctOf(c.raisedAmount, c.targetAmount);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openView(c)}
                    aria-label={`Open details for campaign ${c.title}`}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary sm:px-4"
                  >
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", accent.chip)}>
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {c.title}
                        {c.featured && <Star className="ml-1.5 inline size-3.5 fill-amber-400 text-amber-500" aria-label="Featured" />}
                        {c.urgent && <Zap className="ml-1 inline size-3.5 text-red-500" aria-label="Urgent" />}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {titleCase(c.category)}
                        {c.location ? ` · ${c.location}` : ""}
                        {c.endDate ? ` · ends ${formatDate(c.endDate)}` : " · ongoing"}
                      </p>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-sm font-semibold">{formatINRCompact(c.raisedAmount)}</p>
                      <p className="text-[11px] text-muted-foreground">{pct}% of {formatINRCompact(c.targetAmount)}</p>
                    </div>
                    <StatusBadge status={c.status} className="shrink-0" />
                    <div onClick={(e) => e.stopPropagation()}>
                      <RowMenu c={c} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {paged.map((c) => {
              const Icon = ICONS[c.icon] ?? Heart;
              const accent = ACCENTS[c.accent] ?? ACCENTS.emerald;
              const pct = pctOf(c.raisedAmount, c.targetAmount);
              return (
                <article key={c.id} className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", accent.ring)}>
                  <div className="flex items-start gap-3">
                    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", accent.chip)}>
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("size-2 shrink-0 rounded-full", accent.dot)} aria-hidden="true" />
                        <h3 className="truncate text-sm font-semibold leading-tight">{c.title}</h3>
                      </div>
                      {c.slug && <p className="truncate font-mono text-[11px] text-muted-foreground">/{c.slug}</p>}
                    </div>
                    <StatusBadge status={c.status} className="shrink-0" />
                  </div>

                  {c.tagline && <p className="line-clamp-2 text-xs text-muted-foreground">{c.tagline}</p>}

                  <div className="flex flex-wrap items-center gap-1.5">
                    <CampaignFlagBadges featured={Boolean(c.featured)} urgent={Boolean(c.urgent)} />
                    {c.taxEligible !== false && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/10 px-2 py-0.5 text-[11px] font-semibold text-teal-600 dark:text-teal-400">
                        80G
                      </span>
                    )}
                    <DaysLeftChip end={c.endDate} className="ml-auto" />
                  </div>

                  <div className="space-y-1.5">
                    <Progress value={pct} className={accent.bar} aria-label={`${c.title} funding progress: ${pct}%`} />
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold">{formatINR(c.raisedAmount)}</span>
                      <span className="text-muted-foreground">of {formatINR(c.targetAmount)} · {pct}%</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden="true" /> {c.beneficiaries} beneficiaries
                    </span>
                    {c.location && (
                      <span className="flex min-w-0 items-center gap-1">
                        <MapPin className="size-3.5 shrink-0" aria-hidden="true" /> <span className="truncate">{c.location}</span>
                      </span>
                    )}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">{titleCase(c.category)}</span>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t pt-3">
                    <Button size="sm" variant="ghost" onClick={() => openView(c)} aria-label={`View campaign ${c.title}`}>
                      View
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(c)} aria-label={`Edit campaign ${c.title}`}>
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    {quickStatus(c)}
                    <div className="ml-auto" onClick={(e) => e.stopPropagation()}>
                      <RowMenu c={c} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Pagination (grid / list — the DataTable pager covers the table view) */}
        {view !== "table" && !loading && filtered.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PaginationBar
              page={safePage}
              pages={pages}
              total={filtered.length}
              onPage={setPage}
              itemLabel="campaigns"
            />
            <PageSizeSelect value={pageSize} onChange={setPageSize} />
          </div>
        ) : null}
      </SectionCard>

      </TabsContent>

      {/* ============================ ANALYTICS ============================ */}
      <TabsContent value="analytics" className="mt-4 space-y-4">
        {/* KPI strip */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Total campaigns"
            value={(analytics?.campaigns.total ?? 0).toLocaleString("en-IN")}
            hint={`${analytics?.campaigns.active ?? 0} active · ${analytics?.campaigns.completed ?? 0} completed`}
            icon={<Sprout className="size-5" aria-hidden="true" />}
            accent="emerald"
            loading={analyticsLoading}
          />
          <StatCard
            label="Draft / Paused"
            value={`${analytics?.campaigns.draft ?? 0} / ${analytics?.campaigns.paused ?? 0}`}
            hint="Not currently accepting donations"
            icon={<Pause className="size-5" aria-hidden="true" />}
            accent="amber"
            loading={analyticsLoading}
          />
          <StatCard
            label="Cancelled"
            value={(analytics?.campaigns.cancelled ?? 0).toLocaleString("en-IN")}
            hint="Discontinued campaigns"
            icon={<X className="size-5" aria-hidden="true" />}
            accent="red"
            loading={analyticsLoading}
          />
          <StatCard
            label="Featured / Urgent"
            value={`${analytics?.campaigns.featured ?? 0} / ${analytics?.campaigns.urgent ?? 0}`}
            hint="Highlighted on the public site"
            icon={<Star className="size-5" aria-hidden="true" />}
            accent="fuchsia"
            loading={analyticsLoading}
          />
          <StatCard
            label="Total raised"
            value={formatINRCompact(analytics?.campaigns.totalRaised ?? 0)}
            hint={`of ${formatINRCompact(analytics?.campaigns.totalTarget ?? 0)} targeted`}
            icon={<IndianRupee className="size-5" aria-hidden="true" />}
            accent="teal"
            loading={analyticsLoading}
          />
          <StatCard
            label="Overall progress"
            value={`${
              analytics && analytics.campaigns.totalTarget > 0
                ? Math.min(100, Math.round((analytics.campaigns.totalRaised / analytics.campaigns.totalTarget) * 100))
                : 0
            }%`}
            hint="Raised vs. target, all campaigns"
            icon={<TrendingUp className="size-5" aria-hidden="true" />}
            accent="lime"
            loading={analyticsLoading}
          />
          <StatCard
            label="Beneficiaries reached"
            value={(analytics?.reach.beneficiaries ?? 0).toLocaleString("en-IN")}
            hint="Sum of campaign reach"
            icon={<Users className="size-5" aria-hidden="true" />}
            accent="cyan"
            loading={analyticsLoading}
          />
          <StatCard
            label="Volunteers engaged"
            value={(analytics?.reach.volunteersEngaged ?? 0).toLocaleString("en-IN")}
            hint="Across every campaign"
            icon={<HeartHandshake className="size-5" aria-hidden="true" />}
            accent="orange"
            loading={analyticsLoading}
          />
        </div>

        {analyticsLoading ? (
          <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-72 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* category distribution donut */}
            <SectionCard
              title="Category distribution"
              description="Campaigns across the trust, by cause category"
              icon={<Sprout className="size-4" aria-hidden="true" />}
            >
              {categoryChart.length === 0 ? (
                <EmptyState
                  icon={<Sprout className="size-6" aria-hidden="true" />}
                  title="No campaigns yet"
                  hint="Category mix charts here as campaigns are created."
                />
              ) : (
                <>
                  <ChartContainer config={{}} className="aspect-auto h-44 w-full sm:h-56">
                    <PieChart>
                      <Pie
                        data={categoryChart}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="55%"
                        outerRadius="85%"
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {categoryChart.map((c) => (
                          <Cell key={c.name} fill={c.fill} />
                        ))}
                      </Pie>
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value, name, item) => (
                              <span className="flex w-full items-center justify-between gap-4">
                                <span className="text-muted-foreground">{String(name)}</span>
                                <span className="font-mono font-medium tabular-nums">
                                  {Number(value)} campaign{Number(value) === 1 ? "" : "s"}
                                  {item?.payload?.raised ? ` · ${formatINRCompact(Number(item.payload.raised))}` : ""}
                                </span>
                              </span>
                            )}
                          />
                        }
                      />
                    </PieChart>
                  </ChartContainer>
                  <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                    {categoryChart.map((c) => (
                      <li key={c.name} className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: c.fill }}
                        />
                        <span className="truncate">{c.name}</span>
                        <span className="ml-auto font-medium tabular-nums">
                          {c.value} · {formatINRCompact(c.raised)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </SectionCard>

            {/* status breakdown bar */}
            <SectionCard
              title="Lifecycle status"
              description="Draft → active → paused/completed/cancelled"
              icon={<TrendingUp className="size-4" aria-hidden="true" />}
            >
              <ChartContainer config={{}} className="aspect-auto h-44 w-full sm:h-56">
                <BarChart data={statusChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) => (
                          <span className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">{String(name)}</span>
                            <span className="font-mono font-medium tabular-nums">
                              {Number(value)} campaign{Number(value) === 1 ? "" : "s"}
                            </span>
                          </span>
                        )}
                      />
                    }
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
                    {statusChart.map((s) => (
                      <Cell key={s.status} fill={s.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </SectionCard>

            {/* monthly donation inflow attributed to campaigns */}
            <SectionCard
              title="Monthly fundraising inflow"
              description="Donations linked to a campaign, last 12 months"
              icon={<IndianRupee className="size-4" aria-hidden="true" />}
              className="lg:col-span-2"
            >
              {monthlyChart.every((m) => m.amount === 0) ? (
                <EmptyState
                  icon={<IndianRupee className="size-6" aria-hidden="true" />}
                  title="No campaign donations yet"
                  hint="Monthly inflow charts here once donations are linked to campaigns."
                />
              ) : (
                <ChartContainer
                  config={{ amount: { label: "Raised", color: "#10b981" } }}
                  className="aspect-auto h-52 w-full sm:h-64"
                >
                  <BarChart data={monthlyChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={54}
                      tickFormatter={(v: number) => formatINRCompact(v)}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value, name) => (
                            <span className="flex w-full items-center justify-between gap-4">
                              <span className="text-muted-foreground">{String(name)}</span>
                              <span className="font-mono font-medium tabular-nums">{formatINR(Number(value))}</span>
                            </span>
                          )}
                        />
                      }
                    />
                    <Bar dataKey="amount" fill="var(--color-amount)" radius={[6, 6, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ChartContainer>
              )}
            </SectionCard>
          </div>
        )}

        {/* top campaigns by funds raised */}
        <SectionCard
          title="Top campaigns by funds raised"
          description="The five highest-earning fundraising drives"
          icon={<Star className="size-5" aria-hidden="true" />}
        >
          {analyticsLoading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : !analytics || analytics.topCampaigns.length === 0 ? (
            <EmptyState
              icon={<Star className="size-8" aria-hidden="true" />}
              title="No campaigns with funds raised yet"
              hint="The leaderboard appears once donations start coming in."
            />
          ) : (
            <ul className="space-y-2">
              {analytics.topCampaigns.map((c, i) => (
                <li key={c.id} className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{c.title}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Progress value={c.pct} className="h-1.5 flex-1" />
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{c.pct}%</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold">{formatINRCompact(c.raised)}</p>
                    <p className="text-[11px] text-muted-foreground">of {formatINRCompact(c.target)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </TabsContent>
      </Tabs>

      {/* --------------------- Detail sheet (campaign 360) -------------------- */}
      <DetailSheet
        open={!!viewTarget}
        onOpenChange={(o) => !o && setViewTarget(null)}
        eyebrow={viewTarget ? `Campaigns · ${viewTarget.code}` : "Campaigns"}
        title={viewTarget?.title ?? "Campaign"}
        description={
          viewTarget
            ? `${viewTarget.tagline || titleCase(viewTarget.category)} · ${formatINR(viewTarget.raisedAmount)} raised`
            : undefined
        }
        status={
          viewTarget ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={viewTarget.status} />
              <CampaignFlagBadges featured={Boolean(viewTarget.featured)} urgent={Boolean(viewTarget.urgent)} />
            </span>
          ) : undefined
        }
        actions={
          viewTarget ? (
            <>
              <Button size="sm" variant="outline" onClick={() => openEdit(viewTarget)}>
                <Pencil className="size-4" /> Edit
              </Button>
              <RowMenu c={viewTarget} />
            </>
          ) : undefined
        }
        footer={
          viewTarget ? (
            <>
              {quickStatus(viewTarget)}
              {(viewTarget.status === "ACTIVE" || viewTarget.status === "PAUSED") && (
                <Button size="sm" variant="outline" onClick={() => setCompleteTarget(viewTarget)}>
                  <CheckCircle2 className="size-4" /> Complete
                </Button>
              )}
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => setViewTarget(null)}>
                Close
              </Button>
            </>
          ) : undefined
        }
      >
        {viewTarget &&
          (() => {
            const accent = ACCENTS[viewTarget.accent] ?? ACCENTS.emerald;
            const pct = pctOf(viewTarget.raisedAmount, viewTarget.targetAmount);
            const budget = parseBudget(viewTarget.budgetBreakdown);
            const gallery = parseGallery(viewTarget.gallery);
            const budgetSum = budget.reduce((s, b) => s + b.amount, 0);
            return (
              <div className="flex flex-col gap-6">
                <DetailSection
                  title="Funding"
                  description="Live totals are derived from linked donations."
                >
                  <ProgressRing pct={pct} accent={viewTarget.accent} />
                  <div className="mt-3 text-center text-sm">
                    <span className="font-semibold">{formatINR(viewTarget.raisedAmount)}</span>
                    <span className="text-muted-foreground"> raised of {formatINR(viewTarget.targetAmount)} target</span>
                  </div>
                  <div className="mt-4">
                    <DetailGrid cols={2}>
                      <DataField label="Linked donations" value={viewDonationCount === null ? "…" : String(viewDonationCount)} />
                      <DataField label="Minimum donation" value={viewTarget.minDonation != null ? formatINR(viewTarget.minDonation) : "No minimum"} />
                      <DataField label="80G tax eligible" value={viewTarget.taxEligible === false ? "No" : "Yes"} />
                      <DataField label="Category" value={titleCase(viewTarget.category)} />
                      <DataField label="Raised" value={formatINR(viewTarget.raisedAmount)} />
                      <DataField label="Target" value={formatINR(viewTarget.targetAmount)} />
                    </DetailGrid>
                  </div>
                </DetailSection>

                <DetailSection title="Identity" description="How the campaign appears across the site.">
                  <DetailGrid cols={2}>
                    <DataField label="Title" value={viewTarget.title} />
                    <DataField label="URL slug" value={viewTarget.slug} mono />
                    <DataField label="Tagline" value={viewTarget.tagline} className="sm:col-span-2" />
                    <DataField label="Icon" value={titleCase(viewTarget.icon.replace(/-/g, " "))} />
                    <DataField
                      label="Accent colour"
                      value={
                        <span className="flex items-center gap-1.5">
                          <span className={cn("size-2.5 rounded-full", accent.dot)} aria-hidden="true" />
                          {titleCase(viewTarget.accent)}
                        </span>
                      }
                    />
                    <DataField label="Status" value={<StatusBadge status={viewTarget.status} />} />
                    <DataField label="Created by" value={viewTarget.createdBy} />
                  </DetailGrid>
                </DetailSection>

                <DetailSection title="Schedule & place">
                  <DetailGrid cols={2}>
                    <DataField label="Start date" value={formatDate(viewTarget.startDate)} />
                    <DataField label="End date" value={viewTarget.endDate ? formatDate(viewTarget.endDate) : "Ongoing"} />
                    <DataField label="Location" value={viewTarget.location} />
                    <DataField
                      label="Time remaining"
                      value={
                        daysLeft(viewTarget.endDate) === null
                          ? "Ongoing"
                          : daysLeft(viewTarget.endDate)! < 0
                            ? "Ended"
                            : `${daysLeft(viewTarget.endDate)} days left`
                      }
                    />
                  </DetailGrid>
                </DetailSection>

                <DetailSection title="Team & contact">
                  <DetailGrid cols={2}>
                    <DataField label="Coordinator" value={viewTarget.coordinatorName} />
                    <DataField label="Coordinator phone" value={viewTarget.coordinatorPhone} copy />
                    <DataField
                      label="Helpline"
                      value={viewTarget.helpline}
                      icon={<Phone className="size-3" aria-hidden="true" />}
                      copy
                    />
                  </DetailGrid>
                  {viewTarget.helpline && (
                    <a
                      href={`tel:${viewTarget.helpline.replace(/\s+/g, "")}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-primary hover:bg-accent"
                      aria-label={`Call helpline ${viewTarget.helpline}`}
                    >
                      <Phone className="size-4" aria-hidden="true" /> Call {viewTarget.helpline}
                    </a>
                  )}
                </DetailSection>

                <DetailSection title="Reach">
                  <DetailGrid cols={2}>
                    <DataField label="Beneficiaries" value={String(viewTarget.beneficiaries)} />
                    <DataField label="Volunteers engaged" value={String(viewTarget.volunteersEngaged)} />
                  </DetailGrid>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {viewTarget.description}
                  </p>
                </DetailSection>

                {budget.length > 0 && (
                  <DetailSection
                    title="Budget breakdown"
                    description="Line items shown to donors — where the money goes."
                  >
                    <div className="overflow-hidden rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableHead>Head</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="hidden text-right sm:table-cell">Share</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {budget.map((b, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-sm">{b.head || "—"}</TableCell>
                              <TableCell className="text-right text-sm font-medium">{formatINR(b.amount)}</TableCell>
                              <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                                {budgetSum > 0 ? `${Math.round((b.amount / budgetSum) * 100)}%` : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/30">
                            <TableCell className="text-sm font-semibold">Total</TableCell>
                            <TableCell className="text-right text-sm font-semibold">{formatINR(budgetSum)}</TableCell>
                            <TableCell className="hidden text-right text-xs sm:table-cell">
                              {viewTarget.targetAmount > 0
                                ? `${Math.min(999, Math.round((budgetSum / viewTarget.targetAmount) * 100))}% of target`
                                : "—"}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </DetailSection>
                )}

                <DetailSection title="Media & SEO">
                  <DetailGrid cols={2}>
                    <DataField
                      label="Video URL"
                      value={
                        viewTarget.videoUrl ? (
                          <a
                            href={viewTarget.videoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-primary underline underline-offset-2"
                          >
                            {viewTarget.videoUrl}
                          </a>
                        ) : (
                          ""
                        )
                      }
                    />
                    <DataField label="SEO title" value={viewTarget.seoTitle} />
                    <DataField label="SEO description" value={viewTarget.seoDescription} className="sm:col-span-2" />
                  </DetailGrid>
                  {gallery.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {gallery.slice(0, 6).map((g, i) => (
                        <div key={i} className="relative">
                          <img
                            src={g}
                            alt={`${viewTarget.title} gallery image ${i + 1}`}
                            className="aspect-video w-full rounded-lg border object-cover"
                            loading="lazy"
                          />
                          {g === (viewTarget.coverImage ?? gallery[0]) && (
                            <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              <Star className="size-2.5 fill-current" aria-hidden /> Cover
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </DetailSection>

                <DetailSection title="Record">
                  <DetailGrid cols={2}>
                    <DataField label="Campaign ID" value={viewTarget.id} mono copy />
                    <DataField label="Created" value={formatDateTime(viewTarget.createdAt)} />
                    <DataField label="Last updated" value={formatDateTime(viewTarget.updatedAt)} />
                  </DetailGrid>
                </DetailSection>
              </div>
            );
          })()}
      </DetailSheet>

      {/* --------------------------- Create / Edit ---------------------------- */}
      <FormSheet
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        title={editingId ? "Edit campaign" : "New campaign"}
        description={
          editingId
            ? "Raised amount is derived from linked donations and cannot be edited here."
            : "Launch a new fundraising drive for the trust."
        }
        onSubmit={save}
        submitLabel={editingId ? "Save changes" : "Create campaign"}
        loading={saving}
        dirty={dirty}
        size="full"
        footerExtra={
          errorCount + (budgetError ? 1 : 0) > 0 ? (
            <span className="font-medium text-destructive">
              {errorCount + (budgetError ? 1 : 0)} field(s) need attention
            </span>
          ) : null
        }
      >
        <FormSection title="Identity" description="What donors see first on the public page.">
          <FieldGrid>
            <TextField
              label="Title"
              required
              value={form.title}
              onChange={(v) => setForm((f) => ({ ...f, title: v, slug: f.slugTouched ? f.slug : slugify(v) }))}
              placeholder="Green Corridor Initiative"
              error={errors.title}
            />
            <TextField
              label="URL slug"
              value={form.slug}
              onChange={(v) => setForm((f) => ({ ...f, slug: slugify(v), slugTouched: true }))}
              placeholder="green-corridor-initiative"
              hint="Leave blank to auto-generate from the title."
              className="font-mono"
            />
          </FieldGrid>
          <TextField
            label="Tagline"
            value={form.tagline}
            onChange={(v) => setForm((f) => ({ ...f, tagline: v }))}
            placeholder="One line that inspires donors"
          />
          <FieldGrid>
            <SelectField
              label="Category"
              value={form.category}
              onChange={(v) => setForm((f) => ({ ...f, category: v }))}
              options={CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))}
            />
            {editingId ? (
              <SelectField
                label="Status"
                value={form.status}
                onChange={(v) => setForm((f) => ({ ...f, status: v }))}
                options={STATUSES.map((s) => ({ value: s, label: titleCase(s) }))}
              />
            ) : null}
          </FieldGrid>
        </FormSection>

        <FormSection title="Story" description="Tell donors who benefits and why now.">
          <TextareaField
            label="Description"
            required
            rows={5}
            value={form.description}
            onChange={(v) => setForm((f) => ({ ...f, description: v }))}
            placeholder="What does this campaign fund? Who benefits? Why now?"
            error={errors.description}
          />
        </FormSection>

        <FormSection title="Goal & funding" description="Target and donor-facing amount rules.">
          <FieldGrid>
            <TextField
              label="Target amount"
              required
              type="number"
              min="1"
              prefix="₹"
              value={form.targetAmount}
              onChange={(v) => setForm((f) => ({ ...f, targetAmount: v }))}
              placeholder="500000"
              error={errors.targetAmount}
            />
            <TextField
              label="Minimum donation"
              type="number"
              min="1"
              prefix="₹"
              value={form.minDonation}
              onChange={(v) => setForm((f) => ({ ...f, minDonation: v }))}
              placeholder="Optional"
              hint="Smallest amount the donate form accepts."
              error={errors.minDonation}
            />
          </FieldGrid>
        </FormSection>

        <FormSection title="Branding" description="Icon and accent colour used on cards across the app.">
          <FieldGrid>
            <Field label="Icon">
              <Select value={form.icon} onValueChange={(v) => setForm((f) => ({ ...f, icon: v }))}>
                <SelectTrigger aria-label="Campaign icon"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ICON_KEYS.map((k) => {
                    const I = ICONS[k];
                    return (
                      <SelectItem key={k} value={k}>
                        <span className="flex items-center gap-2">
                          <I className="size-3.5" aria-hidden="true" />
                          {titleCase(k.replace(/-/g, " "))}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Accent colour">
              <Select value={form.accent} onValueChange={(v) => setForm((f) => ({ ...f, accent: v }))}>
                <SelectTrigger aria-label="Campaign accent colour"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCENT_KEYS.map((a) => (
                    <SelectItem key={a} value={a}>
                      <span className="flex items-center gap-2">
                        <span className={cn("size-2.5 rounded-full", ACCENTS[a].dot)} aria-hidden="true" />
                        {titleCase(a)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGrid>
        </FormSection>

        <FormSection title="Schedule & place" description="When and where this campaign runs.">
          <FieldGrid>
            <TextField
              label="Start date"
              type="date"
              value={form.startDate}
              onChange={(v) => setForm((f) => ({ ...f, startDate: v }))}
            />
            <TextField
              label="End date"
              type="date"
              value={form.endDate}
              onChange={(v) => setForm((f) => ({ ...f, endDate: v }))}
              hint="Optional — leave blank for an ongoing campaign."
              error={errors.endDate}
            />
          </FieldGrid>
          <TextField
            label="Location"
            value={form.location}
            onChange={(v) => setForm((f) => ({ ...f, location: v }))}
            placeholder="Bengaluru, Karnataka"
          />
        </FormSection>

        <FormSection title="Team & contact" description="Who runs this campaign on the ground.">
          <FieldGrid>
            <TextField
              label="Coordinator name"
              value={form.coordinatorName}
              onChange={(v) => setForm((f) => ({ ...f, coordinatorName: v }))}
              placeholder="Ananya Rao"
            />
            <TextField
              label="Coordinator phone"
              type="tel"
              inputMode="tel"
              value={form.coordinatorPhone}
              onChange={(v) => setForm((f) => ({ ...f, coordinatorPhone: v }))}
              placeholder="9876543210"
              error={errors.coordinatorPhone}
            />
          </FieldGrid>
          <TextField
            label="Helpline"
            value={form.helpline}
            onChange={(v) => setForm((f) => ({ ...f, helpline: v }))}
            placeholder="e.g. 181"
            hint="Shown as a call button on the public campaign page."
          />
        </FormSection>

        <FormSection title="Media & SEO" description="Rich media and search-engine metadata.">
          <TextField
            label="Video URL"
            value={form.videoUrl}
            onChange={(v) => setForm((f) => ({ ...f, videoUrl: v }))}
            placeholder="https://youtube.com/watch?v=…"
            error={errors.videoUrl}
          />
          <Field
            label="Gallery"
            hint="Hover a photo to remove it or set it as the cover. Paste a URL or pick from the library."
          >
            <GalleryEditor
              urls={form.gallery
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)}
              cover={form.coverImage}
              onPickCover={(url) => setForm((f) => ({ ...f, coverImage: url }))}
              onRemove={removeGalleryUrl}
              onAddUrl={addManualUrl}
            />
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <FilePickButton
              size="sm"
              variant="outline"
              label="Add gallery photos"
              multiple
              accept="image/*"
              folder="campaigns"
              onPicked={appendGalleryUrls}
            />
            <FilePickButton
              size="sm"
              variant="outline"
              label="Set cover photo"
              accept="image/*"
              folder="campaigns"
              onPicked={pickCoverUrl}
            />
          </div>
          <FieldGrid>
            <TextField
              label="SEO title"
              value={form.seoTitle}
              onChange={(v) => setForm((f) => ({ ...f, seoTitle: v }))}
              placeholder="Falls back to the campaign title"
            />
          </FieldGrid>
          <TextareaField
            label="SEO description"
            rows={2}
            value={form.seoDescription}
            onChange={(v) => setForm((f) => ({ ...f, seoDescription: v }))}
            placeholder="Short summary for search results (≤160 chars works best)"
          />
        </FormSection>

        <FormSection title="Budget breakdown" description="Optional line items shown to donors — where the money goes.">
          {form.budget.length > 0 && (
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground" aria-hidden="true">
              <span className="flex-1">Head</span>
              <span className="w-36">Amount</span>
              <span className="w-11 md:w-9" />
            </div>
          )}
          <div className="space-y-2">
            {form.budget.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={row.head}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      budget: f.budget.map((r, j) => (j === i ? { ...r, head: e.target.value } : r)),
                    }))
                  }
                  placeholder="Ration kits"
                  aria-label={`Budget head ${i + 1}`}
                  className="flex-1"
                />
                <div className="relative w-36 shrink-0">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                  <Input
                    type="number"
                    min={0}
                    value={row.amount}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        budget: f.budget.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)),
                      }))
                    }
                    placeholder="120000"
                    aria-label={`Budget amount ${i + 1}`}
                    className="pl-8"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 text-muted-foreground hover:text-red-600 md:size-9"
                  aria-label={`Remove budget row ${i + 1}`}
                  onClick={() => setForm((f) => ({ ...f, budget: f.budget.filter((_, j) => j !== i) }))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setForm((f) => ({ ...f, budget: [...f.budget, { head: "", amount: "" }] }))}
            >
              <Plus className="size-4" /> Add head
            </Button>
          </div>
          {(budgetTotal > 0 || budgetError) && (
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
              <span className="font-semibold">Allocated: {formatINR(budgetTotal)}</span>
              <span className="text-muted-foreground"> · Target: {formatINR(Number(form.targetAmount) || 0)}</span>
              {budgetTotal > 0 && Number(form.targetAmount) > 0 && (
                <span
                  className={cn(
                    "ml-1 font-medium",
                    budgetTotal > Number(form.targetAmount)
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  ({Math.round((budgetTotal / Number(form.targetAmount)) * 100)}%
                  {budgetTotal > Number(form.targetAmount) ? " — exceeds target" : " of target"})
                </span>
              )}
              {budgetError && (
                <p className="mt-1 font-medium text-destructive" role="alert">{budgetError}</p>
              )}
            </div>
          )}
        </FormSection>

        <FormSection title="Settings & visibility" description="Donor-facing flags and receipt eligibility.">
          <div className="grid gap-3 sm:grid-cols-3">
            <SwitchField
              label="80G tax eligible"
              hint="Donors get tax receipts"
              checked={form.taxEligible}
              onChange={(v) => setForm((f) => ({ ...f, taxEligible: v }))}
            />
            <SwitchField
              label="Feature on home page"
              hint="Highlighted on the public site"
              checked={form.featured}
              onChange={(v) => setForm((f) => ({ ...f, featured: v }))}
            />
            <SwitchField
              label="Mark as urgent"
              hint="Shows an urgent appeal banner on the public site"
              checked={form.urgent}
              onChange={(v) => setForm((f) => ({ ...f, urgent: v }))}
            />
          </div>
        </FormSection>
      </FormSheet>

      {/* ------------------------------- confirms ----------------------------- */}
      <ConfirmDialog
        open={!!completeTarget}
        onOpenChange={(o) => !o && setCompleteTarget(null)}
        title="Mark campaign as completed?"
        recordName={
          completeTarget ? `${completeTarget.title} · ${formatINR(completeTarget.raisedAmount)} raised` : null
        }
        description="Completed campaigns stop accepting new donations on the public site. You can re-activate the campaign later if needed."
        confirmLabel="Complete campaign"
        loading={busyId === completeTarget?.id}
        onConfirm={() => {
          if (completeTarget) void setStatusFor(completeTarget, "COMPLETED");
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete campaign?"
        recordName={
          deleteTarget ? `${deleteTarget.title} · ${formatINRCompact(deleteTarget.raisedAmount)} raised` : null
        }
        description="The campaign and its links will be permanently removed. Donations keep their receipts but become uncategorised. This cannot be undone."
        loading={saving}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard unsaved changes?"
        description="Your edits to this campaign haven't been saved yet. Closing now will lose them."
        confirmLabel="Discard"
        onConfirm={() => {
          setFormOpen(false);
          setConfirmDiscard(false);
        }}
      />
    </div>
  );
}
