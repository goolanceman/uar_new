"use client";

/**
 * Volunteers — wave-6 rework. Six tabs:
 *
 *  1. Applications  — search + status filters, DataTable, DetailSheet with every
 *     application field, approve (temp-creds reveal) / reject flow, CSV export.
 *  2. Volunteers    — roster with table/grid ViewSwitcher, DetailSheet with
 *     internal tabs (Overview / Tasks / Attendance / Activity), edit FormSheet,
 *     "Assign to…" and "Log attendance" quick actions, CSV export.
 *  3. Tasks         — global task board: filters (status/type/volunteer),
 *     linked-record + AUTO badges, status advance, manual "Add task" FormSheet.
 *  4. Assignments   — record-first "Assign volunteers" panel: pick a
 *     distribution / campaign / event, tick one or many volunteers, set
 *     date/priority/notes → POST /api/volunteer-assignments (one AUTO task per
 *     volunteer); below it, the existing assignments for the chosen record
 *     (GET /api/volunteer-assignments?refType=&refId=).
 *  5. Attendance    — global attendance register with upsert FormSheet.
 *  6. Analytics     — KPI StatCards + Recharts (tasks by type, status donut,
 *     top-5 leaderboard, 6-month hours trend) from GET /api/volunteers?analytics=1.
 *
 * Assignments flow through POST /api/volunteer-assignments (auto-generates one
 * VolunteerTask per volunteer, createdFrom AUTO).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Archive,
  BadgeCheck,
  Ban,
  CalendarClock,
  CalendarDays,
  Check,
  ClipboardList,
  Clock,
  HeartHandshake,
  Info,
  KeyRound,
  Link2,
  MapPin,
  Megaphone,
  MoreHorizontal,
  Package,
  PawPrint,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Siren,
  Sparkles,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { get, patch, post } from "@/lib/api-client";
import { taskTransitions as taskTransitionsLib } from "@/lib/volunteer-tasks";
import { useMasters } from "@/hooks/use-masters";
import { formatDate, formatDateTime, initials, titleCase } from "@/lib/format";
import { timeAgo, cn } from "@/lib/utils";
import { humanize, StatusBadge, type Tone } from "@/components/shared/status-badge";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import {
  FieldGrid,
  FormSection,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { useViewPref, ViewSwitcher } from "@/components/shared/view-switcher";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ════════════════════════════════ types ════════════════════════════════ */

interface Application {
  id: string;
  userId?: string | null;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  occupation?: string | null;
  skills?: string | null;
  availability?: string | null;
  motivation: string;
  status: string;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  tempCreds?: string | null;
  createdAt: string;
  /**
   * Legacy application fields — restored on the backend (Agent 3). Every one is
   * optional: pre-merge backends and older records omit them, and this view
   * must render gracefully either way. Never assume they exist.
   */
  customSkills?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  serviceAreas?: string | null; // JSON list string
  willingToTravel?: boolean | string | number | null;
  maxTravelDistance?: number | string | null;
  remoteVolunteering?: boolean | string | number | null;
  isFlexible?: boolean | string | number | null;
  priorExperience?: string | null;
  emergencyContact?: string | null;
  emergencyPhone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
}

interface TempCreds {
  email?: string;
  password?: string;
  fullName?: string;
}

interface VolunteerRow {
  id: string;
  code: string;
  userId: string;
  skills?: string | null;
  availability?: string | null;
  assignedArea?: string | null;
  emergencyContact?: string | null;
  idProof?: string | null;
  status: string;
  joinedAt: string;
  user?: {
    name?: string;
    email?: string;
    phone?: string;
    city?: string;
    status?: string;
  } | null;
}

interface TaskRow {
  id: string;
  volunteerId: string;
  title: string;
  description?: string | null;
  type: string;
  priority: string;
  status: string;
  location?: string | null;
  scheduledDate: string;
  notes?: string | null;
  refType?: string | null;
  refId?: string | null;
  createdFrom?: string;
  completedAt?: string | null;
  volunteer?: {
    id: string;
    assignedArea?: string | null;
    user?: { name?: string } | null;
  };
}

interface AttendanceRow {
  id: string;
  volunteerId: string;
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  hours?: number | null;
  location?: string | null;
  notes?: string | null;
  volunteer?: {
    id: string;
    assignedArea?: string | null;
    user?: { name?: string } | null;
  };
}

interface VolunteerDetail extends VolunteerRow {
  tasks?: TaskRow[];
  attendances?: AttendanceRow[];
  stats?: {
    tasksAssigned: number;
    tasksCompleted: number;
    daysPresent: number;
    totalHours: number;
  };
}

interface ActivityLogRow {
  id: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: string | null;
  actorName?: string | null;
  createdAt: string;
}

interface AnalyticsData {
  kpis: {
    totalVolunteers: number;
    activeVolunteers: number;
    pendingApplications: number;
    tasksAssigned: number;
    tasksCompleted: number;
    completionRate: number;
    hoursThisMonth: number;
  };
  tasksByType: Array<{ type: string; count: number }>;
  taskStatus: Array<{ status: string; count: number }>;
  leaderboard: Array<{ volunteerId: string; name: string; assigned: number; completed: number }>;
  monthlyHours: Array<{ key: string; label: string; hours: number }>;
}

interface DistributionLite {
  id: string;
  type: string;
  quantity: number;
  location?: string | null;
  distributedAt: string;
  beneficiary?: { name?: string } | null;
}

interface CampaignLite {
  id: string;
  title: string;
  status: string;
}

interface RecordOption {
  id: string;
  label: string;
  sub?: string;
}

type RuleErr = Record<string, string | undefined>;

/* ═══════════════════════════ constants & helpers ═══════════════════════ */

const VOL_STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "SUSPENDED", label: "Suspended" },
];

const PRIORITY_OPTIONS = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

const PRIORITY_TONE: Record<string, Tone> = {
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};

const APP_FILTERS = ["PENDING", "APPROVED", "REJECTED", "ALL"];
const VOL_FILTERS = ["ALL", "PENDING", "ACTIVE", "INACTIVE", "SUSPENDED"];
const TASK_STATUS_FILTERS = ["ALL", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

const TASK_TYPE_META: Record<
  string,
  { label: string; cls: string; icon: React.ElementType }
> = {
  DISTRIBUTION: {
    label: "Distribution",
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    icon: Package,
  },
  KIT_SCAN: {
    label: "Kit scanning",
    cls: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
    icon: Sparkles,
  },
  INVENTORY: {
    label: "Inventory",
    cls: "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-400",
    icon: Archive,
  },
  EVENT: {
    label: "Awareness event",
    cls: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
    icon: CalendarDays,
  },
  RESCUE: {
    label: "Animal rescue",
    cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    icon: PawPrint,
  },
  AMBULANCE: {
    label: "Ambulance",
    cls: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
    icon: Siren,
  },
};

const REF_TYPE_META: Record<string, { label: string; icon: React.ElementType }> = {
  DISTRIBUTION: { label: "Distribution", icon: Package },
  CAMPAIGN: { label: "Campaign", icon: Megaphone },
  EVENT: { label: "Event", icon: CalendarDays },
  MISSION: { label: "Mission", icon: Siren },
};

const LINK_TYPE_OPTIONS = [
  { value: "DISTRIBUTION", label: "Distribution drive" },
  { value: "CAMPAIGN", label: "Campaign" },
  { value: "EVENT", label: "Awareness event" },
];

const STATUS_COLORS: Record<string, string> = {
  ASSIGNED: "#f59e0b",
  IN_PROGRESS: "#14b8a6",
  COMPLETED: "#10b981",
  CANCELLED: "#f43f5e",
};

function parseList(s?: string | null): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // plain comma-separated string
  }
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseTempCreds(s?: string | null): TempCreds | null {
  if (!s) return null;
  try {
    const parsed = JSON.parse(s) as TempCreds;
    if (parsed && (parsed.email || parsed.password)) return parsed;
  } catch {
    // not JSON
  }
  return null;
}

/* Legacy volunteer-application helpers — tolerant of boolean-as-string/column
 * shapes the backend may emit while the restored fields settle. */

function isTruthyFlag(v: unknown): boolean {
  return v === true || v === 1 || v === "1" ||
    (typeof v === "string" && ["true", "yes", "y"].includes(v.trim().toLowerCase()));
}

function flagText(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  return isTruthyFlag(v) ? "Yes" : "No";
}

function geoText(a: Pick<Application, "latitude" | "longitude">): string | null {
  const lat = a.latitude;
  const lng = a.longitude;
  if (lat === undefined || lat === null || lat === "") return null;
  if (lng === undefined || lng === null || lng === "") return null;
  const s = `${lat}, ${lng}`;
  return s.trim() === "," || s.includes("NaN") ? null : s;
}

function hasLegacyAddress(a: Application): boolean {
  return !!(
    a.addressLine1 ||
    a.addressLine2 ||
    a.state ||
    a.country ||
    a.postalCode ||
    geoText(a)
  );
}

function hasLegacyContact(a: Application): boolean {
  return !!(a.emergencyContact || a.emergencyPhone);
}

function hasLegacyPreferences(a: Application): boolean {
  return !!(
    flagText(a.willingToTravel) ||
    (a.maxTravelDistance !== undefined && a.maxTravelDistance !== null && a.maxTravelDistance !== "") ||
    flagText(a.remoteVolunteering) ||
    flagText(a.isFlexible) ||
    parseList(a.serviceAreas).length > 0
  );
}

function hasLegacyExperience(a: Application): boolean {
  return !!(a.priorExperience || parseList(a.customSkills).length > 0);
}

/** Client-side extra filters over the restored legacy fields. */
const APP_EXTRA_FILTERS = [
  { value: "ANY", label: "All applications" },
  { value: "TRAVEL", label: "Willing to travel" },
  { value: "REMOTE", label: "Remote-ready" },
  { value: "FLEXIBLE", label: "Flexible availability" },
  { value: "EMERGENCY", label: "Has emergency contact" },
  { value: "ADDRESS", label: "Has address / location" },
] as const;

function matchesExtraFilter(a: Application, f: string): boolean {
  switch (f) {
    case "TRAVEL":
      return isTruthyFlag(a.willingToTravel);
    case "REMOTE":
      return isTruthyFlag(a.remoteVolunteering);
    case "FLEXIBLE":
      return isTruthyFlag(a.isFlexible);
    case "EMERGENCY":
      return hasLegacyContact(a);
    case "ADDRESS":
      return hasLegacyAddress(a);
    default:
      return true;
  }
}

/** Full-text search across the profile fields INCLUDING the legacy ones. */
function matchesApplicationQuery(a: Application, q: string): boolean {
  const hay = [
    a.fullName,
    a.email,
    a.phone,
    a.city,
    a.occupation,
    a.skills,
    a.availability,
    a.motivation,
    a.customSkills,
    a.serviceAreas,
    a.priorExperience,
    a.addressLine1,
    a.addressLine2,
    a.state,
    a.country,
    a.postalCode,
    a.emergencyContact,
    a.emergencyPhone,
    a.reviewNote,
  ]
    .map((x) => (x ?? "").toString().toLowerCase())
    .join(" ");
  return hay.includes(q);
}

function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayIso(): string {
  return dateValue(new Date());
}

function addDaysIso(days: number): string {
  return dateValue(new Date(Date.now() + days * 86_400_000));
}

function dateOnly(iso?: string | null): string {
  if (!iso) return todayIso();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? todayIso() : dateValue(d);
}

function timeOnly(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function collectErrors(...pairs: Array<[string, string | null]>): RuleErr | null {
  const out: RuleErr = {};
  let any = false;
  for (const [key, err] of pairs) {
    if (err) {
      out[key] = err;
      any = true;
    }
  }
  return any ? out : null;
}

function typeChip(t: string) {
  const meta = TASK_TYPE_META[t] ?? {
    label: titleCase(t) || "Task",
    cls: "border-border bg-muted/40 text-muted-foreground",
    icon: ClipboardList,
  };
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 whitespace-nowrap font-medium", meta.cls)}
    >
      <Icon className="size-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

function priorityBadge(p: string) {
  return (
    <StatusBadge tone={PRIORITY_TONE[p] ?? "neutral"}>
      {titleCase(p) || "—"}
    </StatusBadge>
  );
}

function autoBadge(createdFrom?: string | null) {
  if (createdFrom !== "AUTO") return null;
  return (
    <Badge
      variant="outline"
      className="border-teal-500/30 bg-teal-500/10 px-1.5 text-[10px] font-bold tracking-wider text-teal-700 dark:text-teal-400"
    >
      AUTO
    </Badge>
  );
}

function refCell(t: TaskRow) {
  if (!t.refType)
    return <span className="text-xs text-muted-foreground">—</span>;
  const meta = REF_TYPE_META[t.refType] ?? {
    label: titleCase(t.refType),
    icon: Link2,
  };
  const Icon = meta.icon;
  return (
    <span className="flex items-center gap-1.5">
      <Badge
        variant="outline"
        className="gap-1 border-border bg-muted/40 font-medium text-muted-foreground"
      >
        <Icon className="size-3" aria-hidden="true" />
        {meta.label}
      </Badge>
      {t.refId ? (
        <span
          className="hidden font-mono text-[10px] text-muted-foreground/80 lg:inline"
          title={t.refId}
        >
          …{t.refId.slice(-6)}
        </span>
      ) : null}
      {autoBadge(t.createdFrom)}
    </span>
  );
}

/**
 * Allowed status moves for a task, in workflow order — labels come from the
 * shared machine in @/lib/volunteer-tasks (same table PATCH /api/volunteer-tasks/:id
 * enforces); this view only attaches the icons.
 */
const TASK_MOVE_ICONS: Record<string, React.ElementType> = {
  IN_PROGRESS: Play,
  COMPLETED: Check,
  CANCELLED: Ban,
};
function taskTransitions(status: string): Array<{ label: string; status: string; icon: React.ElementType }> {
  return taskTransitionsLib(status).map((m) => ({ ...m, icon: TASK_MOVE_ICONS[m.status] }));
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:text-teal-400">
      {children}
    </span>
  );
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-bold leading-tight tabular-nums">
        {value ?? "—"}
      </p>
    </div>
  );
}

/* ═══════════════════════════════ main view ═════════════════════════════ */

export default function VolunteersView() {
  const [tab, setTab] = useState("applications");
  const [revision, setRevision] = useState(0);
  const [volunteerDetailId, setVolunteerDetailId] = useState<string | null>(null);

  const notifyChange = useCallback(() => setRevision((r) => r + 1), []);
  const openVolunteer = useCallback((id: string) => setVolunteerDetailId(id), []);

  /* module-wide KPIs power the tab badges + the Analytics tab */
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    get<AnalyticsData>("/api/volunteers?analytics=1")
      .then((d) => {
        if (alive) setAnalytics(d);
      })
      .catch(() => {
        // analytics are decorative — stay silent
      })
      .finally(() => {
        if (alive) setAnalyticsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [revision]);

  const kpis = analytics?.kpis;

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Volunteers"
        description="Applications, the active roster, task assignment, attendance and engagement analytics."
        icon={<HeartHandshake className="size-5" aria-hidden="true" />}
        actions={
          <Button
            variant="outline"
            onClick={() => setRevision((r) => r + 1)}
            aria-label="Refresh volunteers module"
          >
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap sm:w-auto">
          <TabsTrigger value="applications">
            Applications
            <Badge variant="outline" className="ml-1.5 px-1.5 tabular-nums">
              {analyticsLoading ? "…" : (kpis?.pendingApplications ?? 0)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="volunteers">
            Volunteers
            <Badge variant="outline" className="ml-1.5 px-1.5 tabular-nums">
              {analyticsLoading ? "…" : (kpis?.totalVolunteers ?? 0)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="tasks">
            Tasks
            <Badge variant="outline" className="ml-1.5 px-1.5 tabular-nums">
              {analyticsLoading ? "…" : (kpis?.tasksAssigned ?? 0)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="applications" className="mt-4">
          <ApplicationsTab revision={revision} onChanged={notifyChange} />
        </TabsContent>
        <TabsContent value="volunteers" className="mt-4">
          <VolunteersTab
            revision={revision}
            onChanged={notifyChange}
            openVolunteer={openVolunteer}
          />
        </TabsContent>
        <TabsContent value="tasks" className="mt-4">
          <TasksTab
            revision={revision}
            onChanged={notifyChange}
            openVolunteer={openVolunteer}
          />
        </TabsContent>
        <TabsContent value="assignments" className="mt-4">
          <AssignmentsTab
            revision={revision}
            onChanged={notifyChange}
            openVolunteer={openVolunteer}
          />
        </TabsContent>
        <TabsContent value="attendance" className="mt-4">
          <AttendanceTab revision={revision} onChanged={notifyChange} />
        </TabsContent>
        <TabsContent value="analytics" className="mt-4">
          <AnalyticsTab data={analytics} loading={analyticsLoading} />
        </TabsContent>
      </Tabs>

      <VolunteerDetailSheet
        volunteerId={volunteerDetailId}
        open={!!volunteerDetailId}
        onOpenChange={(o) => {
          if (!o) setVolunteerDetailId(null);
        }}
        onChanged={notifyChange}
      />
    </div>
  );
}

/* ═══════════════════════════ APPLICATIONS TAB ═══════════════════════════ */

function ApplicationsTab({
  revision,
  onChanged,
}: {
  revision: number;
  onChanged: () => void;
}) {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("PENDING");
  const [extraFilter, setExtraFilter] = useState("ANY");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [detail, setDetail] = useState<Application | null>(null);

  /* approve flow: FormSheet (note) → ConfirmDialog → temp creds reveal */
  const [approveTarget, setApproveTarget] = useState<Application | null>(null);
  const [approvePending, setApprovePending] = useState<Application | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const [approving, setApproving] = useState(false);
  const [approvedCreds, setApprovedCreds] = useState<TempCreds | null>(null);

  /* reject flow: FormSheet (reason) → ConfirmDialog */
  const [rejectTarget, setRejectTarget] = useState<Application | null>(null);
  const [rejectPending, setRejectPending] = useState<Application | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Search runs fully client-side (over the profile AND the restored legacy
      // fields) so the server's name/email/city-only `q` filter never hides a
      // legacy-field match. The list is unpaginated upstream, so this is cheap.
      const sp = new URLSearchParams();
      if (filter !== "ALL") sp.set("status", filter);
      const data = await get<Application[] | { items?: Application[] }>(
        `/api/volunteer-applications?${sp.toString()}`
      );
      const list = (Array.isArray(data) ? data : (data.items ?? [])).slice();
      list.sort((a, b) => {
        const rank = (s: string) => (s === "PENDING" ? 0 : 1);
        if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      setApps(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load, revision]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setAppliedQuery(query);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  /* client-side: legacy-field search + restored-field filters */
  const visible = useMemo(() => {
    const q = appliedQuery.trim().toLowerCase();
    return apps.filter(
      (a) => matchesExtraFilter(a, extraFilter) && (!q || matchesApplicationQuery(a, q))
    );
  }, [apps, appliedQuery, extraFilter]);

  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const pageSafe = Math.min(page, pages);
  const paged = useMemo(
    () => visible.slice((pageSafe - 1) * pageSize, pageSafe * pageSize),
    [visible, pageSafe, pageSize]
  );

  const runApprove = async () => {
    if (!approvePending?.id) return;
    setApproving(true);
    try {
      const res = await patch<{ application?: Application }>(
        `/api/volunteer-applications/${approvePending.id}`,
        { status: "APPROVED", reviewNote: approveNote.trim() || undefined }
      );
      const creds = parseTempCreds(
        res?.application?.tempCreds ?? approvePending.tempCreds
      );
      toast.success("Volunteer approved — roster updated");
      setApprovedCreds(creds);
      setApprovePending(null);
      setApproveTarget(null);
      setApproveNote("");
      setDetail(null);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve application");
    } finally {
      setApproving(false);
    }
  };

  const runReject = async () => {
    if (!rejectPending?.id) return;
    setRejecting(true);
    try {
      await patch(`/api/volunteer-applications/${rejectPending.id}`, {
        status: "REJECTED",
        reviewNote: rejectNote.trim() || undefined,
      });
      toast.success("Application rejected");
      setRejectPending(null);
      setRejectTarget(null);
      setRejectNote("");
      setDetail(null);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reject application");
    } finally {
      setRejecting(false);
    }
  };

  const busy = approving || rejecting;

  const appCsv: CsvColumn<Application>[] = useMemo(
    () => [
      { header: "Name", value: (a) => a.fullName },
      { header: "Email", value: (a) => a.email },
      { header: "Phone", value: (a) => a.phone },
      { header: "City", value: (a) => a.city },
      { header: "State", value: (a) => a.state ?? "" },
      { header: "Country", value: (a) => a.country ?? "" },
      { header: "PIN code", value: (a) => a.postalCode ?? "" },
      { header: "Address", value: (a) => [a.addressLine1, a.addressLine2].filter(Boolean).join(", ") },
      { header: "Geo", value: (a) => geoText(a) ?? "" },
      { header: "Emergency contact", value: (a) => a.emergencyContact ?? "" },
      { header: "Emergency phone", value: (a) => a.emergencyPhone ?? "" },
      { header: "Willing to travel", value: (a) => flagText(a.willingToTravel) ?? "" },
      { header: "Max travel distance", value: (a) => a.maxTravelDistance ?? "" },
      { header: "Remote volunteering", value: (a) => flagText(a.remoteVolunteering) ?? "" },
      { header: "Flexible availability", value: (a) => flagText(a.isFlexible) ?? "" },
      { header: "Service areas", value: (a) => parseList(a.serviceAreas).join("; ") },
      { header: "Custom skills", value: (a) => parseList(a.customSkills).join("; ") },
      { header: "Prior experience", value: (a) => a.priorExperience ?? "" },
      { header: "Occupation", value: (a) => a.occupation ?? "" },
      { header: "Skills", value: (a) => parseList(a.skills).join("; ") },
      { header: "Availability", value: (a) => parseList(a.availability).join("; ") },
      { header: "Status", value: (a) => a.status },
      { header: "Applied", value: (a) => formatDate(a.createdAt) },
      { header: "Motivation", value: (a) => a.motivation },
      { header: "Review note", value: (a) => a.reviewNote ?? "" },
      { header: "Reviewed at", value: (a) => (a.reviewedAt ? formatDate(a.reviewedAt) : "") },
    ],
    []
  );

  const columns: DataTableColumn<Application>[] = [
    {
      key: "name",
      header: "Applicant",
      accessor: (a) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initials(a.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{a.fullName}</p>
            {a.occupation ? (
              <p className="truncate text-xs text-muted-foreground">{a.occupation}</p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      hideBelow: "md",
      accessor: (a) => (
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{a.email}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{a.phone}</p>
        </div>
      ),
    },
    {
      key: "city",
      header: "City",
      hideBelow: "sm",
      accessor: (a) => <span className="text-sm">{a.city || "—"}</span>,
    },
    {
      key: "skills",
      header: "Skills",
      hideBelow: "lg",
      accessor: (a) => {
        const skills = parseList(a.skills);
        if (skills.length === 0)
          return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="flex max-w-56 flex-wrap gap-1">
            {skills.slice(0, 3).map((s) => (
              <Chip key={s}>{titleCase(s)}</Chip>
            ))}
            {skills.length > 3 ? <Chip>+{skills.length - 3}</Chip> : null}
          </div>
        );
      },
    },
    {
      key: "availability",
      header: "Availability",
      hideBelow: "lg",
      accessor: (a) => {
        const list = parseList(a.availability);
        return (
          <span className="text-xs text-muted-foreground">
            {list.length ? list.map((s) => titleCase(s)).join(" · ") : "—"}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      accessor: (a) => <StatusBadge status={a.status} />,
    },
    {
      key: "applied",
      header: "Applied",
      hideBelow: "md",
      accessor: (a) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(a.createdAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "w-12",
      accessor: (a) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Actions for application from ${a.fullName}`}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setDetail(a)}>
                <Info className="size-4" aria-hidden="true" /> View details
              </DropdownMenuItem>
              {a.status === "PENDING" ? (
                <>
                  <DropdownMenuItem
                    onClick={() => {
                      setApproveTarget(a);
                      setApproveNote("");
                    }}
                  >
                    <Check className="size-4" aria-hidden="true" /> Approve
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                    onClick={() => {
                      setRejectTarget(a);
                      setRejectNote("");
                    }}
                  >
                    <X className="size-4" aria-hidden="true" /> Reject
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, city…"
            aria-label="Search applications"
            className="pl-8"
          />
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter applications by status"
        >
          {APP_FILTERS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={filter === t}
              onClick={() => {
                setFilter(t);
                setPage(1);
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                filter === t
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-accent"
              )}
            >
              {titleCase(t)}
            </button>
          ))}
        </div>

        <select
          aria-label="Filter by legacy application fields"
          value={extraFilter}
          onChange={(e) => {
            setExtraFilter(e.target.value);
            setPage(1);
          }}
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
        >
          {APP_EXTRA_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${visible.length} application${visible.length === 1 ? "" : "s"}`}
        </span>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ExportMenu
            columns={appCsv}
            rows={visible}
            filename="uar-volunteer-applications"
            disabled={visible.length === 0}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={paged}
        rowKey={(a) => a.id}
        loading={loading}
        skeletonRows={6}
        height="fill"
        fillOffset={340}
        onRowClick={(a) => setDetail(a)}
        page={pageSafe}
        pages={pages}
        total={visible.length}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        itemLabel="applications"
        empty={
          <EmptyState
            icon={<UserPlus className="size-8" aria-hidden="true" />}
            title={
              appliedQuery.trim() || filter !== "PENDING" || extraFilter !== "ANY"
                ? "No applications match these filters"
                : "No pending applications"
            }
            hint="Volunteer sign-ups from the public site land here for review — approve to activate their portal account and add them to the roster."
          />
        }
      />

      {/* ============================ DETAIL SHEET ============================ */}
      <DetailSheet
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        eyebrow="Volunteer applications"
        title={detail?.fullName ?? ""}
        description={
          detail ? `${detail.email} · ${detail.phone}${detail.city ? ` · ${detail.city}` : ""}` : undefined
        }
        status={detail ? <StatusBadge status={detail.status} /> : null}
        footer={
          detail && detail.status === "PENDING" ? (
            <>
              <p className="text-xs text-muted-foreground">
                Applied {formatDateTime(detail.createdAt)}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setApproveTarget(detail);
                    setApproveNote("");
                  }}
                >
                  <Check className="size-3.5" aria-hidden="true" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  onClick={() => {
                    setRejectTarget(detail);
                    setRejectNote("");
                  }}
                >
                  <X className="size-3.5" aria-hidden="true" /> Reject
                </Button>
              </div>
            </>
          ) : null
        }
      >
        {detail ? (
          <>
            <DetailSection title="Applicant profile" description="Who wants to join the crew.">
              <DetailGrid cols={3}>
                <DataField label="Full name" value={detail.fullName} />
                <DataField label="Email" value={detail.email} />
                <DataField label="Phone" value={detail.phone} mono />
                <DataField label="City" value={detail.city} icon={<MapPin className="size-3" aria-hidden="true" />} />
                <DataField label="Occupation" value={detail.occupation ?? null} />
                <DataField
                  label="Applied on"
                  value={formatDateTime(detail.createdAt)}
                  icon={<CalendarClock className="size-3" aria-hidden="true" />}
                />
              </DetailGrid>
            </DetailSection>

            <DetailSection title="Skills & availability" description="Self-reported from the application form.">
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Skills
                  </p>
                  {parseList(detail.skills).length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {parseList(detail.skills).map((s) => (
                        <Chip key={s}>{titleCase(s)}</Chip>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">None listed.</p>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Availability
                  </p>
                  {parseList(detail.availability).length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {parseList(detail.availability).map((s) => (
                        <Chip key={s}>{titleCase(s)}</Chip>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not specified.</p>
                  )}
                </div>
              </div>
            </DetailSection>

            {/* Legacy (restored) fields — each section renders only when the
                backend actually returns the corresponding data. */}
            {hasLegacyAddress(detail) ? (
              <DetailSection
                title="Address & location"
                description="Restored legacy application fields."
              >
                <DetailGrid cols={3}>
                  <DataField label="Address line 1" value={detail.addressLine1 ?? null} />
                  <DataField label="Address line 2" value={detail.addressLine2 ?? null} />
                  <DataField label="State" value={detail.state ?? null} />
                  <DataField label="Country" value={detail.country ?? null} />
                  <DataField label="PIN code" value={detail.postalCode ?? null} mono />
                  <DataField label="Geo coordinates" value={geoText(detail)} mono />
                </DetailGrid>
              </DetailSection>
            ) : null}

            {hasLegacyContact(detail) ? (
              <DetailSection
                title="Emergency contact"
                description="Who to call if something happens on ground."
              >
                <DetailGrid cols={2}>
                  <DataField label="Emergency contact" value={detail.emergencyContact ?? null} />
                  <DataField
                    label="Emergency phone"
                    value={detail.emergencyPhone ?? null}
                    mono
                  />
                </DetailGrid>
              </DetailSection>
            ) : null}

            {hasLegacyPreferences(detail) ? (
              <DetailSection
                title="Travel & work preferences"
                description="Logistics the coordinator should plan around."
              >
                <DetailGrid cols={3}>
                  <DataField label="Willing to travel" value={flagText(detail.willingToTravel)} />
                  <DataField
                    label="Max travel distance"
                    value={
                      detail.maxTravelDistance !== undefined &&
                      detail.maxTravelDistance !== null &&
                      detail.maxTravelDistance !== ""
                        ? `${detail.maxTravelDistance} km`
                        : null
                    }
                  />
                  <DataField
                    label="Remote volunteering"
                    value={flagText(detail.remoteVolunteering)}
                  />
                  <DataField label="Flexible availability" value={flagText(detail.isFlexible)} />
                </DetailGrid>
                {parseList(detail.serviceAreas).length ? (
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Service areas
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {parseList(detail.serviceAreas).map((s) => (
                        <Chip key={s}>{titleCase(s)}</Chip>
                      ))}
                    </div>
                  </div>
                ) : null}
              </DetailSection>
            ) : null}

            {hasLegacyExperience(detail) ? (
              <DetailSection
                title="Experience & custom skills"
                description="Free-text background beyond the standard skill checklist."
              >
                {detail.priorExperience ? (
                  <p className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm leading-relaxed">
                    {detail.priorExperience}
                  </p>
                ) : null}
                {parseList(detail.customSkills).length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {parseList(detail.customSkills).map((s) => (
                      <Chip key={s}>{titleCase(s)}</Chip>
                    ))}
                  </div>
                ) : null}
              </DetailSection>
            ) : null}

            <DetailSection title="Motivation">
              <p className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm leading-relaxed">
                {detail.motivation}
              </p>
            </DetailSection>

            <DetailSection title="Review">
              <DetailGrid cols={2}>
                <DataField label="Status" value={<StatusBadge status={detail.status} />} />
                <DataField
                  label="Reviewed at"
                  value={detail.reviewedAt ? formatDateTime(detail.reviewedAt) : null}
                />
              </DetailGrid>
              {detail.reviewNote ? (
                <p className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
                  {detail.reviewNote}
                </p>
              ) : null}
            </DetailSection>
          </>
        ) : null}
      </DetailSheet>

      {/* ========================= APPROVE (FormSheet) ======================== */}
      <FormSheet
        open={!!approveTarget}
        onOpenChange={(o) => {
          if (!o) setApproveTarget(null);
        }}
        title="Approve volunteer"
        description={`${approveTarget?.fullName ?? ""} gets an active portal account and joins the roster with their reported skills.`}
        size="sm"
        submitLabel="Review approval"
        onSubmit={() => {
          setApprovePending(approveTarget);
        }}
        badge={approveTarget ? <StatusBadge status={approveTarget.status} /> : null}
      >
        <FormSection title="Review note" description="Optional — visible in the application record.">
          <TextareaField
            label="Note"
            value={approveNote}
            onChange={setApproveNote}
            placeholder="e.g. Verified references, completed induction call…"
            rows={3}
          />
        </FormSection>
      </FormSheet>

      <ConfirmDialog
        open={!!approvePending}
        onOpenChange={(o) => {
          if (!o) setApprovePending(null);
        }}
        title="Approve this volunteer?"
        recordName={approvePending ? `${approvePending.fullName} · ${approvePending.email}` : null}
        description="The linked user account becomes ACTIVE, a Volunteer profile is created from the application, and the applicant can sign in to the volunteer portal."
        confirmLabel="Approve volunteer"
        loading={approving}
        onConfirm={runApprove}
      />

      {/* ========================== REJECT (FormSheet) ======================== */}
      <FormSheet
        open={!!rejectTarget}
        onOpenChange={(o) => {
          if (!o) setRejectTarget(null);
        }}
        title="Reject application"
        description="The application is marked rejected. The account stays inactive and cannot sign in."
        size="sm"
        submitLabel="Continue rejection"
        onSubmit={() => {
          setRejectPending(rejectTarget);
        }}
      >
        <FormSection title="Rejection reason" description="Optional — kept on the record.">
          <TextareaField
            label="Reason"
            value={rejectNote}
            onChange={setRejectNote}
            placeholder="e.g. Cannot commit to weekend drives this quarter…"
            rows={3}
          />
        </FormSection>
      </FormSheet>

      <ConfirmDialog
        open={!!rejectPending}
        onOpenChange={(o) => {
          if (!o) setRejectPending(null);
        }}
        title="Reject this application?"
        recordName={rejectPending ? `${rejectPending.fullName} · ${rejectPending.email}` : null}
        description="The applicant will not be able to sign in to the volunteer portal. You can reconsider later by setting the application back to pending."
        confirmLabel="Reject application"
        loading={rejecting}
        onConfirm={runReject}
      />

      {/* ===================== TEMP CREDS REVEAL (Dialog) ===================== */}
      <Dialog open={!!approvedCreds} onOpenChange={(o) => !o && setApprovedCreds(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" aria-hidden="true" />
              Temporary portal credentials
            </DialogTitle>
            <DialogDescription>
              Share these with {approvedCreds?.fullName ?? "the volunteer"} over a secure
              channel. They can change the password after signing in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5 rounded-lg border bg-muted/40 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Email
                </p>
                <p className="truncate text-sm font-medium">{approvedCreds?.email ?? "—"}</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Temporary password
                </p>
                <p className="truncate font-mono text-sm font-medium">
                  {approvedCreds?.password ?? "—"}
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setApprovedCreds(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══════════════════════════ VOLUNTEERS TAB ═══════════════════════════ */

function VolunteersTab({
  revision,
  onChanged,
  openVolunteer,
}: {
  revision: number;
  onChanged: () => void;
  openVolunteer: (id: string) => void;
}) {
  const [vols, setVols] = useState<VolunteerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [view, setView] = useViewPref("volunteers");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [editTarget, setEditTarget] = useState<VolunteerRow | null>(null);
  const [assignTarget, setAssignTarget] = useState<VolunteerRow | null>(null);
  const [attTarget, setAttTarget] = useState<VolunteerRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (filter !== "ALL") sp.set("status", filter);
      const rows = await get<VolunteerRow[]>(`/api/volunteers?${sp.toString()}`);
      const list = (Array.isArray(rows) ? rows : []).slice();
      if (appliedQuery.trim()) {
        const q = appliedQuery.trim().toLowerCase();
        list.sort((a, b) => {
          const am = matchesQuery(a, q) ? 0 : 1;
          const bm = matchesQuery(b, q) ? 0 : 1;
          return am - bm;
        });
      }
      setVols(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load volunteers");
    } finally {
      setLoading(false);
    }
  }, [filter, appliedQuery]);

  useEffect(() => {
    load();
  }, [load, revision]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setAppliedQuery(query);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const filtered = useMemo(() => {
    const q = appliedQuery.trim().toLowerCase();
    if (!q) return vols;
    return vols.filter((v) => matchesQuery(v, q));
  }, [vols, appliedQuery]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, pages);
  const paged = useMemo(
    () => filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize),
    [filtered, pageSafe, pageSize]
  );

  const volCsv: CsvColumn<VolunteerRow>[] = useMemo(
    () => [
      { header: "Name", value: (v) => v.user?.name ?? "" },
      { header: "Email", value: (v) => v.user?.email ?? "" },
      { header: "Phone", value: (v) => v.user?.phone ?? "" },
      { header: "City", value: (v) => v.user?.city ?? "" },
      { header: "Status", value: (v) => v.status },
      { header: "Assigned area", value: (v) => v.assignedArea ?? "" },
      { header: "Skills", value: (v) => parseList(v.skills).join("; ") },
      { header: "Availability", value: (v) => parseList(v.availability).join("; ") },
      { header: "Emergency contact", value: (v) => v.emergencyContact ?? "" },
      { header: "ID proof", value: (v) => v.idProof ?? "" },
      { header: "Joined", value: (v) => formatDate(v.joinedAt) },
    ],
    []
  );

  const columns: DataTableColumn<VolunteerRow>[] = [
    {
      key: "name",
      header: "Volunteer",
      accessor: (v) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initials(v.user?.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium">
              <span className="truncate">{v.user?.name ?? "Volunteer"}</span>
              <span className="shrink-0 font-mono text-[10px] font-normal text-muted-foreground/70">{v.code}</span>
            </p>
            <p className="truncate text-xs text-muted-foreground">{v.user?.email ?? "—"}</p>
          </div>
        </div>
      ),
    },
    { key: "status", header: "Status", accessor: (v) => <StatusBadge status={v.status} /> },
    {
      key: "area",
      header: "Area",
      hideBelow: "md",
      accessor: (v) => (
        <span className="text-sm text-muted-foreground">{v.assignedArea || "—"}</span>
      ),
    },
    {
      key: "skills",
      header: "Skills",
      hideBelow: "lg",
      accessor: (v) => {
        const skills = parseList(v.skills);
        if (!skills.length)
          return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="flex max-w-52 flex-wrap gap-1">
            {skills.slice(0, 2).map((s) => (
              <Chip key={s}>{titleCase(s)}</Chip>
            ))}
            {skills.length > 2 ? <Chip>+{skills.length - 2}</Chip> : null}
          </div>
        );
      },
    },
    {
      key: "phone",
      header: "Phone",
      hideBelow: "lg",
      accessor: (v) => (
        <span className="font-mono text-xs text-muted-foreground">{v.user?.phone || "—"}</span>
      ),
    },
    {
      key: "joined",
      header: "Joined",
      hideBelow: "sm",
      accessor: (v) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(v.joinedAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "w-12",
      accessor: (v) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Actions for ${v.user?.name ?? "volunteer"}`}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => openVolunteer(v.id)}>
                <Info className="size-4" aria-hidden="true" /> View details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditTarget(v)}>
                <Pencil className="size-4" aria-hidden="true" /> Edit profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAssignTarget(v)}>
                <Link2 className="size-4" aria-hidden="true" /> Assign to…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAttTarget(v)}>
                <CalendarClock className="size-4" aria-hidden="true" /> Log attendance
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const filtersActive = filter !== "ALL" || appliedQuery.trim() !== "";

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, area…"
            aria-label="Search volunteers"
            className="pl-8"
          />
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter volunteers by status"
        >
          {VOL_FILTERS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={filter === t}
              onClick={() => {
                setFilter(t);
                setPage(1);
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                filter === t
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-accent"
              )}
            >
              {titleCase(t)}
            </button>
          ))}
        </div>

        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${filtered.length} volunteer${filtered.length === 1 ? "" : "s"}`}
        </span>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ExportMenu
            columns={volCsv}
            rows={filtered}
            filename="uar-volunteers"
            disabled={filtered.length === 0}
          />
          <ViewSwitcher value={view} onChange={setView} options={["table", "grid"]} />
        </div>
      </div>

      {view === "table" ? (
        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(v) => v.id}
          loading={loading}
          skeletonRows={6}
          height="fill"
          fillOffset={340}
          onRowClick={(v) => openVolunteer(v.id)}
          page={pageSafe}
          pages={pages}
          total={filtered.length}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          itemLabel="volunteers"
          empty={
            <EmptyState
              icon={<Users className="size-8" aria-hidden="true" />}
              title={filtersActive ? "No volunteers match these filters" : "No volunteers on the roster yet"}
              hint="Approve a volunteer application to add the first member to the crew."
            />
          }
        />
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="size-8" aria-hidden="true" />}
          title={filtersActive ? "No volunteers match these filters" : "No volunteers on the roster yet"}
          hint="Approve a volunteer application to add the first member to the crew."
        />
      ) : (
        <div
          className="grid max-h-[36rem] gap-4 overflow-y-auto scrollbar-thin sm:grid-cols-2 xl:grid-cols-3"
          role="list"
          aria-label="Volunteers"
        >
          {paged.map((v) => {
            const skills = parseList(v.skills);
            return (
              <div
                key={v.id}
                role="listitem"
                className="flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-accent/40"
                onClick={() => openVolunteer(v.id)}
              >
                <div className="flex items-start gap-3">
                  <Avatar className="size-10">
                    <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                      {initials(v.user?.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-medium">
                      <span className="truncate">{v.user?.name ?? "Volunteer"}</span>
                      <span className="shrink-0 font-mono text-[10px] font-normal text-muted-foreground/70">{v.code}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{v.user?.email ?? "—"}</p>
                  </div>
                  <StatusBadge status={v.status} />
                </div>
                <div className="flex flex-wrap gap-1">
                  {skills.length ? (
                    <>
                      {skills.slice(0, 3).map((s) => (
                        <Chip key={s}>{titleCase(s)}</Chip>
                      ))}
                      {skills.length > 3 ? <Chip>+{skills.length - 3}</Chip> : null}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">No skills listed</span>
                  )}
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 border-t pt-2.5 text-xs text-muted-foreground">
                  <span className="truncate">
                    {v.assignedArea ?? "No area assigned"}
                  </span>
                  <span className="shrink-0 whitespace-nowrap">Joined {formatDate(v.joinedAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <VolunteerEditFormSheet
        open={!!editTarget}
        volunteer={editTarget}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
        onSaved={() => {
          setEditTarget(null);
          load();
          onChanged();
        }}
      />

      <AssignFormSheet
        open={!!assignTarget}
        onOpenChange={(o) => {
          if (!o) setAssignTarget(null);
        }}
        volunteerIds={assignTarget ? [assignTarget.id] : []}
        volunteerNames={assignTarget ? [assignTarget.user?.name ?? "Volunteer"] : []}
        onDone={() => {
          setAssignTarget(null);
          onChanged();
        }}
      />

      <AttendanceFormSheet
        open={!!attTarget}
        onOpenChange={(o) => {
          if (!o) setAttTarget(null);
        }}
        fixedVolunteerId={attTarget?.id}
        fixedVolunteerName={attTarget?.user?.name}
        onDone={() => {
          setAttTarget(null);
          onChanged();
        }}
      />
    </div>
  );
}

function matchesQuery(v: VolunteerRow, q: string): boolean {
  return (
    (v.user?.name ?? "").toLowerCase().includes(q) ||
    (v.code ?? "").toLowerCase().includes(q) ||
    (v.user?.email ?? "").toLowerCase().includes(q) ||
    (v.assignedArea ?? "").toLowerCase().includes(q) ||
    (v.user?.city ?? "").toLowerCase().includes(q)
  );
}

/* ═══════════════════════════ TASKS TAB ═══════════════════════════ */

function TasksTab({
  revision,
  onChanged,
  openVolunteer,
}: {
  revision: number;
  onChanged: () => void;
  openVolunteer: (id: string) => void;
}) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [vols, setVols] = useState<VolunteerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [volunteerFilter, setVolunteerFilter] = useState("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaskRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  const taskTypeOptions = useMasters("TASK_TYPE");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (statusFilter !== "ALL") sp.set("status", statusFilter);
      if (typeFilter !== "ALL") sp.set("type", typeFilter);
      if (volunteerFilter) sp.set("volunteerId", volunteerFilter);
      if (appliedQuery.trim()) sp.set("q", appliedQuery.trim());
      const rows = await get<TaskRow[]>(`/api/volunteer-tasks?${sp.toString()}`);
      setTasks(Array.isArray(rows) ? rows : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, volunteerFilter, appliedQuery]);

  useEffect(() => {
    load();
  }, [load, revision]);

  useEffect(() => {
    get<VolunteerRow[]>("/api/volunteers")
      .then((rows) => setVols(Array.isArray(rows) ? rows : []))
      .catch(() => setVols([]));
  }, [revision]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setAppliedQuery(query);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const pages = Math.max(1, Math.ceil(tasks.length / pageSize));
  const pageSafe = Math.min(page, pages);
  const paged = useMemo(
    () => tasks.slice((pageSafe - 1) * pageSize, pageSafe * pageSize),
    [tasks, pageSafe, pageSize]
  );

  const advance = async (task: TaskRow, status: string) => {
    setAdvancingId(task.id);
    try {
      await patch(`/api/volunteer-tasks/${task.id}`, { status });
      toast.success(`Task ${humanize(status).toLowerCase()}`);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update task");
    } finally {
      setAdvancingId(null);
    }
  };

  const runDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/volunteer-tasks/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Delete failed");
      toast.success("Task deleted");
      setDeleteTarget(null);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete task");
    } finally {
      setDeleting(false);
    }
  };

  const taskCsv: CsvColumn<TaskRow>[] = useMemo(
    () => [
      { header: "Title", value: (t) => t.title },
      { header: "Volunteer", value: (t) => t.volunteer?.user?.name ?? "" },
      { header: "Type", value: (t) => titleCase(t.type) },
      { header: "Priority", value: (t) => titleCase(t.priority) },
      { header: "Status", value: (t) => t.status },
      { header: "Scheduled", value: (t) => formatDate(t.scheduledDate) },
      { header: "Location", value: (t) => t.location ?? "" },
      { header: "Linked record", value: (t) => (t.refType ? `${t.refType} ${t.refId ?? ""}` : "") },
      { header: "Source", value: (t) => t.createdFrom ?? "MANUAL" },
      { header: "Notes", value: (t) => t.notes ?? "" },
    ],
    []
  );

  const columns: DataTableColumn<TaskRow>[] = [
    {
      key: "date",
      header: "Scheduled",
      className: "w-[6.5rem]",
      accessor: (t) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDate(t.scheduledDate)}
        </span>
      ),
    },
    {
      key: "title",
      header: "Task",
      accessor: (t) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{t.title}</p>
          {t.location ? (
            <p className="truncate text-xs text-muted-foreground">{t.location}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "volunteer",
      header: "Volunteer",
      hideBelow: "md",
      accessor: (t) => (
        <span className="text-muted-foreground">{t.volunteer?.user?.name ?? "—"}</span>
      ),
    },
    { key: "type", header: "Type", hideBelow: "sm", accessor: (t) => typeChip(t.type) },
    {
      key: "priority",
      header: "Priority",
      hideBelow: "lg",
      accessor: (t) => priorityBadge(t.priority),
    },
    { key: "ref", header: "Linked to", hideBelow: "lg", accessor: (t) => refCell(t) },
    { key: "status", header: "Status", accessor: (t) => <StatusBadge status={t.status} /> },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "w-12",
      accessor: (t) => {
        const transitions = taskTransitions(t.status);
        return (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Actions for task ${t.title}`}
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {transitions.map((tr) => (
                  <DropdownMenuItem
                    key={tr.status}
                    disabled={advancingId === t.id}
                    onClick={() => advance(t, tr.status)}
                  >
                    <tr.icon className="size-4" aria-hidden="true" /> {tr.label}
                  </DropdownMenuItem>
                ))}
                {transitions.length ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onClick={() => openVolunteer(t.volunteerId)}>
                  <Users className="size-4" aria-hidden="true" /> View volunteer
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                  onClick={() => setDeleteTarget(t)}
                >
                  <X className="size-4" aria-hidden="true" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-56">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="pl-8"
          />
        </div>

        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
        >
          {TASK_STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All statuses" : humanize(s)}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by task type"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
        >
          <option value="ALL">All types</option>
          {taskTypeOptions.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by volunteer"
          value={volunteerFilter}
          onChange={(e) => {
            setVolunteerFilter(e.target.value);
            setPage(1);
          }}
          className="flex h-9 max-w-52 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
        >
          <option value="">All volunteers</option>
          {vols.map((v) => (
            <option key={v.id} value={v.id}>
              {v.user?.name ?? "Volunteer"}
            </option>
          ))}
        </select>

        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
        </span>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ExportMenu
            columns={taskCsv}
            rows={tasks}
            filename="uar-volunteer-tasks"
            disabled={tasks.length === 0}
          />
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden="true" /> Add task
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={paged}
        rowKey={(t) => t.id}
        loading={loading}
        skeletonRows={8}
        height="fill"
        fillOffset={340}
        page={pageSafe}
        pages={pages}
        total={tasks.length}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        itemLabel="tasks"
        empty={
          <EmptyState
            icon={<ClipboardList className="size-8" aria-hidden="true" />}
            title="No tasks match these filters"
            hint="Assign volunteers to a distribution, campaign or event — tasks are generated automatically — or add one manually."
          >
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" aria-hidden="true" /> Add task
            </Button>
          </EmptyState>
        }
      />

      <TaskFormSheet
        open={addOpen}
        onOpenChange={(o) => {
          if (!o) setAddOpen(false);
        }}
        onDone={() => {
          setAddOpen(false);
          load();
          onChanged();
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Delete this task?"
        recordName={deleteTarget?.title ?? null}
        description="The task is permanently removed from the volunteer's board."
        confirmLabel="Delete task"
        loading={deleting}
        onConfirm={runDelete}
      />
    </div>
  );
}

/* ═════════════════════════ ASSIGNMENTS TAB ══════════════════════════ */

/**
 * Record-first "Assign volunteers" panel backed by /api/volunteer-assignments:
 * choose a record (distribution / campaign / event), tick one or many
 * volunteers, set schedule/priority/notes → POST creates one AUTO task per
 * volunteer (duplicates skipped server-side). Below the form, the assignments
 * already generated for the chosen record (GET ?refType=&refId=).
 */
function AssignmentsTab({
  revision,
  onChanged,
  openVolunteer,
}: {
  revision: number;
  onChanged: () => void;
  openVolunteer: (id: string) => void;
}) {
  /* record picker */
  const [linkType, setLinkType] = useState("DISTRIBUTION");
  const [refId, setRefId] = useState("");
  const [eventRef, setEventRef] = useState("");
  const [records, setRecords] = useState<RecordOption[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  /* volunteer multi-select */
  const [vols, setVols] = useState<VolunteerRow[]>([]);
  const [volsLoading, setVolsLoading] = useState(true);
  const [volQuery, setVolQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  /* schedule */
  const [scheduledDate, setScheduledDate] = useState(addDaysIso(3));
  const [priority, setPriority] = useState("MEDIUM");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<RuleErr>({});
  const [saving, setSaving] = useState(false);

  /* existing assignments for the chosen record */
  const [existing, setExisting] = useState<TaskRow[]>([]);
  const [existingLoading, setExistingLoading] = useState(false);
  const [existingReady, setExistingReady] = useState(false);

  const loadVolunteers = useCallback(async () => {
    setVolsLoading(true);
    try {
      const rows = await get<VolunteerRow[]>("/api/volunteers");
      setVols(Array.isArray(rows) ? rows : []);
    } catch {
      setVols([]);
    } finally {
      setVolsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVolunteers();
  }, [loadVolunteers, revision]);

  /* load record options for the chosen link type (distributions / campaigns) */
  useEffect(() => {
    if (linkType === "EVENT") {
      setRecords([]);
      setRecordsLoading(false);
      return;
    }
    let alive = true;
    setRecordsLoading(true);
    const run = async () => {
      try {
        if (linkType === "DISTRIBUTION") {
          const data = await get<DistributionLite[] | { items?: DistributionLite[] }>(
            "/api/distributions?limit=50"
          );
          const rows = Array.isArray(data) ? data : (data.items ?? []);
          if (alive)
            setRecords(
              rows.map((r) => ({
                id: r.id,
                label: r.beneficiary?.name
                  ? `${titleCase(r.type)} — ${r.beneficiary.name}`
                  : `${titleCase(r.type)} drive`,
                sub: `${formatDate(r.distributedAt)} · ${r.quantity} unit${r.quantity === 1 ? "" : "s"}${
                  r.location ? ` · ${r.location}` : ""
                }`,
              }))
            );
        } else {
          const rows = await get<CampaignLite[]>("/api/campaigns");
          if (alive)
            setRecords(
              (Array.isArray(rows) ? rows : []).map((c) => ({
                id: c.id,
                label: c.title,
                sub: titleCase(c.status),
              }))
            );
        }
      } catch {
        if (alive) setRecords([]);
      } finally {
        if (alive) setRecordsLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [linkType]);

  const chosenRefId = linkType === "EVENT" ? eventRef.trim() : refId;
  const chosenRecord = records.find((r) => r.id === chosenRefId);

  /* debounce the ref id so typing an event reference doesn't spam the API */
  const [debouncedRefId, setDebouncedRefId] = useState(chosenRefId);
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedRefId(chosenRefId), 450);
    return () => window.clearTimeout(t);
  }, [chosenRefId]);

  const loadExisting = useCallback(async () => {
    if (!debouncedRefId) {
      setExisting([]);
      setExistingReady(false);
      return;
    }
    setExistingLoading(true);
    try {
      const rows = await get<TaskRow[]>(
        `/api/volunteer-assignments?refType=${encodeURIComponent(linkType)}&refId=${encodeURIComponent(debouncedRefId)}`
      );
      setExisting(Array.isArray(rows) ? rows : []);
      setExistingReady(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load assignments");
      setExisting([]);
      setExistingReady(true);
    } finally {
      setExistingLoading(false);
    }
  }, [linkType, debouncedRefId]);

  useEffect(() => {
    loadExisting();
  }, [loadExisting, revision]);

  /* roster ordering: active first, then by name */
  const sortedVols = useMemo(
    () =>
      [...vols].sort((a, b) => {
        const aActive = a.status === "ACTIVE" ? 0 : 1;
        const bActive = b.status === "ACTIVE" ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return (a.user?.name ?? "").localeCompare(b.user?.name ?? "");
      }),
    [vols]
  );

  const filteredVols = useMemo(() => {
    const q = volQuery.trim().toLowerCase();
    if (!q) return sortedVols;
    return sortedVols.filter((v) =>
      `${v.user?.name ?? ""} ${v.user?.email ?? ""} ${v.assignedArea ?? ""} ${v.code}`
        .toLowerCase()
        .includes(q)
    );
  }, [sortedVols, volQuery]);

  const toggleVolunteer = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setErrors((e) => ({ ...e, volunteerIds: undefined }));
  };

  const save = async () => {
    const errs = collectErrors(
      [
        "refId",
        chosenRefId
          ? null
          : linkType === "EVENT"
            ? "Enter the event name or reference"
            : "Select a record",
      ],
      ["volunteerIds", selectedIds.length ? null : "Tick at least one volunteer"]
    );
    setErrors(errs ?? {});
    if (errs) return;

    setSaving(true);
    try {
      const res = await post<{ tasks?: unknown[]; skipped?: number }>(
        "/api/volunteer-assignments",
        {
          refType: linkType,
          refId: chosenRefId,
          volunteerIds: selectedIds,
          ...(scheduledDate
            ? { scheduledDate: new Date(`${scheduledDate}T09:00:00`).toISOString() }
            : {}),
          ...(priority ? { priority } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }
      );
      const created = res?.tasks?.length ?? 0;
      const skipped = res?.skipped ?? 0;
      if (created === 0) {
        toast.info("All selected volunteers were already assigned — nothing created");
      } else {
        toast.success(
          `${created} task${created === 1 ? "" : "s"} created${
            skipped > 0 ? ` · ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped` : ""
          }`
        );
        setSelectedIds([]);
        setNotes("");
      }
      await loadExisting();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create assignments");
    } finally {
      setSaving(false);
    }
  };

  const selectedNames = selectedIds.map(
    (id) => vols.find((v) => v.id === id)?.user?.name ?? id
  );

  const columns: DataTableColumn<TaskRow>[] = [
    {
      key: "volunteer",
      header: "Volunteer",
      accessor: (t) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initials(t.volunteer?.user?.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{t.volunteer?.user?.name ?? "Volunteer"}</p>
            {t.volunteer?.assignedArea ? (
              <p className="truncate text-xs text-muted-foreground">{t.volunteer.assignedArea}</p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "task",
      header: "Task",
      hideBelow: "sm",
      accessor: (t) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-medium">
            {t.title} {autoBadge(t.createdFrom)}
          </p>
          {t.location ? (
            <p className="truncate text-xs text-muted-foreground">{t.location}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "scheduled",
      header: "Scheduled",
      hideBelow: "md",
      accessor: (t) => (
        <span className="whitespace-nowrap text-muted-foreground">{formatDate(t.scheduledDate)}</span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      hideBelow: "lg",
      accessor: (t) => priorityBadge(t.priority),
    },
    {
      key: "status",
      header: "Status",
      accessor: (t) => <StatusBadge status={t.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "w-12",
      accessor: (t) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => openVolunteer(t.volunteerId)}
          aria-label={`Open volunteer ${t.volunteer?.user?.name ?? t.volunteerId}`}
        >
          <Users className="size-4" aria-hidden="true" /> Volunteer
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* ---------------------------- assign form ---------------------------- */}
        <SectionCard
          title="Assign volunteers"
          description="Pick a record, tick the crew, and one task per volunteer is generated automatically."
          icon={<Link2 className="size-4" aria-hidden="true" />}
          className="self-start"
        >
          <div className="space-y-4">
            <FieldGrid>
              <SelectField
                label="Record type"
                value={linkType}
                onChange={(v) => {
                  setLinkType(v);
                  setRefId("");
                  setEventRef("");
                  setErrors({});
                }}
                options={LINK_TYPE_OPTIONS}
              />
              {linkType === "EVENT" ? (
                <TextField
                  label="Event name / reference"
                  value={eventRef}
                  onChange={(v) => {
                    setEventRef(v);
                    setErrors((e) => ({ ...e, refId: undefined }));
                  }}
                  placeholder="e.g. School safety workshop — Govt HS Jayanagar"
                  error={errors.refId}
                  hint="Free-form — the name becomes the record reference."
                />
              ) : (
                <SelectField
                  label="Record"
                  value={refId}
                  onChange={(v) => {
                    setRefId(v);
                    setErrors((e) => ({ ...e, refId: undefined }));
                  }}
                  options={records.map((r) => ({
                    value: r.id,
                    label: r.sub ? `${r.label} · ${r.sub}` : r.label,
                  }))}
                  placeholder={recordsLoading ? "Loading records…" : "Select a record"}
                  error={errors.refId}
                  disabled={recordsLoading}
                />
              )}
            </FieldGrid>

            {/* volunteer multi-select */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium">
                  Volunteers
                  <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
                </p>
                <div className="flex items-center gap-1.5">
                  {selectedIds.length > 0 ? (
                    <Badge
                      variant="outline"
                      className="border-teal-500/30 bg-teal-500/10 text-[10px] font-semibold text-teal-700 dark:text-teal-400"
                    >
                      {selectedIds.length} selected
                    </Badge>
                  ) : null}
                  {selectedIds.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setSelectedIds([])}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={volQuery}
                  onChange={(e) => setVolQuery(e.target.value)}
                  placeholder="Search the roster…"
                  aria-label="Search volunteers"
                  className="pl-8"
                />
              </div>

              <div
                className="max-h-64 overflow-y-auto rounded-lg border scrollbar-thin"
                role="group"
                aria-label="Select volunteers to assign"
              >
                {volsLoading ? (
                  <div className="space-y-2 p-3">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-10 rounded-lg" />
                    ))}
                  </div>
                ) : filteredVols.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {vols.length === 0
                      ? "No volunteers on the roster yet — approve an application first."
                      : "No volunteers match that search."}
                  </p>
                ) : (
                  filteredVols.map((v) => {
                    const checked = selectedIds.includes(v.id);
                    return (
                      <label
                        key={v.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 border-b px-3 py-2 text-sm transition-colors last:border-b-0",
                          checked ? "bg-primary/5" : "hover:bg-accent/50"
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleVolunteer(v.id)}
                          aria-label={`Select ${v.user?.name ?? "volunteer"}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{v.user?.name ?? "Volunteer"}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {v.user?.email ?? v.code}
                          </span>
                        </span>
                        <StatusBadge status={v.status} />
                      </label>
                    );
                  })
                )}
              </div>
              {errors.volunteerIds ? (
                <p className="text-xs font-medium text-destructive" role="alert">
                  {errors.volunteerIds}
                </p>
              ) : selectedNames.length ? (
                <p className="text-xs text-muted-foreground">{selectedNames.join(", ")}</p>
              ) : null}
            </div>

            <FieldGrid>
              <TextField
                label="Scheduled date"
                type="date"
                value={scheduledDate}
                onChange={setScheduledDate}
                min={todayIso()}
              />
              <SelectField
                label="Priority"
                value={priority}
                onChange={setPriority}
                options={PRIORITY_OPTIONS}
              />
            </FieldGrid>
            <TextField
              label="Location"
              value={location}
              onChange={setLocation}
              placeholder="e.g. Jayanagar, Bengaluru"
            />
            <TextareaField
              label="Notes for the volunteers"
              value={notes}
              onChange={setNotes}
              placeholder="Anything the crew should prepare…"
              rows={2}
            />

            <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
              {saving ? (
                <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              {saving ? "Creating assignments…" : "Create assignments"}
            </Button>
          </div>
        </SectionCard>

        {/* ------------------------ existing assignments ----------------------- */}
        <SectionCard
          title="Assignments for this record"
          description={
            chosenRefId
              ? chosenRecord
                ? `${chosenRecord.label}${chosenRecord.sub ? ` · ${chosenRecord.sub}` : ""}`
                : linkType === "EVENT"
                  ? `Event: ${chosenRefId}`
                  : chosenRefId
              : "Choose a record above to see the crew already assigned to it."
          }
          icon={<Users className="size-4" aria-hidden="true" />}
          actions={
            chosenRefId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={loadExisting}
                aria-label="Refresh assignments"
              >
                <RefreshCw className="size-4" aria-hidden="true" /> Refresh
              </Button>
            ) : null
          }
          bodyClassName="px-5"
        >
          {!chosenRefId ? (
            <EmptyState
              icon={<Link2 className="size-6" aria-hidden="true" />}
              title="No record selected"
              hint="Pick a distribution, campaign or event on the left — its generated tasks appear here."
            />
          ) : (
            <DataTable
              columns={columns}
              rows={existing}
              rowKey={(t) => t.id}
              loading={existingLoading}
              skeletonRows={4}
              height="auto"
              itemLabel="assignments"
              empty={
                <EmptyState
                  icon={<ClipboardList className="size-6" aria-hidden="true" />}
                  title={existingReady ? "No volunteers assigned yet" : "Loading assignments…"}
                  hint={
                    existingReady
                      ? "Tick volunteers on the left and create assignments — each one becomes a task on their board."
                      : undefined
                  }
                />
              }
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/* ═══════════════════════════ ATTENDANCE TAB ═══════════════════════════ */

function AttendanceTab({
  revision,
  onChanged,
}: {
  revision: number;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [vols, setVols] = useState<VolunteerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [volunteerFilter, setVolunteerFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AttendanceRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set("limit", "200");
      if (volunteerFilter) sp.set("volunteerId", volunteerFilter);
      const data = await get<AttendanceRow[]>(`/api/volunteer-attendances?${sp.toString()}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load attendance");
    } finally {
      setLoading(false);
    }
  }, [volunteerFilter]);

  useEffect(() => {
    load();
  }, [load, revision]);

  useEffect(() => {
    get<VolunteerRow[]>("/api/volunteers")
      .then((r) => setVols(Array.isArray(r) ? r : []))
      .catch(() => setVols([]));
  }, [revision]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageSafe = Math.min(page, pages);
  const paged = useMemo(
    () => rows.slice((pageSafe - 1) * pageSize, pageSafe * pageSize),
    [rows, pageSafe, pageSize]
  );

  const attCsv: CsvColumn<AttendanceRow>[] = useMemo(
    () => [
      { header: "Date", value: (a) => formatDate(a.date) },
      { header: "Volunteer", value: (a) => a.volunteer?.user?.name ?? "" },
      { header: "Check-in", value: (a) => fmtTime(a.checkIn) },
      { header: "Check-out", value: (a) => fmtTime(a.checkOut) },
      { header: "Hours", value: (a) => a.hours ?? "" },
      { header: "Location", value: (a) => a.location ?? "" },
      { header: "Notes", value: (a) => a.notes ?? "" },
    ],
    []
  );

  const columns: DataTableColumn<AttendanceRow>[] = [
    {
      key: "date",
      header: "Date",
      className: "w-[6.5rem]",
      accessor: (a) => (
        <span className="whitespace-nowrap font-medium">{formatDate(a.date)}</span>
      ),
    },
    {
      key: "volunteer",
      header: "Volunteer",
      accessor: (a) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{a.volunteer?.user?.name ?? "—"}</p>
          {a.volunteer?.assignedArea ? (
            <p className="truncate text-xs text-muted-foreground">{a.volunteer.assignedArea}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "checkIn",
      header: "Check-in",
      hideBelow: "md",
      accessor: (a) => (
        <span className="whitespace-nowrap text-muted-foreground">{fmtTime(a.checkIn)}</span>
      ),
    },
    {
      key: "checkOut",
      header: "Check-out",
      hideBelow: "md",
      accessor: (a) => (
        <span className="whitespace-nowrap text-muted-foreground">{fmtTime(a.checkOut)}</span>
      ),
    },
    {
      key: "hours",
      header: "Hours",
      align: "right",
      mono: true,
      accessor: (a) =>
        a.hours != null ? (
          <span className="font-medium">{a.hours.toFixed(1)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "location",
      header: "Location",
      hideBelow: "lg",
      accessor: (a) => (
        <span className="block max-w-44 truncate text-muted-foreground" title={a.location ?? ""}>
          {a.location || "—"}
        </span>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      hideBelow: "lg",
      accessor: (a) => (
        <span className="block max-w-40 truncate text-muted-foreground" title={a.notes ?? ""}>
          {a.notes || "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      className: "w-12",
      accessor: (a) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Edit attendance for ${a.volunteer?.user?.name ?? "volunteer"} on ${formatDate(a.date)}`}
            onClick={() => {
              setEditTarget(a);
              setFormOpen(true);
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter by volunteer"
          value={volunteerFilter}
          onChange={(e) => {
            setVolunteerFilter(e.target.value);
            setPage(1);
          }}
          className="flex h-9 max-w-56 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
        >
          <option value="">All volunteers</option>
          {vols.map((v) => (
            <option key={v.id} value={v.id}>
              {v.user?.name ?? "Volunteer"}
            </option>
          ))}
        </select>

        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {loading ? "Loading…" : `${rows.length} day${rows.length === 1 ? "" : "s"} logged`}
        </span>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ExportMenu
            columns={attCsv}
            rows={rows}
            filename="uar-volunteer-attendance"
            disabled={rows.length === 0}
          />
          <Button
            size="sm"
            onClick={() => {
              setEditTarget(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" /> Log attendance
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={paged}
        rowKey={(a) => a.id}
        loading={loading}
        skeletonRows={8}
        height="fill"
        fillOffset={340}
        page={pageSafe}
        pages={pages}
        total={rows.length}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        itemLabel="attendance days"
        empty={
          <EmptyState
            icon={<CalendarClock className="size-8" aria-hidden="true" />}
            title="No attendance logged yet"
            hint="Record check-ins and hours per volunteer per day — the register upserts automatically when you log the same date again."
          >
            <Button
              variant="outline"
              onClick={() => {
                setEditTarget(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" /> Log attendance
            </Button>
          </EmptyState>
        }
      />

      <AttendanceFormSheet
        open={formOpen}
        onOpenChange={(o) => {
          if (!o) setFormOpen(false);
        }}
        initial={editTarget}
        onDone={() => {
          setFormOpen(false);
          setEditTarget(null);
          load();
          onChanged();
        }}
      />
    </div>
  );
}

/* ═══════════════════════════ ANALYTICS TAB ═══════════════════════════ */

const typeBarConfig: ChartConfig = { count: { label: "Tasks", color: "#10b981" } };
const boardConfig: ChartConfig = { completed: { label: "Completed", color: "#14b8a6" } };
const hoursConfig: ChartConfig = { hours: { label: "Hours", color: "#10b981" } };

function AnalyticsTab({
  data,
  loading,
}: {
  data: AnalyticsData | null;
  loading: boolean;
}) {
  const taskTypeOptions = useMasters("TASK_TYPE");

  const kpis = data?.kpis;
  const typeData = useMemo(
    () =>
      (data?.tasksByType ?? []).map((t) => ({
        label:
          taskTypeOptions.options.find((o) => o.value === t.type)?.label ??
          titleCase(t.type),
        count: t.count,
      })),
    [data?.tasksByType, taskTypeOptions.options]
  );
  const statusData = useMemo(
    () => (data?.taskStatus ?? []).filter((s) => s.count > 0),
    [data?.taskStatus]
  );
  const boardData = useMemo(
    () => (data?.leaderboard ?? []).filter((l) => l.completed > 0),
    [data?.leaderboard]
  );
  const hoursData = useMemo(() => data?.monthlyHours ?? [], [data?.monthlyHours]);
  const hoursTotal = hoursData.reduce((s, m) => s + m.hours, 0);

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <StatCard
          label="Total volunteers"
          value={(kpis?.totalVolunteers ?? 0).toLocaleString("en-IN")}
          hint={`${kpis?.activeVolunteers ?? 0} active on the roster`}
          icon={<Users className="size-5" aria-hidden="true" />}
          accent="emerald"
        />
        <StatCard
          label="Active volunteers"
          value={(kpis?.activeVolunteers ?? 0).toLocaleString("en-IN")}
          hint="status ACTIVE"
          icon={<UserCheck className="size-5" aria-hidden="true" />}
          accent="teal"
        />
        <StatCard
          label="Pending applications"
          value={(kpis?.pendingApplications ?? 0).toLocaleString("en-IN")}
          hint="waiting for review"
          icon={<UserPlus className="size-5" aria-hidden="true" />}
          accent="amber"
        />
        <StatCard
          label="Tasks assigned"
          value={(kpis?.tasksAssigned ?? 0).toLocaleString("en-IN")}
          hint="non-cancelled tasks"
          icon={<ClipboardList className="size-5" aria-hidden="true" />}
          accent="lime"
        />
        <StatCard
          label="Tasks completed"
          value={(kpis?.tasksCompleted ?? 0).toLocaleString("en-IN")}
          hint="with completedAt stamp"
          icon={<BadgeCheck className="size-5" aria-hidden="true" />}
          accent="emerald"
        />
        <StatCard
          label="Completion rate"
          value={`${kpis?.completionRate ?? 0}%`}
          hint="completed ÷ assigned"
          icon={<Trophy className="size-5" aria-hidden="true" />}
          accent="teal"
        />
        <StatCard
          label="Hours this month"
          value={(kpis?.hoursThisMonth ?? 0).toLocaleString("en-IN")}
          hint="from the attendance register"
          icon={<Clock className="size-5" aria-hidden="true" />}
          accent="orange"
        />
        <StatCard
          label="Hours · last 6 months"
          value={hoursTotal.toLocaleString("en-IN")}
          hint="trend below"
          icon={<Activity className="size-5" aria-hidden="true" />}
          accent="lime"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* tasks by type */}
        <SectionCard
          title="Tasks by type"
          description="Where volunteer effort is directed"
          icon={<ClipboardList className="size-4" aria-hidden="true" />}
        >
          {typeData.every((t) => t.count === 0) ? (
            <EmptyState
              icon={<ClipboardList className="size-6" aria-hidden="true" />}
              title="No tasks yet"
              hint="Assign volunteers to distributions, campaigns or events to see the mix build up."
            />
          ) : (
            <ChartContainer config={typeBarConfig} className="aspect-auto h-56 w-full">
              <BarChart data={typeData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={52}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                  allowDecimals={false}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <span className="flex w-full items-center justify-between gap-4">
                          <span className="text-muted-foreground">Tasks</span>
                          <span className="font-mono font-medium tabular-nums">
                            {Number(value)}
                          </span>
                        </span>
                      )}
                    />
                  }
                />
                <Bar dataKey="count" fill="var(--color-count)" radius={[6, 6, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ChartContainer>
          )}
        </SectionCard>

        {/* status donut */}
        <SectionCard
          title="Task status distribution"
          description="Live pipeline health"
          icon={<Activity className="size-4" aria-hidden="true" />}
        >
          {statusData.length === 0 ? (
            <EmptyState
              icon={<Activity className="size-6" aria-hidden="true" />}
              title="No task activity yet"
              hint="Once tasks are assigned, their pipeline status shows here."
            />
          ) : (
            <>
              <ChartContainer config={{}} className="aspect-auto h-56 w-full">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="count"
                    nameKey="status"
                    innerRadius="55%"
                    outerRadius="85%"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {statusData.map((s) => (
                      <Cell key={s.status} fill={STATUS_COLORS[s.status] ?? "#10b981"} />
                    ))}
                  </Pie>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) => (
                          <span className="flex w-full items-center justify-between gap-4">
                            <span className="text-muted-foreground">{humanize(String(name))}</span>
                            <span className="font-mono font-medium tabular-nums">
                              {Number(value)}
                            </span>
                          </span>
                        )}
                      />
                    }
                  />
                </PieChart>
              </ChartContainer>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                {statusData.map((s) => (
                  <li key={s.status} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[s.status] ?? "#10b981" }}
                    />
                    <span>{humanize(s.status)}</span>
                    <span className="font-medium tabular-nums">{s.count}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        {/* leaderboard */}
        <SectionCard
          title="Volunteer leaderboard"
          description="Top 5 by completed tasks"
          icon={<Trophy className="size-4" aria-hidden="true" />}
        >
          {boardData.length === 0 ? (
            <EmptyState
              icon={<Trophy className="size-6" aria-hidden="true" />}
              title="No completed tasks yet"
              hint="The leaderboard fills up as volunteers complete their assigned work."
            />
          ) : (
            <ChartContainer config={boardConfig} className="aspect-auto h-56 w-full">
              <BarChart
                data={boardData}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={120}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <span className="flex w-full items-center justify-between gap-4">
                          <span className="text-muted-foreground">Completed</span>
                          <span className="font-mono font-medium tabular-nums">
                            {Number(value)}
                          </span>
                        </span>
                      )}
                    />
                  }
                />
                <Bar
                  dataKey="completed"
                  fill="var(--color-completed)"
                  radius={[0, 6, 6, 0]}
                  maxBarSize={26}
                />
              </BarChart>
            </ChartContainer>
          )}
        </SectionCard>

        {/* monthly hours */}
        <SectionCard
          title="Monthly hours trend"
          description="Hours logged over the last 6 months"
          icon={<Activity className="size-4" aria-hidden="true" />}
        >
          {hoursTotal === 0 ? (
            <EmptyState
              icon={<CalendarClock className="size-6" aria-hidden="true" />}
              title="No hours logged yet"
              hint="Log volunteer attendance to build the hours trend."
            />
          ) : (
            <ChartContainer config={hoursConfig} className="aspect-auto h-56 w-full">
              <AreaChart data={hoursData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="volHoursFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  allowDecimals={false}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <span className="flex w-full items-center justify-between gap-4">
                          <span className="text-muted-foreground">Hours</span>
                          <span className="font-mono font-medium tabular-nums">
                            {Number(value).toFixed(1)}
                          </span>
                        </span>
                      )}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="hours"
                  stroke="var(--color-hours)"
                  strokeWidth={2}
                  fill="url(#volHoursFill)"
                />
              </AreaChart>
            </ChartContainer>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/* ═══════════════════════ VOLUNTEER DETAIL SHEET ═══════════════════════ */

function VolunteerDetailSheet({
  volunteerId,
  open,
  onOpenChange,
  onChanged,
}: {
  volunteerId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<VolunteerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("overview");
  const [statusDraft, setStatusDraft] = useState("PENDING");
  const [savingStatus, setSavingStatus] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [attOpen, setAttOpen] = useState(false);

  const [logs, setLogs] = useState<ActivityLogRow[]>([]);

  const load = useCallback(async () => {
    if (!volunteerId) return;
    setLoading(true);
    try {
      const d = await get<VolunteerDetail>(`/api/volunteers/${volunteerId}`);
      setDetail(d);
      setStatusDraft(d?.status ?? "PENDING");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load volunteer");
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }, [volunteerId]);

  useEffect(() => {
    if (open && volunteerId) {
      setTab("overview");
      void load();
      get<ActivityLogRow[]>("/api/activity-logs?limit=150")
        .then((rows) => setLogs(Array.isArray(rows) ? rows : []))
        .catch(() => setLogs([]));
    }
  }, [open, volunteerId, load]);

  const relevantLogs = useMemo(() => {
    if (!detail) return [];
    const email = (detail.user?.email ?? "").toLowerCase();
    const name = (detail.user?.name ?? "").toLowerCase();
    return logs
      .filter((l) => {
        const hay = `${l.details ?? ""} ${l.action}`.toLowerCase();
        return (
          (detail.id && hay.includes(detail.id.toLowerCase())) ||
          (email.length > 4 && hay.includes(email)) ||
          (name.length > 3 && hay.includes(name))
        );
      })
      .slice(0, 20);
  }, [logs, detail]);

  const saveStatus = async () => {
    if (!detail) return;
    setSavingStatus(true);
    try {
      await patch(`/api/volunteers/${detail.id}`, { status: statusDraft });
      toast.success(
        statusDraft === "SUSPENDED"
          ? "Volunteer suspended — sign-in blocked"
          : `Volunteer marked ${humanize(statusDraft).toLowerCase()}`
      );
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setSavingStatus(false);
    }
  };

  const refreshSelf = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);

  return (
    <>
      <DetailSheet
        open={open}
        onOpenChange={onOpenChange}
        loading={loading}
        eyebrow={detail ? `Volunteers · ${detail.code}` : "Volunteers"}
        title={detail?.user?.name ?? "Volunteer"}
        description={
          detail
            ? `${detail.user?.email ?? "—"}${detail.user?.city ? ` · ${detail.user.city}` : ""}${
                detail.assignedArea ? ` · ${detail.assignedArea}` : ""
              }`
            : undefined
        }
        status={detail ? <StatusBadge status={detail.status} /> : null}
        actions={
          detail ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
                <Link2 className="size-3.5" aria-hidden="true" /> Assign
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="size-3.5" aria-hidden="true" /> Edit
              </Button>
            </>
          ) : null
        }
        footer={
          detail ? (
            <>
              <p className="text-xs text-muted-foreground">
                Joined {formatDate(detail.joinedAt)} · ID{" "}
                <span className="font-mono">{detail.id.slice(-8)}</span>
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setAttOpen(true)}>
                  <CalendarClock className="size-3.5" aria-hidden="true" /> Log attendance
                </Button>
              </div>
            </>
          ) : null
        }
      >
        {detail ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex w-full flex-wrap">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="tasks">
                Tasks
                <Badge variant="outline" className="ml-1.5 px-1.5 tabular-nums">
                  {detail.tasks?.length ?? 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="attendance">
                Attendance
                <Badge variant="outline" className="ml-1.5 px-1.5 tabular-nums">
                  {detail.attendances?.length ?? 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            {/* ---------------------------- OVERVIEW ---------------------------- */}
            <TabsContent value="overview" className="mt-5 space-y-6">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile
                  label="Tasks assigned"
                  value={detail.stats?.tasksAssigned ?? 0}
                />
                <StatTile
                  label="Completed"
                  value={detail.stats?.tasksCompleted ?? 0}
                />
                <StatTile label="Days present" value={detail.stats?.daysPresent ?? 0} />
                <StatTile
                  label="Total hours"
                  value={detail.stats?.totalHours ?? 0}
                />
              </div>

              <DetailSection title="Profile" description="Account and roster details.">
                <DetailGrid cols={3}>
                  <DataField label="Name" value={detail.user?.name ?? null} />
                  <DataField label="Email" value={detail.user?.email ?? null} />
                  <DataField label="Phone" value={detail.user?.phone ?? null} mono />
                  <DataField label="City" value={detail.user?.city ?? null} />
                  <DataField
                    label="Account status"
                    value={<StatusBadge status={detail.user?.status ?? detail.status} />}
                  />
                  <DataField
                    label="Joined"
                    value={formatDate(detail.joinedAt)}
                    icon={<CalendarClock className="size-3" aria-hidden="true" />}
                  />
                </DetailGrid>
              </DetailSection>

              <DetailSection
                title="Skills & availability"
                description="Synced from the approved application; editable below."
                actions={
                  <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
                    <Pencil className="size-3.5" aria-hidden="true" /> Edit
                  </Button>
                }
              >
                <div className="space-y-3">
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Skills
                    </p>
                    {parseList(detail.skills).length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {parseList(detail.skills).map((s) => (
                          <Chip key={s}>{titleCase(s)}</Chip>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No skills recorded.</p>
                    )}
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Availability
                    </p>
                    {parseList(detail.availability).length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {parseList(detail.availability).map((s) => (
                          <Chip key={s}>{titleCase(s)}</Chip>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not specified.</p>
                    )}
                  </div>
                </div>
              </DetailSection>

              <DetailSection title="Field assignment" description="Where this volunteer operates.">
                <DetailGrid cols={3}>
                  <DataField label="Assigned area" value={detail.assignedArea ?? null} icon={<MapPin className="size-3" aria-hidden="true" />} />
                  <DataField label="Emergency contact" value={detail.emergencyContact ?? null} />
                  <DataField label="ID proof" value={detail.idProof ?? null} mono />
                </DetailGrid>
              </DetailSection>

              <DetailSection
                title="Status management"
                description="Mirrors onto the user account — SUSPENDED blocks sign-in, ACTIVE enables it."
              >
                <div className="flex flex-wrap items-end gap-3">
                  <SelectField
                    label="Volunteer status"
                    value={statusDraft}
                    onChange={setStatusDraft}
                    options={VOL_STATUS_OPTIONS}
                    className="w-full sm:w-56"
                  />
                  <Button
                    size="sm"
                    onClick={saveStatus}
                    disabled={savingStatus || statusDraft === detail.status}
                  >
                    <Check className="size-4" aria-hidden="true" /> Save status
                  </Button>
                </div>
              </DetailSection>
            </TabsContent>

            {/* ----------------------------- TASKS ------------------------------ */}
            <TabsContent value="tasks" className="mt-5 space-y-3">
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
                  <Link2 className="size-3.5" aria-hidden="true" /> Assign to record
                </Button>
              </div>
              {(detail.tasks ?? []).length === 0 ? (
                <EmptyState
                  icon={<ClipboardList className="size-6" aria-hidden="true" />}
                  title="No tasks yet"
                  hint="Assign this volunteer to a distribution, campaign or event — a task is created automatically."
                >
                  <Button variant="outline" onClick={() => setAssignOpen(true)}>
                    <Link2 className="size-4" aria-hidden="true" /> Assign now
                  </Button>
                </EmptyState>
              ) : (
                (detail.tasks ?? []).map((t) => (
                  <TaskLine key={t.id} task={t} onChanged={refreshSelf} />
                ))
              )}
            </TabsContent>

            {/* --------------------------- ATTENDANCE ---------------------------- */}
            <TabsContent value="attendance" className="mt-5 space-y-3">
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setAttOpen(true)}>
                  <Plus className="size-3.5" aria-hidden="true" /> Log attendance
                </Button>
              </div>
              {(detail.attendances ?? []).length === 0 ? (
                <EmptyState
                  icon={<CalendarClock className="size-6" aria-hidden="true" />}
                  title="No attendance logged"
                  hint="Record check-ins and hours for each volunteering day — logging the same date again updates the entry."
                >
                  <Button variant="outline" onClick={() => setAttOpen(true)}>
                    <Plus className="size-4" aria-hidden="true" /> Log first day
                  </Button>
                </EmptyState>
              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/70">
                      <tr className="border-b text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-3 py-2">Date</th>
                        <th scope="col" className="px-3 py-2">In</th>
                        <th scope="col" className="px-3 py-2">Out</th>
                        <th scope="col" className="px-3 py-2 text-right">Hours</th>
                        <th scope="col" className="px-3 py-2">Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.attendances ?? []).map((a) => (
                        <tr key={a.id} className="border-b last:border-b-0">
                          <td className="px-3 py-2 font-medium">{formatDate(a.date)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{fmtTime(a.checkIn)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{fmtTime(a.checkOut)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {a.hours != null ? a.hours.toFixed(1) : "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{a.location || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* ---------------------------- ACTIVITY ----------------------------- */}
            <TabsContent value="activity" className="mt-5 space-y-2">
              {relevantLogs.length === 0 ? (
                <EmptyState
                  icon={<Activity className="size-6" aria-hidden="true" />}
                  title="No recent activity"
                  hint="Status changes, task assignments and attendance edits for this volunteer will appear here."
                />
              ) : (
                relevantLogs.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-start gap-3 rounded-lg border p-3"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400"
                    >
                      <Activity className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{humanize(l.action)}</p>
                      {l.details ? (
                        <p className="truncate text-xs text-muted-foreground" title={l.details}>
                          {l.details}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {timeAgo(l.createdAt)}
                    </span>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        ) : null}
      </DetailSheet>

      <VolunteerEditFormSheet
        open={editOpen}
        volunteer={detail}
        onOpenChange={(o) => {
          if (!o) setEditOpen(false);
        }}
        onSaved={() => {
          setEditOpen(false);
          refreshSelf();
        }}
      />

      <AssignFormSheet
        open={assignOpen}
        onOpenChange={(o) => {
          if (!o) setAssignOpen(false);
        }}
        volunteerIds={detail ? [detail.id] : []}
        volunteerNames={detail ? [detail.user?.name ?? "Volunteer"] : []}
        defaults={{ location: detail?.assignedArea ?? "" }}
        onDone={() => {
          setAssignOpen(false);
          refreshSelf();
        }}
      />

      <AttendanceFormSheet
        open={attOpen}
        onOpenChange={(o) => {
          if (!o) setAttOpen(false);
        }}
        fixedVolunteerId={detail?.id}
        fixedVolunteerName={detail?.user?.name}
        onDone={() => {
          setAttOpen(false);
          refreshSelf();
        }}
      />
    </>
  );
}

/* ═══════════════════════ shared: task row with advance ═════════════════ */

function TaskLine({ task, onChanged }: { task: TaskRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  const advance = async (status: string) => {
    setBusy(true);
    try {
      await patch(`/api/volunteer-tasks/${task.id}`, { status });
      toast.success(`Task ${humanize(status).toLowerCase()}`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update task");
    } finally {
      setBusy(false);
    }
  };

  const transitions = taskTransitions(task.status);

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-medium">{task.title}</p>
          {typeChip(task.type)}
          {priorityBadge(task.priority)}
          {autoBadge(task.createdFrom)}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDateTime(task.scheduledDate)}
          {task.location ? ` · ${task.location}` : ""}
        </p>
        {refCell(task) !== null && task.refType ? (
          <div className="mt-1.5">{refCell(task)}</div>
        ) : null}
      </div>
      <StatusBadge status={task.status} />
      {transitions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {transitions.map((tr) => (
            <Button
              key={tr.status}
              size="sm"
              variant="outline"
              className="h-8 min-h-8 px-2.5 text-xs"
              disabled={busy}
              onClick={() => advance(tr.status)}
            >
              {tr.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════ VOLUNTEER EDIT FORMSHEET ══════════════════════ */

const EMPTY_EDIT: {
  status: string;
  assignedArea: string;
  emergencyContact: string;
  idProof: string;
  skills: string[];
  availability: string[];
} = {
  status: "PENDING",
  assignedArea: "",
  emergencyContact: "",
  idProof: "",
  skills: [],
  availability: [],
};

function VolunteerEditFormSheet({
  open,
  volunteer,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  volunteer: VolunteerRow | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const skillOptions = useMasters("SKILL");
  const availOptions = useMasters("AVAILABILITY");

  const [form, setForm] = useState(EMPTY_EDIT);
  const [snapshot, setSnapshot] = useState(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && volunteer) {
      const next = {
        status: volunteer.status,
        assignedArea: volunteer.assignedArea ?? "",
        emergencyContact: volunteer.emergencyContact ?? "",
        idProof: volunteer.idProof ?? "",
        skills: parseList(volunteer.skills),
        availability: parseList(volunteer.availability),
      };
      setForm(next);
      setSnapshot(next);
    }
  }, [open, volunteer]);

  const dirty = JSON.stringify(form) !== JSON.stringify(snapshot);

  const toggle = (key: "skills" | "availability", value: string) => {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value)
        ? f[key].filter((x) => x !== value)
        : [...f[key], value],
    }));
  };

  const chipEditor = (key: "skills" | "availability") => {
    const opts = key === "skills" ? skillOptions : availOptions;
    const extra = form[key].filter((v) => !opts.options.some((o) => o.value === v));
    return (
      <div className="flex flex-wrap gap-1.5">
        {opts.options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={form[key].includes(o.value)}
            onClick={() => toggle(key, o.value)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              form[key].includes(o.value)
                ? "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400"
                : "border-border bg-background text-muted-foreground hover:bg-accent"
            )}
          >
            {o.label}
          </button>
        ))}
        {extra.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed
            onClick={() => toggle(key, v)}
            className="rounded-full border border-teal-500/40 bg-teal-500/10 px-2.5 py-1 text-xs font-medium text-teal-700 dark:text-teal-400"
          >
            {titleCase(v)} ✕
          </button>
        ))}
        {form[key].length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Tap to add {key === "skills" ? "skills" : "availability windows"}.
          </p>
        ) : null}
      </div>
    );
  };

  const save = async () => {
    if (!volunteer) return;
    setSaving(true);
    try {
      await patch(`/api/volunteers/${volunteer.id}`, {
        status: form.status,
        assignedArea: form.assignedArea.trim() || undefined,
        emergencyContact: form.emergencyContact.trim() || undefined,
        idProof: form.idProof.trim() || undefined,
        skills: form.skills.length ? JSON.stringify(form.skills) : undefined,
        availability: form.availability.length ? JSON.stringify(form.availability) : undefined,
      });
      toast.success("Volunteer profile updated");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update volunteer");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit volunteer profile"
      description={volunteer?.user?.name ? `Editing ${volunteer.user.name}` : undefined}
      size="md"
      submitLabel="Save profile"
      loading={saving}
      dirty={dirty}
      onSubmit={save}
    >
      <FormSection title="Status" description="Mirrors onto the user account for sign-in gating.">
        <SelectField
          label="Volunteer status"
          value={form.status}
          onChange={(v) => setForm((f) => ({ ...f, status: v }))}
          options={VOL_STATUS_OPTIONS}
        />
      </FormSection>

      <FormSection title="Field assignment">
        <FieldGrid>
          <TextField
            label="Assigned area"
            value={form.assignedArea}
            onChange={(v) => setForm((f) => ({ ...f, assignedArea: v }))}
            placeholder="e.g. Jayanagar, Bengaluru"
          />
          <TextField
            label="Emergency contact"
            value={form.emergencyContact}
            onChange={(v) => setForm((f) => ({ ...f, emergencyContact: v }))}
            placeholder="Name · phone"
          />
          <TextField
            label="ID proof reference"
            value={form.idProof}
            onChange={(v) => setForm((f) => ({ ...f, idProof: v }))}
            placeholder="e.g. Aadhaar ****1234"
            hint="Reference only — never upload documents here."
          />
        </FieldGrid>
      </FormSection>

      <FormSection title="Skills" description="Shown on the roster and used to match assignments.">
        {chipEditor("skills")}
      </FormSection>

      <FormSection title="Availability">
        {chipEditor("availability")}
      </FormSection>
    </FormSheet>
  );
}

/* ═══════════════════════════ ASSIGN FORMSHEET ══════════════════════════ */

function AssignFormSheet({
  open,
  onOpenChange,
  volunteerIds,
  volunteerNames,
  defaults,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  volunteerIds: string[];
  volunteerNames: string[];
  defaults?: { location?: string };
  onDone?: () => void;
}) {
  const [linkType, setLinkType] = useState("DISTRIBUTION");
  const [refId, setRefId] = useState("");
  const [eventRef, setEventRef] = useState("");
  const [records, setRecords] = useState<RecordOption[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(addDaysIso(3));
  const [priority, setPriority] = useState("MEDIUM");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<RuleErr>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setLinkType("DISTRIBUTION");
      setRefId("");
      setEventRef("");
      setScheduledDate(addDaysIso(3));
      setPriority("MEDIUM");
      setLocation(defaults?.location ?? "");
      setNotes("");
      setErrors({});
    }
  }, [open]);

  /* load record options for the chosen link type */
  useEffect(() => {
    if (!open || linkType === "EVENT") {
      setRecords([]);
      setRecordsLoading(false);
      return;
    }
    let alive = true;
    setRecordsLoading(true);
    const run = async () => {
      try {
        if (linkType === "DISTRIBUTION") {
          const data = await get<DistributionLite[] | { items?: DistributionLite[] }>(
            "/api/distributions?limit=50"
          );
          const rows = Array.isArray(data) ? data : (data.items ?? []);
          if (alive)
            setRecords(
              rows.map((r) => ({
                id: r.id,
                label: r.beneficiary?.name
                  ? `${titleCase(r.type)} — ${r.beneficiary.name}`
                  : `${titleCase(r.type)} drive`,
                sub: `${formatDate(r.distributedAt)} · ${r.quantity} unit${r.quantity === 1 ? "" : "s"}${
                  r.location ? ` · ${r.location}` : ""
                }`,
              }))
            );
        } else {
          const rows = await get<CampaignLite[]>("/api/campaigns");
          if (alive)
            setRecords(
              (Array.isArray(rows) ? rows : []).map((c) => ({
                id: c.id,
                label: c.title,
                sub: titleCase(c.status),
              }))
            );
        }
      } catch {
        if (alive) setRecords([]);
      } finally {
        if (alive) setRecordsLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [open, linkType]);

  const save = async () => {
    const chosenRefId = linkType === "EVENT" ? eventRef.trim() : refId;
    const errs = collectErrors(
      ["refId", chosenRefId ? null : linkType === "EVENT" ? "Enter the event name or reference" : "Select a record"],
      ["volunteerIds", volunteerIds.length ? null : "No volunteer selected"]
    );
    setErrors(errs ?? {});
    if (errs) return;

    setSaving(true);
    try {
      const res = await post<{ tasks?: unknown[]; skipped?: number }>(
        "/api/volunteer-assignments",
        {
          refType: linkType,
          refId: chosenRefId,
          volunteerIds,
          ...(scheduledDate
            ? { scheduledDate: new Date(`${scheduledDate}T09:00:00`).toISOString() }
            : {}),
          ...(priority ? { priority } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }
      );
      const created = res?.tasks?.length ?? 0;
      const skipped = res?.skipped ?? 0;
      if (created === 0) {
        toast.info("All selected volunteers were already assigned — nothing created");
      } else {
        toast.success(
          `${created} task${created === 1 ? "" : "s"} created${
            skipped > 0 ? ` · ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped` : ""
          }`
        );
      }
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create assignments");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Assign to record"
      description="Creates one task per volunteer, linked to the chosen record. Duplicates are skipped automatically."
      size="md"
      submitLabel="Create assignments"
      loading={saving}
      dirty
      onSubmit={save}
      badge={
        <Badge
          variant="outline"
          className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400"
        >
          {volunteerIds.length} volunteer{volunteerIds.length === 1 ? "" : "s"}
        </Badge>
      }
    >
      {volunteerNames.length ? (
        <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Assigning
          </p>
          <p className="mt-0.5 text-sm font-medium">{volunteerNames.join(", ")}</p>
        </div>
      ) : null}

      <FormSection title="Link type" description="What kind of record is this crew supporting?">
        <FieldGrid>
          <SelectField
            label="Link type"
            value={linkType}
            onChange={(v) => {
              setLinkType(v);
              setRefId("");
              setEventRef("");
              setErrors({});
            }}
            options={LINK_TYPE_OPTIONS}
          />
          {linkType === "EVENT" ? (
            <TextField
              label="Event name / reference"
              value={eventRef}
              onChange={setEventRef}
              placeholder="e.g. School safety workshop — Govt HS Jayanagar"
              error={errors.refId}
              hint="There is no events register yet — the name becomes the record reference."
            />
          ) : (
            <SelectField
              label="Record"
              value={refId}
              onChange={(v) => {
                setRefId(v);
                setErrors({});
              }}
              options={
                recordsLoading
                  ? []
                  : records.map((r) => ({
                      value: r.id,
                      label: r.sub ? `${r.label} · ${r.sub}` : r.label,
                    }))
              }
              placeholder={recordsLoading ? "Loading records…" : "Select a record"}
              error={errors.refId}
              disabled={recordsLoading}
            />
          )}
        </FieldGrid>
      </FormSection>

      <FormSection title="Schedule" description="Defaults to three days out at 09:00.">
        <FieldGrid>
          <TextField
            label="Scheduled date"
            type="date"
            value={scheduledDate}
            onChange={setScheduledDate}
            min={todayIso()}
          />
          <SelectField
            label="Priority"
            value={priority}
            onChange={setPriority}
            options={PRIORITY_OPTIONS}
          />
          <TextField
            label="Location"
            value={location}
            onChange={setLocation}
            placeholder="e.g. Jayanagar, Bengaluru"
            className="sm:col-span-2"
          />
        </FieldGrid>
        <TextareaField
          label="Notes for the volunteer"
          value={notes}
          onChange={setNotes}
          placeholder="Anything the crew should prepare…"
          rows={3}
        />
      </FormSection>
    </FormSheet>
  );
}

/* ═══════════════════════════ TASK FORMSHEET ════════════════════════════ */

function TaskFormSheet({
  open,
  onOpenChange,
  fixedVolunteerId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fixedVolunteerId?: string;
  onDone?: () => void;
}) {
  const [vols, setVols] = useState<VolunteerRow[]>([]);
  const [volunteerId, setVolunteerId] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState("DISTRIBUTION");
  const [priority, setPriority] = useState("MEDIUM");
  const [location, setLocation] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<RuleErr>({});
  const [saving, setSaving] = useState(false);

  const taskTypeOptions = useMasters("TASK_TYPE");

  useEffect(() => {
    if (!open) return;
    setVolunteerId(fixedVolunteerId ?? "");
    setTitle("");
    setType("DISTRIBUTION");
    setPriority("MEDIUM");
    setLocation("");
    setDescription("");
    setErrors({});
    const tomorrow = new Date(Date.now() + 86_400_000);
    setScheduledDate(
      `${dateValue(tomorrow)}T09:00`
    );
    get<VolunteerRow[]>("/api/volunteers")
      .then((rows) => setVols(Array.isArray(rows) ? rows : []))
      .catch(() => setVols([]));
  }, [open]);

  const save = async () => {
    const errs = collectErrors(
      ["volunteerId", volunteerId ? null : "Select a volunteer"],
      ["title", requiredText(title, "Title")],
      ["scheduledDate", scheduledDate ? null : "Pick a date and time"]
    );
    setErrors(errs ?? {});
    if (errs) return;

    setSaving(true);
    try {
      await post("/api/volunteer-tasks", {
        volunteerId,
        title: title.trim(),
        type,
        priority,
        location: location.trim() || undefined,
        scheduledDate,
        description: description.trim() || undefined,
      });
      toast.success("Task assigned");
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add task"
      description="Manual task — created from this board (tasks from assignments are marked AUTO)."
      size="md"
      submitLabel="Assign task"
      loading={saving}
      dirty
      onSubmit={save}
    >
      <FormSection title="Task">
        <FieldGrid>
          <SelectField
            label="Volunteer"
            value={volunteerId}
            onChange={(v) => {
              setVolunteerId(v);
              setErrors((e) => ({ ...e, volunteerId: undefined }));
            }}
            options={vols.map((v) => ({
              value: v.id,
              label: `${v.user?.name ?? "Volunteer"}${v.assignedArea ? ` — ${v.assignedArea}` : ""}`,
            }))}
            placeholder={vols.length ? "Select volunteer" : "Loading volunteers…"}
            error={errors.volunteerId}
            disabled={vols.length === 0}
          />
          <SelectField
            label="Task type"
            value={type}
            onChange={setType}
            options={taskTypeOptions.options}
          />
          <TextField
            label="Title"
            value={title}
            onChange={(v) => {
              setTitle(v);
              setErrors((e) => ({ ...e, title: undefined }));
            }}
            placeholder="e.g. Ration kit drive — Ward 12"
            error={errors.title}
            className="sm:col-span-2"
          />
          <SelectField
            label="Priority"
            value={priority}
            onChange={setPriority}
            options={PRIORITY_OPTIONS}
          />
          <TextField
            label="Scheduled for"
            type="datetime-local"
            value={scheduledDate}
            onChange={(v) => {
              setScheduledDate(v);
              setErrors((e) => ({ ...e, scheduledDate: undefined }));
            }}
            error={errors.scheduledDate}
          />
          <TextField
            label="Location"
            value={location}
            onChange={setLocation}
            placeholder="e.g. Community hall, BTM Layout"
            className="sm:col-span-2"
          />
        </FieldGrid>
        <TextareaField
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="What needs doing, materials, contacts…"
          rows={3}
        />
      </FormSection>
    </FormSheet>
  );
}

/* ═══════════════════════ ATTENDANCE FORMSHEET ══════════════════════════ */

function AttendanceFormSheet({
  open,
  onOpenChange,
  fixedVolunteerId,
  fixedVolunteerName,
  initial,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fixedVolunteerId?: string;
  fixedVolunteerName?: string;
  initial?: AttendanceRow | null;
  onDone?: () => void;
}) {
  const [vols, setVols] = useState<VolunteerRow[]>([]);
  const [volunteerId, setVolunteerId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [hours, setHours] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<RuleErr>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVolunteerId(fixedVolunteerId ?? initial?.volunteerId ?? "");
    setDate(initial ? dateOnly(initial.date) : todayIso());
    setCheckIn(initial ? timeOnly(initial.checkIn) : "");
    setCheckOut(initial ? timeOnly(initial.checkOut) : "");
    setHours(initial?.hours != null ? String(initial.hours) : "");
    setLocation(initial?.location ?? "");
    setNotes(initial?.notes ?? "");
    setErrors({});
    get<VolunteerRow[]>("/api/volunteers")
      .then((rows) => setVols(Array.isArray(rows) ? rows : []))
      .catch(() => setVols([]));
  }, [open]);

  const save = async () => {
    const errs = collectErrors(
      ["volunteerId", volunteerId ? null : "Select a volunteer"],
      ["date", date ? null : "Pick the day"]
    );
    setErrors(errs ?? {});
    if (errs) return;

    if (hours.trim() !== "") {
      const h = Number(hours);
      if (!Number.isFinite(h) || h < 0 || h > 24) {
        setErrors({ hours: "Hours must be between 0 and 24" });
        return;
      }
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = { volunteerId, date };
      if (checkIn) payload.checkIn = new Date(`${date}T${checkIn}:00`).toISOString();
      if (checkOut) payload.checkOut = new Date(`${date}T${checkOut}:00`).toISOString();
      if (hours.trim() !== "") payload.hours = Number(hours);
      if (location.trim()) payload.location = location.trim();
      if (notes.trim()) payload.notes = notes.trim();

      await post("/api/volunteer-attendances", payload);
      toast.success(
        initial ? "Attendance updated" : "Attendance logged — hours derived from check-in/out when left blank"
      );
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Edit attendance" : "Log attendance"}
      description="One entry per volunteer per day — logging the same date again updates it."
      size="md"
      submitLabel={initial ? "Save attendance" : "Log day"}
      loading={saving}
      dirty
      onSubmit={save}
    >
      <FormSection title="Who & when">
        <FieldGrid>
          <SelectField
            label="Volunteer"
            value={volunteerId}
            onChange={(v) => {
              setVolunteerId(v);
              setErrors((e) => ({ ...e, volunteerId: undefined }));
            }}
            options={
              fixedVolunteerId && fixedVolunteerName
                ? [{ value: fixedVolunteerId, label: fixedVolunteerName }]
                : vols.map((v) => ({
                    value: v.id,
                    label: v.user?.name ?? "Volunteer",
                  }))
            }
            placeholder={fixedVolunteerId ? fixedVolunteerName ?? "Volunteer" : "Select volunteer"}
            error={errors.volunteerId}
            disabled={!!fixedVolunteerId}
          />
          <TextField
            label="Date"
            type="date"
            value={date}
            onChange={(v) => {
              setDate(v);
              setErrors((e) => ({ ...e, date: undefined }));
            }}
            error={errors.date}
            max={todayIso()}
          />
          <TextField
            label="Check-in"
            type="time"
            value={checkIn}
            onChange={setCheckIn}
            hint="Leave blank if unknown"
          />
          <TextField
            label="Check-out"
            type="time"
            value={checkOut}
            onChange={setCheckOut}
            hint="Leave blank if unknown"
          />
          <TextField
            label="Hours"
            type="number"
            value={hours}
            onChange={setHours}
            min="0"
            max="24"
            step="0.25"
            placeholder="e.g. 4.5"
            error={errors.hours}
            hint="Auto-computed from check-in/out when left blank"
          />
          <TextField
            label="Location"
            value={location}
            onChange={setLocation}
            placeholder="e.g. Community kitchen, Indiranagar"
          />
        </FieldGrid>
        <TextareaField
          label="Notes"
          value={notes}
          onChange={setNotes}
          placeholder="Anything worth remembering about the day…"
          rows={2}
        />
      </FormSection>
    </FormSheet>
  );
}

/* ═══════════════════════════ tiny validators ═══════════════════════════ */

function requiredText(v: string, label: string): string | null {
  return v.trim() ? null : `${label} is required`;
}
