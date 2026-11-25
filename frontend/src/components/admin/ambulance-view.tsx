"use client";

/**
 * Ambulance & Green Corridor — the trust's emergency-response module.
 *
 * Tabs:
 *  1. Fleet            — ambulance roster (DataTable + grid/list, DetailSheet,
 *                        FormSheet with code auto-suggest, ConfirmDialog, CSV)
 *  2. Missions         — emergency missions with status stepper, dispatch
 *                        simulation (route + corridor events), DetailSheet with
 *                        route timeline + alert feed
 *  3. Corridor Events  — the V2X → cell-broadcast → mesh → FM → siren alert log
 *  4. Analytics        — KPIs + Recharts: by emergency type, 8-week trend,
 *                        alert fallback chain, congestion profile, top
 *                        segments by time saved, fleet utilisation
 *
 * Accent: red (green-corridor programme colour) via /10 opacity variants.
 */

import { Fragment, useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  Activity,
  Ambulance as AmbulanceIcon,
  ArrowRight,
  Ban,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  Flag,
  Gauge,
  MapPin,
  MoreHorizontal,
  Navigation,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Search,
  Siren,
  Sparkles,
  Timer,
  Trash2,
  TrendingUp,
  Users,
  Waypoints,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { del, get, patch, post } from "@/lib/api-client";
import {
  MISSION_FLOW,
  MISSION_NEXT_STEP,
  MISSION_PROGRESS,
  MISSION_STEP_LABEL,
} from "@/lib/missions";
import { AMBULANCE_STATUSES } from "@/lib/ambulances";
import { labelOf, useMasters } from "@/hooks/use-masters";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  titleCase,
} from "@/lib/format";
import { cn, formatNumber, timeAgo } from "@/lib/utils";
import { phoneRule, required } from "@/lib/validators";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  DetailGrid,
  DetailSection,
  DetailSheet,
} from "@/components/shared/detail-sheet";
import {
  Field,
  FieldGrid,
  FormSection,
  SelectField,
  TextField,
} from "@/components/shared/form-fields";
import { ExportMenu, type CsvColumn } from "@/components/shared/csv";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import {
  PaginationBar,
  useViewPref,
  ViewSwitcher,
} from "@/components/shared/view-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRowBusy } from "@/hooks/use-row-busy";
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

/* ---------------------------------- types ---------------------------------- */

interface Ambulance {
  id: string;
  code: string;
  type: string;
  status: string;
  base: string;
  driverName: string;
  driverPhone?: string | null;
  crew?: string | null;
  equipment?: string | null;
}

interface MissionAmbulanceLite {
  code: string;
  type: string;
  driverName: string;
}

interface Mission {
  id: string;
  requestRef: string;
  patientName: string;
  contact: string;
  emergencyType: string;
  priority: string;
  pickup: string;
  destination: string;
  ambulanceId?: string | null;
  status: string;
  progress: number;
  route?: string | null;
  corridorActive: boolean;
  vehiclesAlerted: number;
  timeSavedSec: number;
  etaMin?: number | null;
  ambulance?: MissionAmbulanceLite | null;
  createdAt?: string | null;
}

interface CorridorEventRow {
  id: string;
  missionId: string;
  segment: string;
  method: string;
  congestion: string;
  vehiclesAlerted: number;
  timeSavedSec: number;
  note?: string | null;
  createdAt?: string | null;
  mission?: { requestRef: string } | null;
}

interface RouteSeg {
  name: string;
  congestion: string;
  lengthKm: number;
}

interface SegForm {
  name: string;
  congestion: string;
  lengthKm: string;
}

interface AmbForm {
  code: string;
  type: string;
  status: string;
  base: string;
  driverName: string;
  driverPhone: string;
  crew: string;
  equipment: string;
}

interface MissionForm {
  patientName: string;
  contact: string;
  emergencyType: string;
  priority: string;
  pickup: string;
  destination: string;
  route: SegForm[];
}

/** Payload of GET /api/corridor-stats (extended; legacy keys preserved). */
interface CorridorStats {
  missions: { total: number; completed: number; active: number };
  vehiclesAlerted: number;
  timeSavedMin: number;
  avgSavedSec: number;
  completionRate: number;
  byMethod: { method: string; count: number; savedSec: number }[];
  bySegment: { segment: string; count: number; savedSec: number }[];
  topSegments: { segment: string; count: number; savedSec: number }[];
  byEmergencyType: { type: string; count: number }[];
  congestionDistribution: { congestion: string; count: number }[];
  weekly: { label: string; count: number }[];
  fleet: {
    total: number;
    available: number;
    onMission: number;
    maintenance: number;
    availabilityPct: number;
  };
  fleetUtilization: {
    id: string;
    code: string;
    type: string;
    missions: number;
    completed: number;
    savedSec: number;
  }[];
}

type RuleErr = Record<string, string | undefined>;

/* ------------------------------ maps & helpers ----------------------------- */

const CONGESTION_TONE: Record<string, Tone> = {
  LOW: "success",
  MODERATE: "warning",
  HEAVY: "warning",
  GRIDLOCK: "danger",
};

/** The 5-layer fallback chain — order is part of the product story. */
const METHODS = ["V2X_5G", "CELL_BROADCAST", "BLE_MESH", "FM_RDS", "SIREN"];

const METHOD_LABEL: Record<string, string> = {
  V2X_5G: "V2X · 5G",
  CELL_BROADCAST: "Cell Broadcast",
  BLE_MESH: "BLE Mesh",
  FM_RDS: "FM / RDS",
  SIREN: "Siren",
};

const METHOD_CHIP: Record<string, string> = {
  V2X_5G:
    "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  CELL_BROADCAST:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  BLE_MESH:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  FM_RDS:
    "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  SIREN: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
};

const CONGESTIONS = ["LOW", "MODERATE", "HEAVY", "GRIDLOCK"];

const PRIORITY_TONE: Record<string, Tone> = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "info",
};

// Mission flow (statuses, labels, auto progress, advance buttons) is shared
// with PATCH /api/missions/:id via @/lib/missions — no hand-mirroring.

const SEGMENT_POOL = [
  "Hebbal Flyover",
  "Outer Ring Road",
  "Silk Board Junction",
  "KR Puram Junction",
  "Tin Factory",
  "Marathahalli Bridge",
  "NICE Road",
  "Majestic Interchange",
];

const EMPTY_AMB_FORM: AmbForm = {
  code: "",
  type: "BLS",
  status: "AVAILABLE",
  base: "",
  driverName: "",
  driverPhone: "",
  crew: "",
  equipment: "",
};

const EMPTY_MISSION_FORM: MissionForm = {
  patientName: "",
  contact: "",
  emergencyType: "CARDIAC",
  priority: "HIGH",
  pickup: "",
  destination: "",
  route: [],
};

const PRIORITY_OPTIONS = [
  { value: "CRITICAL", label: "Critical" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
];

const CONGESTION_OPTIONS = [
  { value: "LOW", label: "Low" },
  { value: "MODERATE", label: "Moderate" },
  { value: "HEAVY", label: "Heavy" },
  { value: "GRIDLOCK", label: "Gridlock" },
];

const STATUS_OPTIONS = AMBULANCE_STATUSES.map((s) => ({ value: s, label: titleCase(s) }));

const MISSION_FILTERS = [
  "ALL",
  "REQUESTED",
  "DISPATCHED",
  "EN_ROUTE",
  "ARRIVED",
  "COMPLETED",
  "CANCELLED",
];

const EMERGENCY_SHORT: Record<string, string> = {
  CARDIAC: "Cardiac",
  ACCIDENT: "Accident",
  MATERNITY: "Maternity",
  BURN: "Burn",
  RESPIRATORY: "Respiratory",
  TRANSFER: "Transfer",
};

/* chart palette — red-led corridor accents, no indigo/blue */
const C_RED = "#ef4444";
const C_ROSE = "#f43f5e";
const C_ORANGE = "#f97316";
const C_AMBER = "#f59e0b";
const C_TEAL = "#14b8a6";
const C_EMERALD = "#10b981";

const CONGESTION_COLOR: Record<string, string> = {
  LOW: C_EMERALD,
  MODERATE: C_AMBER,
  HEAVY: C_ORANGE,
  GRIDLOCK: C_ROSE,
};

const METHOD_COLOR: Record<string, string> = {
  V2X_5G: C_TEAL,
  CELL_BROADCAST: C_EMERALD,
  BLE_MESH: C_AMBER,
  FM_RDS: C_ORANGE,
  SIREN: C_RED,
};

const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };

const TOOLTIP_PROPS = {
  contentStyle: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    fontSize: 12,
    color: "var(--card-foreground)",
  },
  labelStyle: { color: "var(--muted-foreground)", fontSize: 11 },
  itemStyle: { color: "var(--foreground)", fontSize: 12 },
  cursor: { fill: "var(--muted)", opacity: 0.55 },
} as const;

function parseRoute(json: string | null | undefined): RouteSeg[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as {
      name?: string;
      congestion?: string;
      lengthKm?: number;
    }[];
    return Array.isArray(parsed)
      ? parsed.map((s) => ({
          name: String(s?.name ?? "Segment"),
          congestion: String(s?.congestion ?? "MODERATE"),
          lengthKm: Number(s?.lengthKm ?? 0),
        }))
      : [];
  } catch {
    return [];
  }
}

/** Comma list → trimmed chips ("Defibrillator, Oxygen" → ["Defibrillator","Oxygen"]). */
function parseList(s?: string | null): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Next "KA-01-UAR-10x" style code from the current roster. */
function suggestCode(existing: { code: string }[]): string {
  let max = 100;
  for (const a of existing) {
    const m = /UAR-0*(\d+)/.exec(a.code ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `KA-01-UAR-${max + 1}`;
}

function collectErrors(
  ...pairs: [string, string | null][]
): RuleErr | null {
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

function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* ------------------------- small presentational bits ----------------------- */

function MethodChip({ method }: { method: string }) {
  return (
    <StatusBadge
      status={method}
      tone="neutral"
      className={cn("font-mono text-[11px]", METHOD_CHIP[method])}
    >
      {METHOD_LABEL[method] ?? method}
    </StatusBadge>
  );
}

function CongestionChip({ level }: { level: string }) {
  return (
    <StatusBadge
      status={level}
      tone={CONGESTION_TONE[level] ?? "neutral"}
    >
      {titleCase(level)}
    </StatusBadge>
  );
}

/** The fallback chain — V2X_5G → CELL_BROADCAST → BLE_MESH → FM_RDS → SIREN. */
function MethodChainStrip({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      aria-label="Alert fallback chain: V2X 5G, cell broadcast, BLE mesh, FM RDS, siren"
    >
      {METHODS.map((m, i) => (
        <Fragment key={m}>
          {i > 0 && (
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
              METHOD_CHIP[m]
            )}
          >
            {METHOD_LABEL[m]}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** Visual route timeline with congestion chips per segment. */
function RouteTimeline({ route }: { route: RouteSeg[] }) {
  if (route.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Route is generated when the mission is dispatched.
      </p>
    );
  }
  const totalKm = route.reduce((s, x) => s + (x.lengthKm || 0), 0);
  return (
    <div>
      <ol className="relative flex flex-col">
        {route.map((seg, i) => (
          <li
            key={`${seg.name}-${i}`}
            className="relative flex items-start gap-3 pb-4 last:pb-0"
          >
            {i < route.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[9px] top-5 h-[calc(100%-0.75rem)] w-px bg-border"
              />
            )}
            <span
              aria-hidden="true"
              className="z-[1] mt-0.5 grid size-[19px] shrink-0 place-items-center rounded-full border-2 border-red-500/60 bg-card text-[9px] font-bold text-red-600 dark:text-red-400"
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {seg.name}
              </span>
              <span className="block text-xs text-muted-foreground">
                {seg.lengthKm} km
              </span>
            </span>
            <CongestionChip level={seg.congestion} />
          </li>
        ))}
      </ol>
      <p className="mt-3 border-t pt-2.5 text-xs text-muted-foreground">
        {route.length} segment{route.length === 1 ? "" : "s"} ·{" "}
        {totalKm.toFixed(1)} km planned corridor
      </p>
    </div>
  );
}

/** REQUESTED → DISPATCHED → EN_ROUTE → ARRIVED → COMPLETED (CANCELLED side-state). */
function StatusStepper({ status }: { status: string }) {
  const cancelled = status === "CANCELLED";
  const idx = MISSION_FLOW.indexOf(status as (typeof MISSION_FLOW)[number]);
  return (
    <div>
      <ol
        className="flex items-start"
        aria-label={`Mission status: ${titleCase(status)}`}
      >
        {MISSION_FLOW.map((s, i) => {
          const done = !cancelled && idx > i;
          const current = !cancelled && i === idx;
          return (
            <li
              key={s}
              className="relative flex flex-1 flex-col items-center gap-1.5"
            >
              {i < MISSION_FLOW.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-1/2 top-[13px] h-0.5 w-full",
                    done ? "bg-emerald-500/70" : "bg-border"
                  )}
                />
              )}
              <span
                aria-current={current ? "step" : undefined}
                className={cn(
                  "relative z-[1] grid size-7 place-items-center rounded-full border-2 bg-card text-[10px] font-bold",
                  done && "border-emerald-500 bg-emerald-500 text-white",
                  current &&
                    "border-red-500 bg-red-500/10 text-red-600 dark:text-red-400",
                  !done &&
                    !current &&
                    "border-border text-muted-foreground"
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span
                className={cn(
                  "px-0.5 text-center text-[10px] font-semibold uppercase tracking-wide",
                  current ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {MISSION_STEP_LABEL[s]}
              </span>
            </li>
          );
        })}
      </ol>
      {cancelled && (
        <div
          role="status"
          className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-400"
        >
          <Ban className="size-3.5" aria-hidden="true" />
          Mission cancelled — the green corridor was disarmed and the unit
          released.
        </div>
      )}
      {!cancelled && (
        <p className="mt-3 text-xs text-muted-foreground">
          Step {idx + 1} of {MISSION_FLOW.length} · progress{" "}
          {MISSION_PROGRESS[status] ?? 0}%
        </p>
      )}
    </div>
  );
}

/** Corridor-event feed rows (segment, method, congestion, vehicles, saved, note, when). */
function EventFeed({
  events,
  loading,
  emptyHint,
}: {
  events: CorridorEventRow[];
  loading: boolean;
  emptyHint: string;
}) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyHint}</p>;
  }
  return (
    <ol
      className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin"
      aria-label="Corridor events feed"
    >
      {events.map((ev) => (
        <li key={ev.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <MethodChip method={ev.method} />
            <CongestionChip level={ev.congestion} />
            <span className="ml-auto text-xs text-muted-foreground">
              {timeAgo(ev.createdAt)}
            </span>
          </div>
          <p className="mt-1.5 text-sm font-medium">{ev.segment}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatNumber(ev.vehiclesAlerted)} vehicles alerted ·{" "}
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {formatDuration(ev.timeSavedSec)} saved
            </span>
          </p>
          {ev.note && (
            <p className="mt-1 text-xs italic text-muted-foreground">
              {ev.note}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Free-text base with MDM CITY suggestions (datalist = options + custom). */
function BaseField({
  value,
  onChange,
  error,
  cities,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  cities: string[];
}) {
  const id = useId();
  const listId = `${id}-cities`;
  return (
    <Field
      label="Base"
      required
      error={error}
      htmlFor={id}
      hint="Pick a city or type the exact base / station."
    >
      <Input
        id={id}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Hebbal station, Bengaluru"
        aria-invalid={!!error}
        className={cn(error && "border-destructive focus-visible:ring-destructive")}
      />
      <datalist id={listId}>
        {cities.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </Field>
  );
}

/* ---------------------------------- view ----------------------------------- */

export default function AmbulanceView() {
  const [ambulances, setAmbulances] = useState<Ambulance[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [events, setEvents] = useState<CorridorEventRow[]>([]);
  const [stats, setStats] = useState<CorridorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    try {
      const [amb, mis, ev, st] = await Promise.all([
        get<Ambulance[]>("/api/ambulances"),
        get<Mission[]>("/api/missions?limit=300"),
        get<CorridorEventRow[]>("/api/corridor-events?limit=300"),
        get<CorridorStats>("/api/corridor-stats"),
      ]);
      setAmbulances(Array.isArray(amb) ? amb : []);
      setMissions(Array.isArray(mis) ? mis : []);
      setEvents(Array.isArray(ev) ? ev : []);
      setStats(st ?? null);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to load ambulance module"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(reloadKey === 0);
  }, [load, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ambulance & Green Corridor"
        description="Fleet roster, emergency missions, the V2X alert log and corridor analytics."
        icon={<AmbulanceIcon className="size-5" aria-hidden="true" />}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            aria-label="Refresh ambulance data"
          >
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />
      <Tabs defaultValue="fleet" className="space-y-4">
        <TabsList aria-label="Ambulance module sections">
          <TabsTrigger value="fleet">Fleet</TabsTrigger>
          <TabsTrigger value="missions">Missions</TabsTrigger>
          <TabsTrigger value="corridor">Corridor Events</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="fleet" className="space-y-4">
          <FleetTab
            ambulances={ambulances}
            missions={missions}
            loading={loading}
            refresh={refresh}
          />
        </TabsContent>
        <TabsContent value="missions" className="space-y-4">
          <MissionsTab
            missions={missions}
            ambulances={ambulances}
            events={events}
            loading={loading}
            refresh={refresh}
          />
        </TabsContent>
        <TabsContent value="corridor" className="space-y-4">
          <CorridorTab events={events} loading={loading} />
        </TabsContent>
        <TabsContent value="analytics" className="space-y-4">
          <AnalyticsTab stats={stats} loading={loading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ================================ FLEET TAB ================================ */

const fleetCsv: CsvColumn<Ambulance>[] = [
  { header: "Code", value: (a) => a.code },
  { header: "Type", value: (a) => a.type },
  { header: "Status", value: (a) => a.status },
  { header: "Base", value: (a) => a.base },
  { header: "Driver", value: (a) => a.driverName },
  { header: "Driver phone", value: (a) => a.driverPhone ?? "" },
  { header: "Crew", value: (a) => a.crew ?? "" },
  { header: "Equipment", value: (a) => a.equipment ?? "" },
];

function FleetTab({
  ambulances,
  missions,
  loading,
  refresh,
}: {
  ambulances: Ambulance[];
  missions: Mission[];
  loading: boolean;
  refresh: () => void;
}) {
  const [q, setQ] = useState("");
  const [view, setView] = useViewPref("ambulance-fleet");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /* form */
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AmbForm>(EMPTY_AMB_FORM);
  const [initialForm, setInitialForm] = useState<AmbForm>(EMPTY_AMB_FORM);
  const [errors, setErrors] = useState<RuleErr>({});
  const [saving, setSaving] = useState(false);

  /* delete + detail */
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const typeOptions = useMasters("AMBULANCE_TYPE");
  const cityOptions = useMasters("CITY");

  const editing = useMemo(
    () => ambulances.find((a) => a.id === editingId) ?? null,
    [ambulances, editingId]
  );
  const deleteTarget = useMemo(
    () => ambulances.find((a) => a.id === deleteId) ?? null,
    [ambulances, deleteId]
  );
  const detail = useMemo(
    () => ambulances.find((a) => a.id === detailId) ?? null,
    [ambulances, detailId]
  );

  /* per-unit service record computed from the missions list */
  const service = useMemo(() => {
    const map = new Map<
      string,
      { run: number; completed: number; last?: string; savedSec: number }
    >();
    for (const m of missions) {
      if (!m.ambulanceId) continue;
      const cur = map.get(m.ambulanceId) ?? {
        run: 0,
        completed: 0,
        savedSec: 0,
      };
      cur.run += 1;
      if (m.status === "COMPLETED") cur.completed += 1;
      cur.savedSec += m.timeSavedSec ?? 0;
      if (m.createdAt && (!cur.last || new Date(m.createdAt) > new Date(cur.last)))
        cur.last = m.createdAt;
      map.set(m.ambulanceId, cur);
    }
    return map;
  }, [missions]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ambulances;
    return ambulances.filter((a) =>
      `${a.code} ${a.base} ${a.driverName} ${a.type} ${a.status}`
        .toLowerCase()
        .includes(needle)
    );
  }, [ambulances, q]);

  const safePage = Math.min(page, pageCount(filtered.length, pageSize));
  const pageRows = useMemo(
    () => paginate(filtered, safePage, pageSize),
    [filtered, safePage, pageSize]
  );

  const counts = useMemo(
    () => ({
      total: ambulances.length,
      available: ambulances.filter((a) => a.status === "AVAILABLE").length,
      onMission: ambulances.filter((a) => a.status === "ON_MISSION").length,
      maintenance: ambulances.filter((a) => a.status === "MAINTENANCE").length,
    }),
    [ambulances]
  );

  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  /* ------------------------------- actions ------------------------------- */

  const openCreate = () => {
    setEditingId(null);
    const f = { ...EMPTY_AMB_FORM, code: suggestCode(ambulances) };
    setForm(f);
    setInitialForm(f);
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (a: Ambulance) => {
    setEditingId(a.id);
    const f: AmbForm = {
      code: a.code ?? "",
      type: a.type ?? "BLS",
      status: a.status ?? "AVAILABLE",
      base: a.base ?? "",
      driverName: a.driverName ?? "",
      driverPhone: a.driverPhone ?? "",
      crew: a.crew ?? "",
      equipment: a.equipment ?? "",
    };
    setForm(f);
    setInitialForm(f);
    setErrors({});
    setFormOpen(true);
  };

  const save = async () => {
    const errs = collectErrors(
      ["code", required("Ambulance code")(form.code)],
      ["base", required("Base location")(form.base)],
      ["driverName", required("Driver name")(form.driverName)],
      ["driverPhone", phoneRule(true)(form.driverPhone)]
    );
    if (errs) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const body = {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        status: form.status,
        base: form.base.trim(),
        driverName: form.driverName.trim(),
        driverPhone: form.driverPhone.trim() || undefined,
        crew: form.crew.trim() || undefined,
        equipment: form.equipment.trim() || undefined,
      };
      if (editing) {
        await patch(`/api/ambulances/${editing.id}`, body);
        toast.success(`Ambulance ${body.code} updated`);
      } else {
        await post("/api/ambulances", body);
        toast.success(`Ambulance ${body.code} added to the fleet`);
      }
      setFormOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del(`/api/ambulances/${deleteTarget.id}`);
      toast.success(`Ambulance ${deleteTarget.code} removed`);
      setDeleteId(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  /* ------------------------------- renders ------------------------------- */

  const fleetColumns: DataTableColumn<Ambulance>[] = [
    { key: "code", header: "Code", mono: true },
    { key: "type", header: "Type", hideBelow: "md" },
    { key: "base", header: "Base", hideBelow: "sm" },
    { key: "driver", header: "Driver" },
    { key: "status", header: "Status" },
    { key: "missions", header: "Missions", align: "right", hideBelow: "lg" },
    { key: "actions", header: "Actions", align: "right" },
  ];

  const rowActions = (a: Ambulance) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-11 md:size-8"
          aria-label={`Actions for ambulance ${a.code}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => setDetailId(a.id)}>
          <Eye className="size-4" aria-hidden="true" /> View details
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openEdit(a)}>
          <Pencil className="size-4" aria-hidden="true" /> Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-600 focus:text-red-700 dark:text-red-400"
          onSelect={() => setDeleteId(a.id)}
        >
          <Trash2 className="size-4" aria-hidden="true" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const typeBadge = (a: Ambulance) => (
    <Badge
      variant="outline"
      className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400"
      title={labelOf(typeOptions.options, a.type)}
    >
      {a.type}
    </Badge>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Fleet size"
          value={counts.total}
          accent="teal"
          icon={<AmbulanceIcon className="size-5" aria-hidden="true" />}
          loading={loading}
        />
        <StatCard
          label="Available"
          value={counts.available}
          accent="emerald"
          icon={<CheckCircle2 className="size-5" aria-hidden="true" />}
          hint={
            counts.total
              ? `${Math.round((counts.available / counts.total) * 100)}% of the roster`
              : undefined
          }
          loading={loading}
        />
        <StatCard
          label="On mission"
          value={counts.onMission}
          accent="red"
          icon={<Siren className="size-5" aria-hidden="true" />}
          loading={loading}
        />
        <StatCard
          label="Maintenance"
          value={counts.maintenance}
          accent="amber"
          icon={<Waypoints className="size-5" aria-hidden="true" />}
          loading={loading}
        />
      </div>

      <SectionCard
        title="Fleet"
        description="Ambulances on roster — BLS, ALS, PTV and neonatal units."
        icon={<AmbulanceIcon className="size-4" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="Search code, base, driver…"
                className="h-9 w-full pl-8 sm:w-48"
                aria-label="Search ambulances"
              />
            </div>
            <ViewSwitcher value={view} onChange={setView} />
            <ExportMenu
              columns={fleetCsv}
              rows={filtered}
              filename="uar-ambulance-fleet"
              disabled={filtered.length === 0}
            />
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" /> Ambulance
            </Button>
          </div>
        }
      >
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<AmbulanceIcon className="size-8" aria-hidden="true" />}
            title={
              ambulances.length === 0
                ? "No ambulances on the roster"
                : "No ambulances match your search"
            }
            hint={
              ambulances.length === 0
                ? "Add your first ambulance so missions can be dispatched."
                : "Try a different search term."
            }
          >
            {ambulances.length === 0 ? (
              <Button variant="outline" onClick={openCreate}>
                <Plus className="size-4" aria-hidden="true" /> Add ambulance
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => setQ("")}
                aria-label="Clear search"
              >
                <RefreshCw className="size-4" aria-hidden="true" /> Clear search
              </Button>
            )}
          </EmptyState>
        ) : view === "table" ? (
          <DataTable
            columns={fleetColumns}
            rows={pageRows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setDetailId(r.id)}
            height="fill"
            fillOffset={330}
            page={safePage}
            pages={pageCount(filtered.length, pageSize)}
            total={filtered.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
            itemLabel="ambulances"
          >
            {(row, col) => {
              switch (col.key) {
                case "code":
                  return <span className="font-semibold">{row.code}</span>;
                case "type":
                  return typeBadge(row);
                case "base":
                  return (
                    <span className="text-muted-foreground">{row.base}</span>
                  );
                case "driver":
                  return (
                    <span>
                      {row.driverName}
                      {row.driverPhone ? (
                        <span className="block text-xs text-muted-foreground">
                          {row.driverPhone}
                        </span>
                      ) : null}
                    </span>
                  );
                case "status":
                  return <StatusBadge status={row.status} />;
                case "missions":
                  return (
                    <span className="tabular-nums">
                      {service.get(row.id)?.run ?? 0}
                    </span>
                  );
                case "actions":
                  return <div className="flex justify-end">{rowActions(row)}</div>;
                default:
                  return null;
              }
            }}
          </DataTable>
        ) : view === "grid" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {pageRows.map((a) => (
                <article
                  key={a.id}
                  className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40"
                >
                  <button
                    type="button"
                    onClick={() => setDetailId(a.id)}
                    className="flex items-start justify-between gap-2 text-left"
                    aria-label={`View details of ambulance ${a.code}`}
                  >
                    <span className="flex min-w-0 items-start gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                      >
                        <AmbulanceIcon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-sm font-semibold">
                          {a.code}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {a.base}
                        </span>
                      </span>
                    </span>
                    <StatusBadge status={a.status} />
                  </button>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {typeBadge(a)}
                    <span className="truncate">Driver · {a.driverName}</span>
                    <span className="ml-auto tabular-nums">
                      {service.get(a.id)?.run ?? 0} mission
                      {(service.get(a.id)?.run ?? 0) === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-auto flex gap-0.5 border-t pt-3">
                    {rowActions(a)}
                  </div>
                </article>
              ))}
            </div>
            <PaginationBar
              page={safePage}
              pages={pageCount(filtered.length, pageSize)}
              total={filtered.length}
              onPage={setPage}
              itemLabel="ambulances"
              className="mt-3"
            />
          </>
        ) : (
          <>
            <ul className="space-y-2" aria-label="Ambulances list">
              {pageRows.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => setDetailId(a.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left"
                    aria-label={`View ambulance ${a.code}`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                    >
                      <AmbulanceIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm font-semibold">
                        {a.code}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {a.base} · {a.driverName}
                      </span>
                    </span>
                    <StatusBadge status={a.status} className="shrink-0" />
                  </button>
                  <div className="flex shrink-0 gap-0.5">{rowActions(a)}</div>
                </li>
              ))}
            </ul>
            <PaginationBar
              page={safePage}
              pages={pageCount(filtered.length, pageSize)}
              total={filtered.length}
              onPage={setPage}
              itemLabel="ambulances"
              className="mt-3"
            />
          </>
        )}
      </SectionCard>

      {/* --------------------------- ambulance form --------------------------- */}
      <FormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? `Edit ambulance ${editing.code}` : "Add ambulance"}
        description="Roster entry for the emergency fleet — every field is editable and persisted."
        submitLabel={editing ? "Save changes" : "Add ambulance"}
        onSubmit={save}
        loading={saving}
        dirty={dirty}
        size="md"
      >
        <FormSection title="Unit">
          <div className="flex items-end gap-2">
            <TextField
              label="Code"
              required
              value={form.code}
              onChange={(v) => setForm({ ...form, code: v.toUpperCase() })}
              placeholder="KA-01-UAR-106"
              hint="Format: KA-01-UAR-10x (state-district-UAR-unit)."
              error={errors.code}
              className="flex-1 font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mb-5 h-9 shrink-0"
              onClick={() =>
                setForm((f) => ({ ...f, code: suggestCode(ambulances) }))
              }
              aria-label="Suggest the next free ambulance code"
            >
              <Sparkles className="size-4" aria-hidden="true" /> Suggest
            </Button>
          </div>
          <FieldGrid>
            <SelectField
              label="Type"
              required
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v })}
              options={typeOptions.options}
            />
            <SelectField
              label="Status"
              required
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
              options={STATUS_OPTIONS}
            />
          </FieldGrid>
          <BaseField
            value={form.base}
            onChange={(v) => setForm({ ...form, base: v })}
            error={errors.base}
            cities={cityOptions.options.map((o) => o.value)}
          />
        </FormSection>

        <FormSection title="Driver">
          <FieldGrid>
            <TextField
              label="Driver name"
              required
              value={form.driverName}
              onChange={(v) => setForm({ ...form, driverName: v })}
              placeholder="Manoj Kumar"
              error={errors.driverName}
            />
            <TextField
              label="Driver phone"
              value={form.driverPhone}
              onChange={(v) => setForm({ ...form, driverPhone: v })}
              placeholder="9876543210"
              inputMode="tel"
              error={errors.driverPhone}
            />
          </FieldGrid>
        </FormSection>

        <FormSection
          title="Crew & equipment"
          description="Comma-separated lists — kept on the roster for dispatch context."
        >
          <TextField
            label="Crew"
            value={form.crew}
            onChange={(v) => setForm({ ...form, crew: v })}
            placeholder="Paramedic: Sunita, EMT: Rahul"
            hint="Separate crew members with commas."
          />
          <TextField
            label="Equipment"
            value={form.equipment}
            onChange={(v) => setForm({ ...form, equipment: v })}
            placeholder="Defibrillator, Oxygen, Stretcher, Ventilator"
            hint="Separate items with commas."
          />
        </FormSection>
      </FormSheet>

      {/* -------------------------- ambulance detail -------------------------- */}
      <DetailSheet
        open={!!detail}
        onOpenChange={(o) => !o && setDetailId(null)}
        eyebrow="Fleet · Ambulance & Green Corridor"
        title={detail?.code ?? ""}
        description={
          detail
            ? `${labelOf(typeOptions.options, detail.type)} · ${detail.base}`
            : undefined
        }
        status={detail ? <StatusBadge status={detail.status} /> : undefined}
        footer={
          detail ? (
            <div className="flex w-full flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => openEdit(detail)}>
                <Pencil className="size-4" aria-hidden="true" /> Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                onClick={() => setDeleteId(detail.id)}
              >
                <Trash2 className="size-4" aria-hidden="true" /> Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setDetailId(null)}
              >
                Close
              </Button>
            </div>
          ) : undefined
        }
      >
        {detail && (
          <>
            <DetailSection title="Roster">
              <DetailGrid cols={2}>
                <DataField label="Code" value={detail.code} mono />
                <DataField
                  label="Type"
                  value={labelOf(typeOptions.options, detail.type)}
                />
                <DataField label="Base" value={detail.base} />
                <DataField
                  label="Status"
                  value={<StatusBadge status={detail.status} />}
                />
                <DataField label="Driver" value={detail.driverName} />
                <DataField
                  label="Driver phone"
                  value={detail.driverPhone ?? undefined}
                  mono
                  copy
                />
              </DetailGrid>
            </DetailSection>

            <DetailSection
              title="Crew & equipment"
              description="Parsed from the comma-separated roster lists."
            >
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Crew members
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {parseList(detail.crew).length === 0 ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : (
                      parseList(detail.crew).map((c) => (
                        <Badge key={c} variant="outline" className="gap-1">
                          <Users className="size-3" aria-hidden="true" />
                          {c}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Equipment on board
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {parseList(detail.equipment).length === 0 ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : (
                      parseList(detail.equipment).map((eq) => (
                        <Badge key={eq} variant="outline">
                          {eq}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </DetailSection>

            <DetailSection
              title="Service record"
              description="Computed from this unit's mission history."
            >
              <DetailGrid cols={4}>
                <DataField
                  label="Missions run"
                  value={formatNumber(service.get(detail.id)?.run ?? 0)}
                />
                <DataField
                  label="Completed"
                  value={formatNumber(service.get(detail.id)?.completed ?? 0)}
                />
                <DataField
                  label="Last mission"
                  value={formatDate(service.get(detail.id)?.last)}
                />
                <DataField
                  label="Time saved attributed"
                  value={formatDuration(service.get(detail.id)?.savedSec ?? 0)}
                />
              </DetailGrid>
            </DetailSection>

            <DetailSection
              title="Mission history"
              description="Recent missions served by this unit"
            >
              {missions.filter((m) => m.ambulanceId === detail.id).length ===
              0 ? (
                <EmptyState
                  icon={<Route className="size-6" aria-hidden="true" />}
                  title="No missions yet"
                  hint="This unit hasn't been dispatched recently."
                />
              ) : (
                <ul
                  className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin"
                  aria-label="Missions served by this ambulance"
                >
                  {missions
                    .filter((m) => m.ambulanceId === detail.id)
                    .map((m) => (
                      <li key={m.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold">
                            {m.requestRef}
                          </span>
                          <StatusBadge status={m.status} className="ml-auto" />
                        </div>
                        <p className="mt-1 flex items-center gap-1 truncate text-xs">
                          {m.patientName} · {m.pickup}
                          <ArrowRight
                            className="size-3 shrink-0"
                            aria-hidden="true"
                          />
                          {m.destination}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {m.createdAt ? formatDateTime(m.createdAt) : "—"} ·{" "}
                          {m.progress}% ·{" "}
                          {formatDuration(m.timeSavedSec)} saved
                        </p>
                      </li>
                    ))}
                </ul>
              )}
            </DetailSection>
          </>
        )}
      </DetailSheet>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Remove ambulance?"
        recordName={
          deleteTarget ? `${deleteTarget.code} · ${deleteTarget.base}` : null
        }
        description="The unit is taken off the roster permanently. Missions it served keep their history."
        confirmLabel="Delete ambulance"
        loading={deleting}
        onConfirm={remove}
      />
    </div>
  );
}

/* ============================== MISSIONS TAB =============================== */

const missionsCsv: CsvColumn<Mission>[] = [
  { header: "Request ref", value: (m) => m.requestRef },
  { header: "Patient", value: (m) => m.patientName },
  { header: "Contact", value: (m) => m.contact },
  { header: "Emergency type", value: (m) => m.emergencyType },
  { header: "Priority", value: (m) => m.priority },
  { header: "Pickup", value: (m) => m.pickup },
  { header: "Destination", value: (m) => m.destination },
  { header: "Ambulance", value: (m) => m.ambulance?.code ?? "" },
  { header: "ETA (min)", value: (m) => m.etaMin ?? "" },
  { header: "Status", value: (m) => m.status },
  { header: "Progress", value: (m) => m.progress },
  { header: "Corridor active", value: (m) => (m.corridorActive ? "yes" : "no") },
  { header: "Vehicles alerted", value: (m) => m.vehiclesAlerted },
  { header: "Time saved (sec)", value: (m) => m.timeSavedSec },
  { header: "Created", value: (m) => m.createdAt ?? "" },
];

function MissionsTab({
  missions,
  ambulances,
  events,
  loading,
  refresh,
}: {
  missions: Mission[];
  ambulances: Ambulance[];
  events: CorridorEventRow[];
  loading: boolean;
  refresh: () => void;
}) {
  const [filter, setFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [view, setView] = useViewPref("ambulance-missions");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /* create + dispatch form */
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<MissionForm>(EMPTY_MISSION_FORM);
  const [initialForm, setInitialForm] =
    useState<MissionForm>(EMPTY_MISSION_FORM);
  const [missionAmbId, setMissionAmbId] = useState("");
  const [errors, setErrors] = useState<RuleErr>({});
  const [saving, setSaving] = useState(false);

  /* dispatch existing */
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [dispatchAmbId, setDispatchAmbId] = useState("");
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);

  /* cancel + status + detail */
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const { busyId, setBusyId } = useRowBusy();
  const [detailId, setDetailId] = useState<string | null>(null);

  const emergencyOptions = useMasters("EMERGENCY_TYPE");

  const dispatchTarget = useMemo(
    () => missions.find((m) => m.id === dispatchId) ?? null,
    [missions, dispatchId]
  );
  const cancelTarget = useMemo(
    () => missions.find((m) => m.id === cancelId) ?? null,
    [missions, cancelId]
  );
  const detail = useMemo(
    () => missions.find((m) => m.id === detailId) ?? null,
    [missions, detailId]
  );

  const filteredMissions = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return missions.filter((m) => {
      if (filter !== "ALL" && m.status !== filter) return false;
      if (needle) {
        const hay =
          `${m.requestRef} ${m.patientName} ${m.pickup} ${m.destination} ${m.ambulance?.code ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [missions, filter, q]);

  const safePage = Math.min(page, pageCount(filteredMissions.length, pageSize));
  const pageRows = useMemo(
    () => paginate(filteredMissions, safePage, pageSize),
    [filteredMissions, safePage, pageSize]
  );

  const availableAmbulances = useMemo(
    () => ambulances.filter((a) => a.status === "AVAILABLE"),
    [ambulances]
  );

  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  const detailEvents = useMemo(
    () => (detail ? events.filter((e) => e.missionId === detail.id) : []),
    [events, detail]
  );

  /* ------------------------------- actions ------------------------------- */

  const openCreate = () => {
    setForm(EMPTY_MISSION_FORM);
    setInitialForm(EMPTY_MISSION_FORM);
    setMissionAmbId("");
    setErrors({});
    setFormOpen(true);
  };

  const openDispatch = (m: Mission) => {
    setDispatchId(m.id);
    setDispatchAmbId("");
    setDispatchError(null);
  };

  const saveMission = async () => {
    const errs = collectErrors(
      ["patientName", required("Patient name")(form.patientName)],
      ["contact", phoneRule()(form.contact)],
      ["pickup", required("Pickup location")(form.pickup)],
      ["destination", required("Destination")(form.destination)]
    );
    if (errs) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const created = await post<{ id: string; requestRef: string }>(
        "/api/missions",
        {
          patientName: form.patientName.trim(),
          contact: form.contact.trim(),
          emergencyType: form.emergencyType,
          priority: form.priority,
          pickup: form.pickup.trim(),
          destination: form.destination.trim(),
          route: form.route
            .filter((s) => s.name.trim())
            .map((s) => ({
              name: s.name.trim(),
              congestion: s.congestion,
              lengthKm: Number(s.lengthKm) || 0,
            })),
        }
      );
      if (missionAmbId) {
        await patch(`/api/missions/${created.id}`, {
          action: "dispatch",
          ambulanceId: missionAmbId,
        });
        const amb = ambulances.find((a) => a.id === missionAmbId);
        toast.success(
          `${created.requestRef} created & dispatched with ${amb?.code ?? "ambulance"} — green corridor armed`
        );
      } else {
        toast.success(`${created.requestRef} logged — awaiting dispatch`);
      }
      setFormOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const dispatchExisting = async () => {
    if (!dispatchTarget) return;
    if (!dispatchAmbId) {
      setDispatchError("Select an available ambulance");
      return;
    }
    setDispatching(true);
    try {
      await patch(`/api/missions/${dispatchTarget.id}`, {
        action: "dispatch",
        ambulanceId: dispatchAmbId,
      });
      const amb = ambulances.find((a) => a.id === dispatchAmbId);
      toast.success(
        `${dispatchTarget.requestRef} dispatched with ${amb?.code ?? "ambulance"} — green corridor armed`
      );
      setDispatchId(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dispatch failed");
    } finally {
      setDispatching(false);
    }
  };

  /** Status-stepper advance: PATCH {status} — server auto-sets progress. */
  const setStatus = useCallback(
    async (m: Mission, status: string, msg?: string) => {
      setBusyId(m.id);
      try {
        await patch(`/api/missions/${m.id}`, { status });
        toast.success(msg ?? `${m.requestRef} → ${titleCase(status)}`);
        refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
      } finally {
        setBusyId(null);
      }
    },
    [refresh]
  );

  const cancelMission = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await patch(`/api/missions/${cancelTarget.id}`, { status: "CANCELLED" });
      toast.success(
        `${cancelTarget.requestRef} cancelled — corridor disarmed`
      );
      setCancelId(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  };

  /** Primary next-step action for a mission. */
  const primaryFor = (
    m: Mission
  ): { label: string; run: () => void; className?: string } | null => {
    if (m.status === "REQUESTED")
      return { label: "Dispatch", run: () => openDispatch(m) };
    const nxt = MISSION_NEXT_STEP[m.status];
    if (nxt) {
      const msg = `${m.requestRef} → ${titleCase(nxt.status)} · progress ${MISSION_PROGRESS[nxt.status] ?? 100}%`;
      return {
        label: nxt.label,
        run: () => void setStatus(m, nxt.status, msg),
        ...(nxt.status === "COMPLETED"
          ? { className: "bg-emerald-600 text-white hover:bg-emerald-700" }
          : {}),
      };
    }
    return null;
  };

  /* ------------------------------- renders ------------------------------- */

  const missionColumns: DataTableColumn<Mission>[] = [
    { key: "ref", header: "Ref", mono: true },
    { key: "patient", header: "Patient" },
    { key: "type", header: "Emergency", hideBelow: "md" },
    { key: "route", header: "Route", hideBelow: "lg" },
    { key: "ambulance", header: "Ambulance", hideBelow: "sm" },
    { key: "eta", header: "ETA", align: "right", hideBelow: "lg" },
    { key: "progress", header: "Progress", hideBelow: "md" },
    { key: "status", header: "Status" },
    { key: "actions", header: "Actions", align: "right" },
  ];

  const missionRowActions = (m: Mission) => {
    const primary = primaryFor(m);
    const closed = ["COMPLETED", "CANCELLED"].includes(m.status);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-11 md:size-8"
            aria-label={`Actions for mission ${m.requestRef}`}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem onSelect={() => setDetailId(m.id)}>
            <Eye className="size-4" aria-hidden="true" /> View details
          </DropdownMenuItem>
          {primary && (
            <DropdownMenuItem onSelect={primary.run}>
              <Navigation className="size-4" aria-hidden="true" />{" "}
              {primary.label}
            </DropdownMenuItem>
          )}
          {!closed && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 focus:text-red-700 dark:text-red-400"
                onSelect={() => setCancelId(m.id)}
              >
                <Ban className="size-4" aria-hidden="true" /> Cancel mission
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const missionCard = (m: Mission) => {
    const primary = primaryFor(m);
    const closed = ["COMPLETED", "CANCELLED"].includes(m.status);
    return (
      <article
        key={m.id}
        className="rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDetailId(m.id)}
            className="font-mono text-sm font-semibold hover:underline"
            aria-label={`View mission ${m.requestRef}`}
          >
            {m.requestRef}
          </button>
          <StatusBadge
            status={m.priority}
            tone={PRIORITY_TONE[m.priority] ?? "neutral"}
          />
          <StatusBadge status={m.status} />
          {m.corridorActive && (
            <Badge
              variant="outline"
              className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
            >
              <Zap className="size-3" aria-hidden="true" /> Corridor active
            </Badge>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {m.ambulance
              ? `${m.ambulance.code} · ${m.ambulance.driverName}`
              : "Unassigned"}
          </span>
        </div>
        <p className="mt-2 text-sm font-medium">
          {m.patientName} ·{" "}
          {labelOf(emergencyOptions.options, m.emergencyType)}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {m.pickup}{" "}
          <ArrowRight className="inline size-3" aria-hidden="true" />{" "}
          {m.destination}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Progress
            value={m.progress}
            className="h-2 flex-1 [&>div]:bg-red-500"
            aria-label={`Mission progress ${m.progress}%`}
          />
          <span className="text-xs font-medium tabular-nums">
            {m.progress}%
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setDetailId(m.id)}>
            View
          </Button>
          {primary && (
            <Button
              size="sm"
              variant={primary.className ? "default" : "outline"}
              className={primary.className}
              onClick={primary.run}
              disabled={busyId !== null}
            >
              {primary.label}
            </Button>
          )}
          {!closed && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
              disabled={busyId !== null}
              onClick={() => setCancelId(m.id)}
              aria-label={`Cancel mission ${m.requestRef}`}
            >
              <Ban className="size-3.5" aria-hidden="true" /> Cancel
            </Button>
          )}
        </div>
      </article>
    );
  };

  const detailRoute = useMemo(() => parseRoute(detail?.route), [detail]);

  return (
    <div className="space-y-4">
      {/* status pill filters */}
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Filter missions by status"
      >
        {MISSION_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            aria-pressed={filter === f}
            className={cn(
              "min-h-9 rounded-full border px-3 text-xs font-semibold transition",
              filter === f
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {f === "ALL" ? "All" : titleCase(f)}
          </button>
        ))}
      </div>

      <SectionCard
        title="Emergency missions"
        description="Live green-corridor runs with congestion-aware alerts."
        icon={<Siren className="size-4" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="Search ref, patient, route…"
                className="h-9 w-full pl-8 sm:w-44"
                aria-label="Search missions"
              />
            </div>
            <ViewSwitcher
              value={view}
              onChange={setView}
              options={["table", "grid"]}
            />
            <ExportMenu
              columns={missionsCsv}
              rows={filteredMissions}
              filename="uar-missions"
              disabled={filteredMissions.length === 0}
            />
            <Button size="sm" onClick={openCreate}>
              <Siren className="size-4" aria-hidden="true" /> New mission
            </Button>
          </div>
        }
      >
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : filteredMissions.length === 0 ? (
          <EmptyState
            icon={<Route className="size-8" aria-hidden="true" />}
            title={
              missions.length === 0
                ? "No missions yet"
                : "No missions match this filter"
            }
            hint={
              missions.length === 0
                ? "Create a mission when an emergency request arrives, then dispatch the nearest ambulance."
                : "Try another status filter or search term."
            }
          >
            {missions.length === 0 ? (
              <Button onClick={openCreate}>
                <Siren className="size-4" aria-hidden="true" /> New mission
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setFilter("ALL");
                  setQ("");
                }}
              >
                <RefreshCw className="size-4" aria-hidden="true" /> Reset
                filters
              </Button>
            )}
          </EmptyState>
        ) : view === "table" ? (
          <DataTable
            columns={missionColumns}
            rows={pageRows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setDetailId(r.id)}
            height="fill"
            fillOffset={330}
            page={safePage}
            pages={pageCount(filteredMissions.length, pageSize)}
            total={filteredMissions.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
            itemLabel="missions"
          >
            {(row, col) => {
              switch (col.key) {
                case "ref":
                  return (
                    <span className="font-semibold">{row.requestRef}</span>
                  );
                case "patient":
                  return (
                    <span>
                      {row.patientName}
                      <span className="block text-xs text-muted-foreground">
                        {row.contact}
                      </span>
                    </span>
                  );
                case "type":
                  return (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className="border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
                      >
                        {EMERGENCY_SHORT[row.emergencyType] ??
                          titleCase(row.emergencyType)}
                      </Badge>
                      <StatusBadge
                        status={row.priority}
                        tone={PRIORITY_TONE[row.priority] ?? "neutral"}
                      />
                    </span>
                  );
                case "route":
                  return (
                    <span className="flex max-w-56 items-center gap-1 text-xs text-muted-foreground">
                      <span className="truncate">{row.pickup}</span>
                      <ArrowRight
                        className="size-3 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="truncate">{row.destination}</span>
                    </span>
                  );
                case "ambulance":
                  return (
                    <span className="font-mono text-xs">
                      {row.ambulance ? row.ambulance.code : "—"}
                    </span>
                  );
                case "eta":
                  return (
                    <span className="tabular-nums">
                      {row.etaMin ? `${row.etaMin} min` : "—"}
                    </span>
                  );
                case "progress":
                  return (
                    <span className="flex items-center gap-2">
                      <Progress
                        value={row.progress}
                        className="h-1.5 w-14 [&>div]:bg-red-500"
                        aria-label={`Mission progress ${row.progress}%`}
                      />
                      <span className="text-xs tabular-nums">
                        {row.progress}%
                      </span>
                    </span>
                  );
                case "status":
                  return (
                    <span className="flex items-center gap-1">
                      <StatusBadge status={row.status} />
                      {row.corridorActive && (
                        <span title="Green corridor active">
                          <Zap
                            className="size-3.5 text-red-600 dark:text-red-400"
                            aria-label="Green corridor active"
                          />
                        </span>
                      )}
                    </span>
                  );
                case "actions":
                  return (
                    <div className="flex justify-end">
                      {missionRowActions(row)}
                    </div>
                  );
                default:
                  return null;
              }
            }}
          </DataTable>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {pageRows.map(missionCard)}
            </div>
            <PaginationBar
              page={safePage}
              pages={pageCount(filteredMissions.length, pageSize)}
              total={filteredMissions.length}
              onPage={setPage}
              itemLabel="missions"
              className="mt-3"
            />
          </>
        )}
      </SectionCard>

      {/* ---------------------- create + dispatch sheet ---------------------- */}
      <FormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        title="New emergency mission"
        description="Log the request and optionally dispatch an ambulance — the green corridor arms on dispatch."
        submitLabel={missionAmbId ? "Create & dispatch" : "Create mission"}
        onSubmit={saveMission}
        loading={saving}
        dirty={dirty}
        size="xl"
      >
        <FormSection title="Patient">
          <FieldGrid>
            <TextField
              label="Patient name"
              required
              value={form.patientName}
              onChange={(v) => setForm({ ...form, patientName: v })}
              placeholder="Ramesh Gowda"
              error={errors.patientName}
            />
            <TextField
              label="Contact"
              required
              value={form.contact}
              onChange={(v) => setForm({ ...form, contact: v })}
              placeholder="9876543210"
              inputMode="tel"
              error={errors.contact}
            />
          </FieldGrid>
          <FieldGrid>
            <SelectField
              label="Emergency type"
              required
              value={form.emergencyType}
              onChange={(v) => setForm({ ...form, emergencyType: v })}
              options={emergencyOptions.options}
            />
            <SelectField
              label="Priority"
              required
              value={form.priority}
              onChange={(v) => setForm({ ...form, priority: v })}
              options={PRIORITY_OPTIONS}
            />
          </FieldGrid>
        </FormSection>

        <FormSection title="Route">
          <FieldGrid>
            <TextField
              label="Pickup"
              required
              value={form.pickup}
              onChange={(v) => setForm({ ...form, pickup: v })}
              placeholder="Sahakar Nagar, Bengaluru"
              error={errors.pickup}
            />
            <TextField
              label="Destination"
              required
              value={form.destination}
              onChange={(v) => setForm({ ...form, destination: v })}
              placeholder="Victoria Hospital"
              error={errors.destination}
            />
          </FieldGrid>
        </FormSection>

        <FormSection
          title="Planned route segments"
          description="Advisory — quick-add known bottlenecks or type custom segments. The corridor engine simulates live congestion on dispatch."
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {SEGMENT_POOL.filter(
              (name) => !form.route.some((s) => s.name === name)
            ).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    route: [
                      ...f.route,
                      { name, congestion: "MODERATE", lengthKm: "1.5" },
                    ],
                  }))
                }
                aria-label={`Quick add segment ${name}`}
                className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <Plus className="mr-0.5 inline size-3" aria-hidden="true" />{" "}
                {name}
              </button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  route: [
                    ...f.route,
                    { name: "", congestion: "MODERATE", lengthKm: "1" },
                  ],
                }))
              }
              aria-label="Add custom route segment"
            >
              <Plus className="size-3.5" aria-hidden="true" /> Custom segment
            </Button>
          </div>
          <div className="space-y-2">
            {form.route.map((seg, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_104px_76px_36px] items-center gap-2 sm:grid-cols-[1fr_140px_90px_40px]"
              >
                <Input
                  value={seg.name}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      route: f.route.map((s, j) =>
                        j === i ? { ...s, name: e.target.value } : s
                      ),
                    }))
                  }
                  placeholder="Segment name"
                  aria-label={`Segment ${i + 1} name`}
                />
                <Select
                  value={seg.congestion}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      route: f.route.map((s, j) =>
                        j === i ? { ...s, congestion: v } : s
                      ),
                    }))
                  }
                >
                  <SelectTrigger aria-label={`Segment ${i + 1} congestion`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONGESTION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={seg.lengthKm}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      route: f.route.map((s, j) =>
                        j === i ? { ...s, lengthKm: e.target.value } : s
                      ),
                    }))
                  }
                  aria-label={`Segment ${i + 1} length in kilometres`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      route: f.route.filter((_, j) => j !== i),
                    }))
                  }
                  aria-label={`Remove segment ${i + 1}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            {form.route.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No segments planned — quick-add above or let the corridor engine
                generate a route.
              </p>
            )}
          </div>
        </FormSection>

        <FormSection title="Dispatch">
          <SelectField
            label="Ambulance"
            value={missionAmbId}
            onChange={setMissionAmbId}
            options={availableAmbulances.map((a) => ({
              value: a.id,
              label: `${a.code} · ${a.type} · ${a.driverName}`,
            }))}
            placeholder="Leave empty — dispatch later"
            hint="Only AVAILABLE units are listed. Dispatching arms the green corridor immediately."
          />
          {availableAmbulances.length === 0 && (
            <p className="text-xs text-red-600 dark:text-red-400">
              No ambulances are currently available — the mission will be logged
              as REQUESTED.
            </p>
          )}
        </FormSection>
      </FormSheet>

      {/* ----------------------- dispatch existing sheet ---------------------- */}
      <FormSheet
        open={!!dispatchTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDispatchId(null);
            setDispatchError(null);
          }
        }}
        title={`Dispatch ${dispatchTarget?.requestRef ?? ""}`}
        description={
          dispatchTarget
            ? `${dispatchTarget.patientName} · ${dispatchTarget.pickup} → ${dispatchTarget.destination}. Only AVAILABLE ambulances can be dispatched; the corridor arms automatically.`
            : undefined
        }
        submitLabel="Dispatch"
        onSubmit={dispatchExisting}
        loading={dispatching}
        size="md"
      >
        <SelectField
          label="Ambulance"
          required
          value={dispatchAmbId}
          onChange={(v) => {
            setDispatchAmbId(v);
            setDispatchError(null);
          }}
          options={availableAmbulances.map((a) => ({
            value: a.id,
            label: `${a.code} · ${a.type} · ${a.driverName}`,
          }))}
          placeholder="Select an available ambulance"
          error={dispatchError}
        />
        {availableAmbulances.length === 0 && (
          <p className="text-xs text-red-600 dark:text-red-400">
            No ambulances are currently available. Free one up by completing a
            mission or add a unit in the Fleet tab.
          </p>
        )}
      </FormSheet>

      {/* --------------------------- mission detail --------------------------- */}
      <DetailSheet
        open={!!detail}
        onOpenChange={(o) => !o && setDetailId(null)}
        eyebrow="Emergency mission · Live tracking"
        title={detail?.requestRef ?? ""}
        description={
          detail
            ? `${detail.patientName} · ${detail.pickup} → ${detail.destination}`
            : undefined
        }
        status={
          detail ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={detail.priority} tone={PRIORITY_TONE[detail.priority] ?? "neutral"} />
              <StatusBadge status={detail.status} />
              {detail.corridorActive && (
                <Badge
                  variant="outline"
                  className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
                >
                  <Zap className="size-3 animate-pulse" aria-hidden="true" /> Corridor active
                </Badge>
              )}
            </span>
          ) : undefined
        }
        footer={
          detail ? (
            <MissionDetailFooter
              mission={detail}
              busy={busyId === detail.id}
              onDispatch={() => openDispatch(detail)}
              onAdvance={(status, msg) =>
                void setStatus(detail, status, msg)
              }
              onCancel={() => setCancelId(detail.id)}
            />
          ) : undefined
        }
      >
        {detail && (
          <Tabs defaultValue="overview" className="gap-5">
            <TabsList className="h-auto w-full flex-wrap justify-start">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="tracking">
                Live tracking
                {detail.corridorActive ? (
                  <span
                    aria-hidden="true"
                    className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-red-500"
                  />
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="corridor">
                Corridor
                <Badge variant="outline" className="ml-1.5 px-1.5 tabular-nums">
                  {detailEvents.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
            </TabsList>

            {/* ------------------------ OVERVIEW ------------------------ */}
            <TabsContent value="overview" className="space-y-6">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MiniStat label="Progress" value={`${detail.progress}%`} />
                <MiniStat
                  label="Vehicles alerted"
                  value={formatNumber(detail.vehiclesAlerted)}
                />
                <MiniStat label="Time saved" value={formatDuration(detail.timeSavedSec)} />
                <MiniStat label="ETA" value={detail.etaMin ? `${detail.etaMin} min` : "—"} />
              </div>

              <DetailSection title="Mission overview">
                <DetailGrid cols={3}>
                  <DataField label="Request ref" value={detail.requestRef} mono />
                  <DataField label="Patient" value={detail.patientName} />
                  <DataField label="Contact" value={detail.contact} mono copy />
                  <DataField
                    label="Emergency type"
                    value={labelOf(emergencyOptions.options, detail.emergencyType)}
                  />
                  <DataField
                    label="Priority"
                    value={
                      <StatusBadge
                        status={detail.priority}
                        tone={PRIORITY_TONE[detail.priority] ?? "neutral"}
                      />
                    }
                  />
                  <DataField
                    label="Ambulance"
                    value={
                      detail.ambulance
                        ? `${detail.ambulance.code} (${detail.ambulance.type}) · ${detail.ambulance.driverName}`
                        : "Unassigned"
                    }
                  />
                  <DataField
                    label="Pickup"
                    value={detail.pickup}
                    icon={<MapPin className="size-3" aria-hidden="true" />}
                  />
                  <DataField
                    label="Destination"
                    value={detail.destination}
                    icon={<Flag className="size-3" aria-hidden="true" />}
                  />
                  <DataField
                    label="Requested"
                    value={
                      detail.createdAt ? formatDateTime(detail.createdAt) : "—"
                    }
                  />
                </DetailGrid>
              </DetailSection>

              <DetailSection
                title="Status"
                description="Advance along the corridor — progress is set automatically per step."
              >
                <StatusStepper status={detail.status} />
                <div className="flex items-center gap-3">
                  <Progress
                    value={detail.progress}
                    className="h-2 flex-1 [&>div]:bg-red-500"
                    aria-label={`Mission progress ${detail.progress}%`}
                  />
                  <span className="text-xs font-medium tabular-nums">
                    {detail.progress}%
                  </span>
                </div>
              </DetailSection>
            </TabsContent>

            {/* ------------------------ LIVE TRACKING ------------------------ */}
            <TabsContent value="tracking" className="space-y-6">
              <DetailSection
                title="Route progress"
                description="Segment-by-segment congestion along the planned corridor."
              >
                <RouteTimeline route={detailRoute} />
              </DetailSection>

              <DetailSection
                title="Run telemetry"
                description="What the green corridor achieved on this run."
              >
                <DetailGrid cols={3}>
                  <DataField
                    label="Vehicles alerted"
                    value={formatNumber(detail.vehiclesAlerted)}
                    icon={<Radio className="size-3" aria-hidden="true" />}
                  />
                  <DataField
                    label="Time saved"
                    value={formatDuration(detail.timeSavedSec)}
                    icon={<Timer className="size-3" aria-hidden="true" />}
                  />
                  <DataField
                    label="Corridor"
                    value={
                      detail.corridorActive ? (
                        <span className="flex items-center gap-1.5 font-semibold text-red-600 dark:text-red-400">
                          <Zap className="size-3.5 animate-pulse" aria-hidden="true" />
                          ACTIVE
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Disarmed</span>
                      )
                    }
                  />
                  <DataField
                    label="ETA"
                    value={detail.etaMin ? `${detail.etaMin} min` : "—"}
                  />
                  <DataField
                    label="Route segments"
                    value={`${detailRoute.length} planned`}
                  />
                  <DataField
                    label="Alert events"
                    value={`${detailEvents.length} recorded`}
                  />
                </DetailGrid>
              </DetailSection>
            </TabsContent>

            {/* ------------------------ CORRIDOR ------------------------ */}
            <TabsContent value="corridor" className="space-y-6">
              <DetailSection
                title="Corridor events"
                description="Alert ladder per congested segment"
              >
                <EventFeed
                  events={detailEvents}
                  loading={false}
                  emptyHint="No corridor events yet — they are recorded when the mission is dispatched."
                />
              </DetailSection>

              <DetailSection
                title="Fallback chain"
                description="Higher layers fail over to the next; the siren is always the last resort."
              >
                <MethodChainStrip />
              </DetailSection>
            </TabsContent>

            {/* ------------------------ TIMELINE ------------------------ */}
            <TabsContent value="timeline" className="space-y-6">
              <DetailSection
                title="Mission timeline"
                description="From request to hand-off, reconstructed from status and event times."
              >
                <MissionTimeline mission={detail} events={detailEvents} />
              </DetailSection>
            </TabsContent>
          </Tabs>
        )}
      </DetailSheet>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelId(null)}
        title="Cancel mission?"
        recordName={
          cancelTarget
            ? `${cancelTarget.requestRef} · ${cancelTarget.patientName} · ${cancelTarget.pickup} → ${cancelTarget.destination}`
            : null
        }
        description="The mission will be cancelled and the green corridor disarmed. Any assigned ambulance returns to AVAILABLE."
        confirmLabel="Cancel mission"
        loading={cancelling}
        onConfirm={cancelMission}
      />

      {/* live region for screen readers */}
      <span className="sr-only" aria-live="polite">
        {loading ? "Loading missions" : `${filteredMissions.length} missions shown`}
      </span>
    </div>
  );
}

/** Sticky footer actions for the mission DetailSheet. */
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Mission timeline — reconstructed from the status step the mission has
 * reached plus the recorded corridor-event timestamps. Cheap (no extra API),
 * but reads as a genuine run log.
 */
function MissionTimeline({
  mission,
  events,
}: {
  mission: Mission;
  events: CorridorEventRow[];
}) {
  const idx = MISSION_FLOW.indexOf(mission.status as (typeof MISSION_FLOW)[number]);
  const cancelled = mission.status === "CANCELLED";

  const steps = MISSION_FLOW.map((s, i) => ({
    label: MISSION_STEP_LABEL[s],
    done: !cancelled && idx >= i,
    at:
      i === 0
        ? mission.createdAt
        : i <= idx
          ? events[i - 1]?.createdAt ?? null
          : null,
    detail:
      i === 0
        ? "Emergency call received — corridor request raised"
        : i === MISSION_FLOW.length - 1
          ? "Patient handed over — corridor disarmed"
          : undefined,
  }));

  return (
    <ol className="relative space-y-4 border-l-2 pl-5" aria-label="Mission timeline">
      {steps.map((s, i) => (
        <li key={s.label} className="relative">
          <span
            aria-hidden="true"
            className={cn(
              "absolute -left-[27px] top-1 flex size-3.5 items-center justify-center rounded-full border-2",
              s.done
                ? "border-emerald-500 bg-emerald-500"
                : "border-border bg-background"
            )}
          />
          <p
            className={cn(
              "text-sm font-medium",
              !s.done && "text-muted-foreground"
            )}
          >
            {s.label}
          </p>
          <p className="text-xs text-muted-foreground">
            {s.at ? formatDateTime(s.at) : s.done ? "Recorded" : "Pending"}
            {s.detail ? ` · ${s.detail}` : ""}
          </p>
          {i === 0 && events.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground/80">
              + {events.length} corridor alert{events.length === 1 ? "" : "s"} fired along the route
            </p>
          )}
        </li>
      ))}
      {cancelled && (
        <li className="relative">
          <span
            aria-hidden="true"
            className="absolute -left-[27px] top-1 flex size-3.5 items-center justify-center rounded-full border-2 border-rose-500 bg-rose-500"
          />
          <p className="text-sm font-medium text-rose-700 dark:text-rose-400">
            Cancelled
          </p>
          <p className="text-xs text-muted-foreground">
            Corridor disarmed; the unit returned to AVAILABLE
          </p>
        </li>
      )}
    </ol>
  );
}

/** Sticky footer actions for the mission DetailSheet. */
function MissionDetailFooter({
  mission,
  busy,
  onDispatch,
  onAdvance,
  onCancel,
}: {
  mission: Mission;
  busy: boolean;
  onDispatch: () => void;
  onAdvance: (status: string, msg?: string) => void;
  onCancel: () => void;
}) {
  const closed = ["COMPLETED", "CANCELLED"].includes(mission.status);
  const next = MISSION_NEXT_STEP[mission.status];
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {mission.status === "REQUESTED" && (
        <Button size="sm" onClick={onDispatch}>
          <AmbulanceIcon className="size-4" aria-hidden="true" /> Dispatch…
        </Button>
      )}
      {next && (
        <Button
          size="sm"
          variant={next.status === "COMPLETED" ? "default" : "outline"}
          className={
            next.status === "COMPLETED"
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : undefined
          }
          onClick={() =>
            onAdvance(
              next.status,
              `${mission.requestRef} → ${titleCase(next.status)} · progress ${MISSION_PROGRESS[next.status] ?? 100}%`
            )
          }
          disabled={busy}
        >
          {next.status === "EN_ROUTE" ? (
            <Navigation className="size-4" aria-hidden="true" />
          ) : next.status === "ARRIVED" ? (
            <MapPin className="size-4" aria-hidden="true" />
          ) : (
            <Flag className="size-4" aria-hidden="true" />
          )}
          {next.label}
        </Button>
      )}
      {!closed ? (
        <Button
          size="sm"
          variant="outline"
          className="ml-auto text-red-600 hover:bg-red-500/10 dark:text-red-400"
          onClick={onCancel}
          aria-label={`Cancel mission ${mission.requestRef}`}
        >
          <Ban className="size-4" aria-hidden="true" /> Cancel mission
        </Button>
      ) : (
        <span className="ml-auto text-xs text-muted-foreground">
          {mission.status === "COMPLETED"
            ? "Mission completed — the unit was released back to AVAILABLE."
            : "Mission cancelled."}
        </span>
      )}
    </div>
  );
}

/* ============================== CORRIDOR TAB =============================== */

const corridorCsv: CsvColumn<CorridorEventRow>[] = [
  { header: "Time", value: (e) => (e.createdAt ? new Date(e.createdAt).toISOString() : "") },
  { header: "Mission ref", value: (e) => e.mission?.requestRef ?? "" },
  { header: "Segment", value: (e) => e.segment },
  { header: "Method", value: (e) => e.method },
  { header: "Congestion", value: (e) => e.congestion },
  { header: "Vehicles alerted", value: (e) => e.vehiclesAlerted },
  { header: "Time saved (sec)", value: (e) => e.timeSavedSec },
  { header: "Note", value: (e) => e.note ?? "" },
];

function CorridorTab({
  events,
  loading,
}: {
  events: CorridorEventRow[];
  loading: boolean;
}) {
  const [methodFilter, setMethodFilter] = useState("ALL");
  const [congestionFilter, setCongestionFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [view, setView] = useViewPref("ambulance-corridor");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [detailId, setDetailId] = useState<string | null>(null);

  const detail = useMemo(
    () => events.find((e) => e.id === detailId) ?? null,
    [events, detailId]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (methodFilter !== "ALL" && e.method !== methodFilter) return false;
      if (congestionFilter !== "ALL" && e.congestion !== congestionFilter)
        return false;
      if (needle) {
        const hay = `${e.segment} ${e.mission?.requestRef ?? ""} ${e.note ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [events, methodFilter, congestionFilter, q]);

  const safePage = Math.min(page, pageCount(filtered.length, pageSize));
  const pageRows = useMemo(
    () => paginate(filtered, safePage, pageSize),
    [filtered, safePage, pageSize]
  );

  const totals = useMemo(
    () => ({
      vehicles: filtered.reduce((s, e) => s + (e.vehiclesAlerted ?? 0), 0),
      saved: filtered.reduce((s, e) => s + (e.timeSavedSec ?? 0), 0),
    }),
    [filtered]
  );

  const columns: DataTableColumn<CorridorEventRow>[] = [
    { key: "when", header: "When", hideBelow: "sm" },
    { key: "mission", header: "Mission", mono: true },
    { key: "segment", header: "Segment" },
    { key: "method", header: "Method" },
    { key: "congestion", header: "Congestion", hideBelow: "md" },
    { key: "vehicles", header: "Vehicles", align: "right", hideBelow: "lg" },
    { key: "saved", header: "Saved", align: "right" },
    { key: "actions", header: "Actions", align: "right" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Events logged"
          value={formatNumber(filtered.length)}
          accent="teal"
          icon={<Radio className="size-5" aria-hidden="true" />}
          loading={loading}
          hint={`Newest ${Math.min(300, events.length)} of the alert log`}
        />
        <StatCard
          label="Vehicles alerted"
          value={formatNumber(totals.vehicles)}
          accent="amber"
          icon={<Siren className="size-5" aria-hidden="true" />}
          loading={loading}
          hint="Across filtered events"
        />
        <StatCard
          label="Time saved"
          value={formatDuration(totals.saved)}
          accent="lime"
          icon={<Zap className="size-5" aria-hidden="true" />}
          loading={loading}
          hint="Corridor clearance benefit"
        />
      </div>

      <SectionCard
        title="Corridor alert log"
        description="Every green-corridor alert across all missions — the 5-layer fallback chain in action."
        icon={<Radio className="size-4" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewSwitcher
              value={view}
              onChange={setView}
              options={["table", "list"]}
            />
            <ExportMenu
              columns={corridorCsv}
              rows={filtered}
              filename="uar-corridor-events"
              disabled={filtered.length === 0}
            />
          </div>
        }
      >
        {/* filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select
            value={methodFilter}
            onValueChange={(v) => {
              setMethodFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger
              className="w-full sm:w-44"
              aria-label="Filter by alert method"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All methods</SelectItem>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {METHOD_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={congestionFilter}
            onValueChange={(v) => {
              setCongestionFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger
              className="w-full sm:w-40"
              aria-label="Filter by congestion"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All congestion</SelectItem>
              {CONGESTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {titleCase(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-40 flex-1">
            <Search
              className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search segment or mission ref…"
              className="h-9 pl-8"
              aria-label="Search corridor events"
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Radio className="size-8" aria-hidden="true" />}
            title={
              events.length === 0
                ? "No corridor events yet"
                : "No events match the filters"
            }
            hint={
              events.length === 0
                ? "Events are recorded when missions are dispatched along congested segments."
                : "Try clearing the method or congestion filters."
            }
          >
            {events.length > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  setMethodFilter("ALL");
                  setCongestionFilter("ALL");
                  setQ("");
                }}
              >
                <RefreshCw className="size-4" aria-hidden="true" /> Reset
                filters
              </Button>
            )}
          </EmptyState>
        ) : view === "table" ? (
          <DataTable
            columns={columns}
            rows={pageRows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setDetailId(r.id)}
            height="fill"
            fillOffset={330}
            page={safePage}
            pages={pageCount(filtered.length, pageSize)}
            total={filtered.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
            itemLabel="events"
          >
            {(row, col) => {
              switch (col.key) {
                case "when":
                  return (
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(row.createdAt)}
                    </span>
                  );
                case "mission":
                  return (
                    <span className="font-semibold">
                      {row.mission?.requestRef ?? "—"}
                    </span>
                  );
                case "segment":
                  return (
                    <span className="max-w-52 truncate">{row.segment}</span>
                  );
                case "method":
                  return <MethodChip method={row.method} />;
                case "congestion":
                  return <CongestionChip level={row.congestion} />;
                case "vehicles":
                  return (
                    <span className="font-medium tabular-nums">
                      {formatNumber(row.vehiclesAlerted)}
                    </span>
                  );
                case "saved":
                  return (
                    <span className="font-medium">
                      {formatDuration(row.timeSavedSec)}
                    </span>
                  );
                case "actions":
                  return (
                    <div className="flex justify-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-11 md:size-8"
                        aria-label={`View event at ${row.segment}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailId(row.id);
                        }}
                      >
                        <Eye className="size-4" />
                      </Button>
                    </div>
                  );
                default:
                  return null;
              }
            }}
          </DataTable>
        ) : (
          <>
            <ul
              className="max-h-[36rem] space-y-2 overflow-y-auto scrollbar-thin"
              aria-label="Corridor events list"
            >
              {pageRows.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setDetailId(e.id)}
                    className="flex w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                    aria-label={`View event at ${e.segment}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {e.segment}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="font-mono">
                          {e.mission?.requestRef ?? "—"}
                        </span>{" "}
                        · {timeAgo(e.createdAt)} ·{" "}
                        {formatNumber(e.vehiclesAlerted)} vehicles alerted
                        {e.note ? ` · ${e.note}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      <MethodChip method={e.method} />
                      <CongestionChip level={e.congestion} />
                      <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold">
                        {formatDuration(e.timeSavedSec)} saved
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <PaginationBar
              page={safePage}
              pages={pageCount(filtered.length, pageSize)}
              total={filtered.length}
              onPage={setPage}
              itemLabel="events"
              className="mt-3"
            />
          </>
        )}
      </SectionCard>

      {/* ---------------------------- event detail ---------------------------- */}
      <DetailSheet
        open={!!detail}
        onOpenChange={(o) => !o && setDetailId(null)}
        eyebrow="Green corridor · Alert event"
        title={detail?.segment ?? ""}
        description={
          detail
            ? `Alert relayed for mission ${detail.mission?.requestRef ?? "—"}`
            : undefined
        }
        status={
          detail ? (
            <span className="flex items-center gap-1.5">
              <MethodChip method={detail.method} />
              <CongestionChip level={detail.congestion} />
            </span>
          ) : undefined
        }
      >
        {detail && (
          <>
            <DetailSection title="Event">
              <DetailGrid cols={3}>
                <DataField
                  label="Mission"
                  value={detail.mission?.requestRef ?? "—"}
                  mono
                />
                <DataField label="Segment" value={detail.segment} />
                <DataField
                  label="Alert method"
                  value={METHOD_LABEL[detail.method] ?? detail.method}
                />
                <DataField
                  label="Congestion"
                  value={<CongestionChip level={detail.congestion} />}
                />
                <DataField
                  label="Vehicles alerted"
                  value={formatNumber(detail.vehiclesAlerted)}
                />
                <DataField
                  label="Time saved"
                  value={formatDuration(detail.timeSavedSec)}
                />
                <DataField
                  label="Logged"
                  value={
                    detail.createdAt ? formatDateTime(detail.createdAt) : "—"
                  }
                />
                <DataField
                  label="Age"
                  value={timeAgo(detail.createdAt)}
                  className="col-span-2"
                />
              </DetailGrid>
              {detail.note && (
                <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm italic text-muted-foreground">
                  {detail.note}
                </p>
              )}
            </DetailSection>

            <DetailSection
              title="Fallback chain"
              description="Higher layers fail over to the next; the siren is always the last resort."
            >
              <MethodChainStrip />
            </DetailSection>
          </>
        )}
      </DetailSheet>
    </div>
  );
}

/* ============================= ANALYTICS TAB =============================== */

function ChartSkeleton() {
  return <Skeleton className="h-64 w-full rounded-xl" aria-hidden="true" />;
}

function AnalyticsTab({
  stats,
  loading,
}: {
  stats: CorridorStats | null;
  loading: boolean;
}) {
  const emergencyOptions = useMasters("EMERGENCY_TYPE");

  const emergencyData = useMemo(
    () =>
      (stats?.byEmergencyType ?? []).map((r) => ({
        type: r.type,
        name:
          EMERGENCY_SHORT[r.type] ??
          labelOf(emergencyOptions.options, r.type),
        count: r.count,
      })),
    [stats, emergencyOptions.options]
  );

  const weeklyData = useMemo(() => stats?.weekly ?? [], [stats]);

  const methodData = useMemo(
    () =>
      (stats?.byMethod ?? []).map((r) => ({
        method: r.method,
        label: METHOD_LABEL[r.method] ?? r.method,
        count: r.count,
      })),
    [stats]
  );

  const congestionData = useMemo(
    () => stats?.congestionDistribution ?? [],
    [stats]
  );

  const segmentData = useMemo(
    () =>
      (stats?.topSegments ?? []).map((s) => ({
        segment: trunc(s.segment, 22),
        savedMin: Math.round((s.savedSec ?? 0) / 60),
        savedSec: s.savedSec ?? 0,
      })),
    [stats]
  );

  const utilizationData = useMemo(
    () =>
      (stats?.fleetUtilization ?? []).map((u) => ({
        code: u.code,
        missions: u.missions,
      })),
    [stats]
  );

  const fleet = stats?.fleet;
  const missionsAgg = stats?.missions;
  const hasMissionData = !!stats && stats.missions.total > 0;
  const hasEventData = (stats?.byMethod ?? []).some((m) => m.count > 0);

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Total missions"
          value={formatNumber(missionsAgg?.total ?? 0)}
          accent="red"
          icon={<Siren className="size-5" aria-hidden="true" />}
          loading={loading}
        />
        <StatCard
          label="Completed"
          value={formatNumber(missionsAgg?.completed ?? 0)}
          accent="emerald"
          icon={<CheckCircle2 className="size-5" aria-hidden="true" />}
          loading={loading}
        />
        <StatCard
          label="Active now"
          value={formatNumber(missionsAgg?.active ?? 0)}
          accent="amber"
          icon={<Activity className="size-5" aria-hidden="true" />}
          hint="Dispatched · en route · arrived"
          loading={loading}
        />
        <StatCard
          label="Completion rate"
          value={`${missionsAgg?.total ? (stats?.completionRate ?? 0) : 0}%`}
          accent="teal"
          icon={<Gauge className="size-5" aria-hidden="true" />}
          loading={loading}
        />
        <StatCard
          label="Fleet size"
          value={formatNumber(fleet?.total ?? 0)}
          accent="teal"
          icon={<AmbulanceIcon className="size-5" aria-hidden="true" />}
          loading={loading}
        />
        <StatCard
          label="Fleet availability"
          value={`${fleet?.availabilityPct ?? 0}%`}
          accent="lime"
          icon={<CheckCircle2 className="size-5" aria-hidden="true" />}
          hint={`${formatNumber(fleet?.available ?? 0)} of ${formatNumber(fleet?.total ?? 0)} units AVAILABLE`}
          loading={loading}
        />
        <StatCard
          label="Vehicles alerted"
          value={formatNumber(stats?.vehiclesAlerted ?? 0)}
          accent="red"
          icon={<Radio className="size-5" aria-hidden="true" />}
          loading={loading}
        />
        <StatCard
          label="Time saved"
          value={`${formatNumber(stats?.timeSavedMin ?? 0)} min`}
          accent="emerald"
          icon={<Timer className="size-5" aria-hidden="true" />}
          hint="Total corridor clearance benefit"
          loading={loading}
        />
        <StatCard
          label="Avg saved / completed"
          value={formatDuration(stats?.avgSavedSec ?? 0)}
          accent="orange"
          icon={<TrendingUp className="size-5" aria-hidden="true" />}
          hint="Per completed mission"
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* missions by emergency type */}
        <SectionCard
          title="Missions by emergency type"
          description="Every request logged, split by emergency."
          icon={<BarChart3 className="size-4" aria-hidden="true" />}
        >
          {loading ? (
            <ChartSkeleton />
          ) : !hasMissionData ? (
            <EmptyState
              icon={<BarChart3 className="size-6" aria-hidden="true" />}
              title="No missions yet"
              hint="Create missions in the Missions tab and this chart fills up."
            />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={emergencyData}
                  margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="name"
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip {...TOOLTIP_PROPS} />
                  <Bar
                    dataKey="count"
                    name="Missions"
                    fill={C_RED}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={44}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        {/* 8-week trend */}
        <SectionCard
          title="Mission trend"
          description="Emergency runs per week — last 8 weeks."
          icon={<TrendingUp className="size-4" aria-hidden="true" />}
        >
          {loading ? (
            <ChartSkeleton />
          ) : !hasMissionData ? (
            <EmptyState
              icon={<TrendingUp className="size-6" aria-hidden="true" />}
              title="No trend data yet"
              hint="Weekly volumes appear once missions are logged."
            />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={weeklyData}
                  margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="corridorTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C_RED} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={C_RED} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="label"
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip {...TOOLTIP_PROPS} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Missions"
                    stroke={C_RED}
                    strokeWidth={2}
                    fill="url(#corridorTrendFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        {/* alert fallback chain */}
        <SectionCard
          title="Alerts by fallback layer"
          description="How the corridor reached vehicles, per alert method."
          icon={<Radio className="size-4" aria-hidden="true" />}
          actions={<MethodChainStrip className="hidden xl:flex" />}
          className="lg:col-span-2"
        >
          {loading ? (
            <ChartSkeleton />
          ) : !hasEventData ? (
            <EmptyState
              icon={<Radio className="size-6" aria-hidden="true" />}
              title="No corridor events yet"
              hint="Dispatch a mission along congested segments to see the fallback chain fire."
            />
          ) : (
            <div className="space-y-3">
              <MethodChainStrip className="xl:hidden" />
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={methodData}
                    layout="vertical"
                    margin={{ top: 4, right: 32, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid
                      horizontal={false}
                      stroke="var(--border)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={118}
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip {...TOOLTIP_PROPS} />
                    <Bar
                      dataKey="count"
                      name="Alerts"
                      radius={[0, 6, 6, 0]}
                      maxBarSize={20}
                    >
                      {methodData.map((d) => (
                        <Cell
                          key={d.method}
                          fill={METHOD_COLOR[d.method] ?? C_RED}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </SectionCard>

        {/* congestion distribution */}
        <SectionCard
          title="Congestion profile"
          description="Share of alerts by congestion level."
          icon={<Gauge className="size-4" aria-hidden="true" />}
        >
          {loading ? (
            <ChartSkeleton />
          ) : !hasEventData ? (
            <EmptyState
              icon={<Gauge className="size-6" aria-hidden="true" />}
              title="No congestion data yet"
              hint="Congestion mix appears once corridor events are logged."
            />
          ) : (
            <div className="space-y-3">
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={congestionData}
                    margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--border)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="congestion"
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: string) => titleCase(v)}
                      interval={0}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip {...TOOLTIP_PROPS} />
                    <Bar
                      dataKey="count"
                      name="Alerts"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={44}
                    >
                      {congestionData.map((d) => (
                        <Cell
                          key={d.congestion}
                          fill={CONGESTION_COLOR[d.congestion] ?? C_AMBER}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {congestionData.map((d) => (
                  <span
                    key={d.congestion}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                      d.congestion === "LOW" &&
                        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                      d.congestion === "MODERATE" &&
                        "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                      d.congestion === "HEAVY" &&
                        "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
                      d.congestion === "GRIDLOCK" &&
                        "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                    )}
                  >
                    {titleCase(d.congestion)} · {d.count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        {/* top segments by time saved */}
        <SectionCard
          title="Top segments by time saved"
          description="Where corridor clearance bought the most minutes."
          icon={<MapPin className="size-4" aria-hidden="true" />}
        >
          {loading ? (
            <ChartSkeleton />
          ) : segmentData.length === 0 ? (
            <EmptyState
              icon={<MapPin className="size-6" aria-hidden="true" />}
              title="No segment data yet"
              hint="Dispatch missions to accumulate per-segment savings."
            />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={segmentData}
                  layout="vertical"
                  margin={{ top: 4, right: 32, left: 8, bottom: 0 }}
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    type="number"
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v}m`}
                  />
                  <YAxis
                    type="category"
                    dataKey="segment"
                    width={150}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip {...TOOLTIP_PROPS} />
                  <Bar
                    dataKey="savedMin"
                    name="Minutes saved"
                    fill={C_TEAL}
                    radius={[0, 6, 6, 0]}
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        {/* fleet utilisation */}
        <SectionCard
          title="Fleet utilisation"
          description="Missions served per ambulance unit."
          icon={<AmbulanceIcon className="size-4" aria-hidden="true" />}
        >
          {loading ? (
            <ChartSkeleton />
          ) : utilizationData.length === 0 ? (
            <EmptyState
              icon={<AmbulanceIcon className="size-6" aria-hidden="true" />}
              title="No ambulances on the roster"
              hint="Add units in the Fleet tab to see utilisation."
            />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={utilizationData}
                  layout="vertical"
                  margin={{ top: 4, right: 32, left: 8, bottom: 0 }}
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="code"
                    width={128}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip {...TOOLTIP_PROPS} />
                  <Bar
                    dataKey="missions"
                    name="Missions"
                    fill={C_AMBER}
                    radius={[0, 6, 6, 0]}
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
