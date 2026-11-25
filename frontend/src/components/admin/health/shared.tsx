"use client";

/**
 * Healthcare module shared kit — types, hooks and small primitives reused by
 * every tab under src/components/admin/health/. Keeps tab files focused on
 * their own domain (≤ ~600 lines each).
 *
 * API resilience: tabs render against the round-6 healthcare contracts; each
 * tab owns its error state (ErrorBox with retry) so the module stays usable
 * while backend routes land agent-by-agent.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { humanize, StatusBadge, type Tone } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ═══════════════════════════════ types ════════════════════════════════ */

export interface CampCounts {
  registrations: number;
  checkedIn: number;
  completed: number;
}

export interface MedicalCamp {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  campDate: string;
  startTime?: string | null;
  endTime?: string | null;
  venue: string;
  city?: string | null;
  capacity: number;
  services?: string | null;
  status: string; // DRAFT | SCHEDULED | LIVE | COMPLETED | CANCELLED
  coordinatorName?: string | null;
  budget?: number | null;
  campaignId?: string | null;
  counts?: CampCounts | null;
  createdAt?: string;
}

export interface CampAttendanceSummary {
  registered: number;
  checkedIn: number;
  waiting: number;
  inConsultation: number;
  completed: number;
  checkedOut: number;
  noShow: number;
  cancelled: number;
}

export interface CampPartnerRow {
  id: string;
  orgId?: string | null;
  role?: string | null; // HOST | SUPPORT | SPONSOR
  status?: string | null; // PENDING | ACCEPTED | DECLINED
  org?: { id: string; name: string; type?: string | null; city?: string | null } | null;
  createdAt?: string;
}

export interface CampStaffRow {
  id: string;
  status?: string | null; // ASSIGNED | CONFIRMED | ATTENDED | WITHDRAWN
  role?: string | null;
  professionalId?: string | null;
  professional?: { id: string; name: string; kind?: string | null; speciality?: string | null } | null;
}

export interface ExpenseRow {
  id: string;
  head: string;
  amount: number;
  notes?: string | null;
  createdAt?: string;
}

export interface CampDetail extends MedicalCamp {
  campPartners?: CampPartnerRow[];
  campStaff?: CampStaffRow[];
  counts?: CampCounts | null;
}

export interface HealthOrg {
  id: string;
  name: string;
  type: string; // HOSPITAL | CLINIC | LAB | PHARMACY | NGO
  city?: string | null;
  status: string; // PENDING | VERIFIED | REJECTED | SUSPENDED
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
  address?: string | null;
  regNumber?: string | null;
  notes?: string | null;
  createdAt?: string;
}

export interface OrgDetail extends HealthOrg {
  staff?: Array<{ id: string; name: string; kind?: string | null; speciality?: string | null; verificationStatus?: string | null }>;
  campPartners?: CampPartnerRow[];
}

export interface Professional {
  id: string;
  name: string;
  kind: string; // DOCTOR | NURSE | PHARMACIST | LAB_TECH
  orgId?: string | null;
  org?: { id: string; name: string } | null;
  regNumber?: string | null;
  speciality?: string | null;
  qualification?: string | null;
  phone?: string | null;
  email?: string | null;
  availability?: string | null;
  verificationStatus: string; // PENDING | VERIFIED | REJECTED
  active?: boolean;
  createdAt?: string;
}

export interface BeneficiaryLite {
  id: string;
  name: string;
  code?: string | null;
  phone?: string | null;
  city?: string | null;
  category?: string | null;
}

export interface RegRow {
  id: string;
  code?: string | null;
  status: string; // PENDING | CONFIRMED | CANCELLED | REJECTED
  registeredVia?: string | null;
  campId?: string | null;
  camp?: { id?: string; title?: string | null } | null;
  beneficiary?: ({ code?: string | null; name: string; phone?: string | null } & Record<string, unknown>) | null;
  createdAt?: string;
}

export interface AttendanceRow {
  id: string;
  registrationId?: string | null;
  queueToken?: string | null;
  status: string; // WAITING | IN_CONSULTATION | COMPLETED | CHECKED_OUT | NO_SHOW | CANCELLED
  checkInAt?: string | null;
  checkInMethod?: string | null;
  cancelReason?: string | null;
  beneficiary?: { code?: string | null; name: string } | null;
}

export interface AppointmentRow {
  id: string;
  type?: string | null;
  scheduledAt: string;
  status: string; // PENDING | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW
  noShowReason?: string | null;
  notes?: string | null;
  camp?: { id?: string; title?: string | null } | null;
  beneficiary?: { code?: string | null; name: string } | null;
  professional?: { id?: string; name?: string | null; kind?: string | null } | null;
}

export interface EncounterRow {
  id: string;
  status: string; // DRAFT | SIGNED
  campId?: string | null;
  camp?: { id?: string; title?: string | null } | null;
  doctor?: { id?: string; name?: string | null } | null;
  beneficiary?: { code?: string | null; name: string } | null;
  diagnosis?: string | null;
  notes?: string | null;
  createdAt?: string;
}

export interface EncounterDetail extends EncounterRow {
  vitals?: VitalsRow[];
  prescriptions?: PrescriptionRow[];
  labOrders?: LabOrderRow[];
  referrals?: ReferralRow[];
  amendments?: TimelineRow[];
}

export interface VitalsRow {
  id: string;
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  pulse?: number | null;
  tempC?: number | null;
  respRate?: number | null;
  spo2?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  glucose?: number | null;
  notes?: string | null;
  recordedAt?: string | null;
  createdAt?: string;
}

export interface ScreeningRow {
  id: string;
  type: string;
  result: string;
  abnormal?: boolean;
  createdAt?: string;
}

export interface PrescriptionItemRow {
  name?: string | null;
  dose?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
}

export interface DispenseRow {
  id: string;
  itemName?: string | null;
  quantity?: number | null;
  dispensedAt?: string | null;
  by?: string | null;
}

export interface PrescriptionRow {
  id: string;
  code?: string | null;
  status: string; // ACTIVE | PARTIALLY_DISPENSED | FULLY_DISPENSED | CANCELLED
  beneficiary?: { code?: string | null; name: string } | null;
  doctor?: { id?: string; name?: string | null } | null;
  camp?: { id?: string; title?: string | null } | null;
  items?: PrescriptionItemRow[] | string | null;
  dispenses?: DispenseRow[];
  cancelReason?: string | null;
  createdAt?: string;
}

export interface LabOrderRow {
  id: string;
  test?: string | null;
  status: string;
  critical?: boolean;
  resultText?: string | null;
  resultFileUrl?: string | null;
  beneficiary?: { code?: string | null; name: string } | null;
  camp?: { id?: string; title?: string | null } | null;
  createdAt?: string;
}

export interface ReferralRow {
  id: string;
  status: string;
  priority?: string | null;
  facility?: string | null;
  reason?: string | null;
  beneficiary?: { code?: string | null; name: string } | null;
  camp?: { id?: string; title?: string | null } | null;
  createdAt?: string;
}

export interface FollowUpRow {
  id: string;
  status: string; // PENDING | SCHEDULED | DONE | MISSED | CANCELLED
  dueAt: string;
  outcome?: string | null;
  channel?: string | null;
  notes?: string | null;
  beneficiary?: { code?: string | null; name: string } | null;
  camp?: { id?: string; title?: string | null } | null;
}

export interface MedicalDocRow {
  id: string;
  name: string;
  kind?: string | null;
  url: string;
  beneficiary?: { id?: string; code?: string | null; name: string } | null;
  createdAt?: string;
}

export interface AiInteractionRow {
  id: string;
  kind?: string | null;
  status: string; // PENDING | APPROVED | REJECTED
  prompt?: string | null;
  input?: string | null;
  output?: string | null;
  createdAt?: string;
}

export interface InventoryTxRow {
  id: string;
  type?: string | null;
  quantity?: number | null;
  itemId?: string | null;
  item?: { id?: string; name?: string | null; unit?: string | null } | null;
  campId?: string | null;
  notes?: string | null;
  createdAt?: string;
}

export interface InvItem {
  id: string;
  name: string;
  category?: string | null;
  quantity: number;
  minStock?: number | null;
  unit?: string | null;
  pricePerUnit?: number | null;
  location?: string | null;
  expiryDate?: string | null;
}

export interface TimelineRow {
  kind: string;
  at: string;
  summary: string;
  data?: unknown;
}

/* ════════════════════════ constants & option lists ═══════════════════════ */

export const CAMP_STATUSES = ["DRAFT", "SCHEDULED", "LIVE", "COMPLETED", "CANCELLED"] as const;

export const CAMP_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  LIVE: "progress",
  COMPLETED: "success",
  CANCELLED: "danger",
};

export const ATT_TONE: Record<string, Tone> = {
  WAITING: "warning",
  IN_CONSULTATION: "progress",
  COMPLETED: "success",
  CHECKED_OUT: "info",
  NO_SHOW: "danger",
  CANCELLED: "danger",
};

export const REG_TONE: Record<string, Tone> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "danger",
  REJECTED: "danger",
};

export const APPT_TONE: Record<string, Tone> = {
  PENDING: "warning",
  CONFIRMED: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
  NO_SHOW: "danger",
};

export const RX_TONE: Record<string, Tone> = {
  ACTIVE: "warning",
  PARTIALLY_DISPENSED: "progress",
  FULLY_DISPENSED: "success",
  CANCELLED: "danger",
};

/** Backend truth: ORDERED → SAMPLE_COLLECTED → RECEIVED → PROCESSING → RESULT_AVAILABLE → VERIFIED → DOCTOR_REVIEWED (+ CANCELLED). */
export const LAB_FLOW = ["ORDERED", "SAMPLE_COLLECTED", "RECEIVED", "PROCESSING", "RESULT_AVAILABLE", "VERIFIED", "DOCTOR_REVIEWED", "CANCELLED"];

export const LAB_TONE: Record<string, Tone> = {
  ORDERED: "warning",
  SAMPLE_COLLECTED: "info",
  RECEIVED: "info",
  PROCESSING: "progress",
  RESULT_AVAILABLE: "progress",
  VERIFIED: "success",
  DOCTOR_REVIEWED: "success",
  CANCELLED: "danger",
};

/** Backend truth: CREATED → SHARED → ACCEPTED → SCHEDULED → ATTENDED → REPORT_RECEIVED → COMPLETED (+ CANCELLED | LOST_TO_FOLLOWUP). */
export { REFERRAL_FLOW } from "@/lib/referrals";

export const REFERRAL_TONE: Record<string, Tone> = {
  CREATED: "warning",
  SHARED: "info",
  ACCEPTED: "info",
  SCHEDULED: "progress",
  ATTENDED: "progress",
  REPORT_RECEIVED: "progress",
  COMPLETED: "success",
  CANCELLED: "danger",
  LOST_TO_FOLLOWUP: "danger",
};

export const PRIORITY_TONE: Record<string, Tone> = {
  EMERGENCY: "danger",
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};

export const ORG_TYPES = ["HOSPITAL", "CLINIC", "LAB", "MEDICAL_COLLEGE", "DENTAL", "EYE_CARE", "PHARMACY", "BLOOD_BANK", "PRACTITIONER", "CSR"] as const;
export const PROF_KINDS = ["DOCTOR", "NURSE", "PHARMACIST", "LAB_TECH"] as const;
export const CHECKIN_METHODS = ["QR", "ID", "PHONE", "MANUAL"] as const;
export const REGISTER_VIA = ["SELF", "DESK", "ASSISTED", "BULK", "QR"] as const;
export const PARTNER_ROLES = ["HOST", "SUPPORT", "SPONSOR"] as const;
export const CAMP_STAFF_ROLES = ["DOCTOR", "NURSE", "PHARMACIST", "LAB_TECH", "COORDINATOR", "VOLUNTEER"] as const;
export const APPOINTMENT_TYPES = ["SCREENING", "CONSULTATION", "LAB", "PHARMACY", "FOLLOW_UP"] as const;
export const DOC_KINDS = ["PRESCRIPTION", "LAB_REPORT", "DISCHARGE_SUMMARY", "REFERRAL", "OTHER"] as const;

/**
 * Workflow advance for camp attendance queue rows — re-exported from
 * @/lib/camp-attendance, the same transition table PATCH /api/camp-attendance
 * enforces (keeps the queue buttons and the API guard in lock-step).
 */
export { attTransitions } from "@/lib/camp-attendance";

/* ═══════════════════════════ data-shape helpers ═══════════════════════════ */

/** Accepts either a raw array or the {items,...} envelope. */
export function asItems<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const maybe = data as { items?: unknown } | null;
  return Array.isArray(maybe?.items) ? (maybe.items as T[]) : [];
}

export function asPaged<T>(data: unknown): { items: T[]; total: number; page: number; pages: number } {
  if (Array.isArray(data)) return { items: data as T[], total: data.length, page: 1, pages: 1 };
  const d = (data ?? {}) as { items?: unknown; total?: number; page?: number; pages?: number };
  const items = Array.isArray(d.items) ? (d.items as T[]) : [];
  return { items, total: d.total ?? items.length, page: d.page ?? 1, pages: d.pages ?? 1 };
}

/** Parse a JSON string[] column (services, …); falls back to comma list. */
export function jsonList(s?: string | null): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // plain comma-separated value
  }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function bmi(hCm?: string | number | null, wKg?: string | number | null): number | null {
  const h = num(hCm, 0);
  const w = num(wKg, 0);
  if (h <= 0 || w <= 0) return null;
  return Math.round((w / (h / 100) ** 2) * 10) / 10;
}

export function isOverdue(iso?: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t < Date.now();
}

/** Debounce any value (search inputs) by `ms` milliseconds. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ═══════════════════════════ resilient loading ═══════════════════════════ */

/**
 * Minimal async loader with error capture — a failing endpoint surfaces as
 * `error` (retry-able) instead of crashing the tab. Backend agents land the
 * healthcare routes incrementally; every tab stays graceful.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const d = await fn();
        if (!alive) return;
        setData(d);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    };
    run();
    return () => {
      alive = false;
    };
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/** Per-tab failure state with a retry button (never crash the page). */
export function ErrorBox({
  message,
  onRetry,
  compact,
}: {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-amber-500/40 bg-amber-500/5 text-center",
        compact ? "px-4 py-6" : "px-6 py-10"
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-amber-500/10">
        <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      </span>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-semibold">Could not load this section</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" className="min-h-9" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function RowsSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

/* ═══════════════════════════ small UI pieces ═══════════════════════════ */

/** Chip filter row (role="group", aria-pressed) like the volunteers module. */
export function FilterChips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {options.map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={value === t}
          onClick={() => onChange(t)}
          className={cn(
            "min-h-9 rounded-full border px-3 text-xs font-medium transition-colors",
            value === t
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:bg-accent"
          )}
        >
          {t === "ALL" ? "All" : humanize(t)}
        </button>
      ))}
    </div>
  );
}

/** Small labelled counter tile (camp ops counters, pipeline groups). */
export function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 flex items-center gap-2 text-lg font-bold leading-tight tabular-nums">
        {value ?? "—"}
        {tone && tone !== "neutral" ? <StatusBadge status={label} tone={tone} className="hidden" /> : null}
      </p>
    </div>
  );
}

/** Muted informational strip (role guidance, portal notes). */
export function NoteBox({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "rounded-lg border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground",
        className
      )}
    >
      {children}
    </p>
  );
}

/** Pulsing dot used next to LIVE camp statuses. */
export function LiveDot() {
  return (
    <span className="relative flex size-2" aria-hidden="true">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
    </span>
  );
}

export function CampStatusBadge({ status }: { status?: string | null }) {
  if (status === "LIVE") {
    return (
      <StatusBadge status="LIVE" tone="progress" className="gap-1.5">
        <LiveDot /> Live
      </StatusBadge>
    );
  }
  return <StatusBadge status={status} tone={CAMP_TONE[status ?? ""] ?? "neutral"} />;
}

/** Capacity fill bar with registered/total caption. */
export function CapacityBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const full = total > 0 && used >= total;
  return (
    <div className="w-32 min-w-24 space-y-1">
      <Progress
        value={pct}
        aria-label={`${used} of ${total} capacity used`}
        className={cn("h-1.5", full ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500")}
      />
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {used}/{total} · {pct}%
      </p>
    </div>
  );
}

/* ═══════════════════════════ option loaders ═══════════════════════════ */

export interface SelectOption {
  value: string;
  label: string;
}

/** Camp picker — loads once, lazily (used by registrations, appointments, …). */
export function CampSelect({
  value,
  onChange,
  placeholder = "Select camp…",
  allowAll,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  allowAll?: boolean;
  className?: string;
}) {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    get<unknown>("/api/medical-camps?limit=100")
      .then((d) => {
        if (!alive) return;
        setOptions(
          asItems<MedicalCamp>(d).map((c) => ({
            value: c.id,
            label: `${c.title} · ${formatDate(c.campDate)}`,
          }))
        );
      })
      .catch(() => {
        // filter stays empty; the parent list still renders
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={loading && options.length === 0}>
      <SelectTrigger className={cn("min-h-11 w-full sm:w-auto sm:min-h-0", className)} aria-label={placeholder}>
        <SelectValue placeholder={loading ? "Loading camps…" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowAll ? <SelectItem value="ALL">All camps</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Beneficiary picker: debounced search → pick from result list. */
export function BeneficiarySearch({
  onPick,
  placeholder = "Search beneficiary by name / phone…",
  compact,
}: {
  onPick: (b: BeneficiaryLite) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const [results, setResults] = useState<BeneficiaryLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (q.length < 2) return; // stale results are hidden by the render guard below
    let alive = true;
    const run = async () => {
      setLoading(true);
      try {
        const d = await get<unknown>(
          `/api/beneficiaries?q=${encodeURIComponent(q)}&page=1&limit=8`
        );
        if (!alive) return;
        setResults(asItems<BeneficiaryLite>(d));
        setOpen(true);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setLoading(false);
      }
    };
    run();
    return () => {
      alive = false;
    };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={boxRef} className="relative w-full">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          aria-label={placeholder}
          className={cn("pl-9", compact ? "h-9" : "h-11")}
        />
        {loading ? (
          <Loader2
            className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
      </div>
      {open && q.length >= 2 && results.length > 0 ? (
        <div
          role="listbox"
          aria-label="Beneficiary results"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-card shadow-lg scrollbar-thin"
        >
          {results.map((b) => (
            <button
              key={b.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                onPick(b);
                setQuery("");
                setOpen(false);
              }}
              className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserRound className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{b.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[b.code, b.phone, b.city].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {open && !loading && results.length === 0 && q.length >= 2 ? (
        <div className="absolute z-30 mt-1 w-full rounded-lg border bg-card px-3 py-3 text-xs text-muted-foreground shadow-lg">
          No beneficiaries match “{q}”.
        </div>
      ) : null}
    </div>
  );
}

/** Professional picker — lazily loads the roster (camp staff assignment). */
export function ProfessionalSelect({
  value,
  onChange,
  placeholder = "Select professional…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    get<unknown>("/api/health-professionals?verificationStatus=VERIFIED&limit=100")
      .then((d) => {
        if (!alive) return;
        setOptions(
          asItems<Professional>(d)
            .filter((p) => p.active !== false)
            .map((p) => ({
              value: p.id,
              label: `${p.name}${p.speciality ? ` · ${p.speciality}` : ``} (${humanize(p.kind)})`,
            }))
        );
      })
      .catch(() => {
        // empty options — parent surfaces its own error state
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={loading && options.length === 0}>
      <SelectTrigger className={cn("min-h-11 w-full sm:w-auto sm:min-h-0", className)} aria-label={placeholder}>
        <SelectValue placeholder={loading ? "Loading professionals…" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.length === 0 && !loading ? (
          <SelectItem value="__none" disabled>
            No verified professionals yet
          </SelectItem>
        ) : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Health organisation picker — lazily loads (partner invitations). */
export function OrgSelect({
  value,
  onChange,
  placeholder = "Select organisation…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    get<unknown>("/api/health-orgs?status=VERIFIED&limit=100")
      .then((d) => {
        if (!alive) return;
        setOptions(
          asItems<HealthOrg>(d).map((o) => ({
            value: o.id,
            label: `${o.name} (${humanize(o.type)})`,
          }))
        );
      })
      .catch(() => {
        // empty options
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={loading && options.length === 0}>
      <SelectTrigger className={cn("min-h-11 w-full sm:w-auto sm:min-h-0", className)} aria-label={placeholder}>
        <SelectValue placeholder={loading ? "Loading organisations…" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.length === 0 && !loading ? (
          <SelectItem value="__none" disabled>
            No verified organisations yet
          </SelectItem>
        ) : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Tiny inline mutation helper: toasts errors, returns success flag. */
export async function runMutation(
  fn: () => Promise<unknown>,
  successMsg: string
): Promise<boolean> {
  try {
    await fn();
    if (successMsg) toast.success(successMsg);
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Action failed");
    return false;
  }
}
