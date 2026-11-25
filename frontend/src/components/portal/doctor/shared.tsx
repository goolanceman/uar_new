"use client";

/**
 * Shared bits for the medical portals (doctor / nurse / pharmacist / lab tech).
 * Types mirror the medical API contracts; helpers keep every tab consistent.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { get } from "@/lib/api-client";
import type { Tone } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

/* ────────────────────────────── generic helpers ───────────────────────────── */

/** Normalises API responses: raw array, {items}, or legacy {data} envelope. */
export function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    if (Array.isArray(rec.items)) return rec.items as T[];
    if (Array.isArray(rec.data)) return rec.data as T[];
    if (rec.data && typeof rec.data === "object" && Array.isArray((rec.data as Record<string, unknown>).items))
      return (rec.data as Record<string, unknown>).items as T[];
  }
  return [];
}

/** Print/document opener — same pattern as the donor receipts. */
export function openPrint(url: string): void {
  window.open(url, "_blank", "noopener");
}

/** Medical status → StatusBadge tone (statuses not covered by the shared map). */
export function medTone(status?: string | null): Tone {
  switch ((status ?? "").toUpperCase()) {
    case "SIGNED":
    case "VERIFIED":
    case "COMPLETED":
    case "ACCEPTED":
    case "DONE":
    case "DOCTOR_REVIEWED":
    case "RESULT_AVAILABLE":
    case "LIVE":
    case "FULLY_DISPENSED":
      return "success";
    case "SCHEDULED":
    case "WAITING":
    case "DRAFT":
    case "PENDING":
    case "INVITED":
    case "SAMPLE_COLLECTED":
    case "ORDERED":
      return "warning";
    case "IN_CONSULTATION":
    case "PROCESSING":
    case "RECEIVED":
    case "CONFIRMED":
    case "CHECKED_IN":
      return "progress";
    case "NO_SHOW":
    case "MISSED":
    case "CANCELLED":
    case "DECLINED":
    case "CRITICAL":
    case "REJECTED":
    case "SUSPENDED":
      return "danger";
    default:
      return "neutral";
  }
}

/** Today's local midnight → ISO date (yyyy-mm-dd) for ?from=/&to= filters. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isToday(d: string | Date | null | undefined): boolean {
  if (!d) return false;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === new Date().toDateString();
}

/* ───────────────────────────────── types ─────────────────────────────────── */

export interface BeneficiaryLite {
  id: string;
  name: string;
  phone?: string | null;
  city?: string | null;
  code?: string | null;
  age?: number | null;
  gender?: string | null;
  bloodGroup?: string | null;
  allergies?: string | null;
  currentMedications?: string | null;
  medicalConditions?: string | null;
  category?: string | null;
}

export interface CampSummary {
  id: string;
  code?: string | null;
  title: string;
  description?: string | null;
  venue?: string | null;
  city?: string | null;
  campDate: string;
  startTime?: string | null;
  endTime?: string | null;
  status: string; // DRAFT | SCHEDULED | LIVE | COMPLETED | CANCELLED
  capacity?: number | null;
  counts?: { registrations?: number; checkedIn?: number; completed?: number } | null;
}

export interface AttendanceRow {
  id: string;
  campId: string;
  registrationId?: string | null;
  beneficiaryId?: string | null;
  status: string; // CHECKED_IN | WAITING | IN_CONSULTATION | COMPLETED | CHECKED_OUT | NO_SHOW | CANCELLED
  queueToken?: number | null;
  checkInMethod?: string | null;
  checkInAt?: string | null;
  cancelReason?: string | null;
  beneficiary?: BeneficiaryLite | null;
}

export interface TimelineItem {
  kind: string;
  at: string;
  summary: string;
}

export interface VitalsRow {
  id: string;
  beneficiaryId?: string | null;
  encounterId?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  bmi?: number | null;
  tempC?: number | null;
  pulse?: number | null;
  respRate?: number | null;
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  spo2?: number | null;
  glucose?: number | null;
  notes?: string | null;
  recordedByName?: string | null;
  recordedAt?: string | null;
  createdAt?: string | null;
  beneficiary?: BeneficiaryLite | null;
}

export interface EncounterRow {
  id: string;
  code?: string | null;
  beneficiaryId?: string | null;
  campId?: string | null;
  doctorId?: string | null;
  status: string; // DRAFT | SIGNED
  chiefComplaint?: string | null;
  observations?: string | null;
  diagnosis?: string | null;
  advice?: string | null;
  followUpDate?: string | null;
  /** Signed-record amendment history (parsed JSON array from the API). */
  amendments?: Array<{ at?: string; byName?: string; note?: string }> | null;
  createdAt?: string;
  beneficiary?: BeneficiaryLite | null;
}

export interface PrescriptionItemRow {
  id?: string;
  medicineName: string;
  genericName?: string | null;
  strength?: string | null;
  dosage?: string | null;
  route?: string | null;
  frequency?: string | null;
  durationDays?: number | null;
  quantity: number;
  instructions?: string | null;
  dispensedQty?: number | null;
}

export interface PrescriptionRow {
  id: string;
  code?: string | null;
  status: string; // DRAFT | SIGNED | PARTIALLY_DISPENSED | FULLY_DISPENSED | CANCELLED
  diagnosis?: string | null;
  followUpDate?: string | null;
  createdAt?: string;
  beneficiaryId?: string | null;
  beneficiary?: BeneficiaryLite | null;
  doctor?: { id?: string; name?: string; regNumber?: string | null } | null;
  camp?: { id?: string; title?: string } | null;
  items?: PrescriptionItemRow[];
  dispenses?: Array<{
    id: string;
    quantity: number;
    batchNo?: string | null;
    expiryDate?: string | null;
    dispensedAt?: string | null;
    dispensedByName?: string | null;
    itemId?: string | null;
  }>;
}

export interface LabOrderRow {
  id: string;
  code?: string | null;
  beneficiaryId?: string | null;
  campId?: string | null;
  encounterId?: string | null;
  testName?: string | null;
  status: string; // ORDERED | SAMPLE_COLLECTED | RECEIVED | PROCESSING | RESULT_AVAILABLE | VERIFIED | DOCTOR_REVIEWED
  resultText?: string | null;
  resultFileUrl?: string | null;
  critical?: boolean;
  createdAt?: string;
  beneficiary?: BeneficiaryLite | null;
}

export interface ReferralRow {
  id: string;
  code?: string | null;
  beneficiaryId?: string | null;
  orgId?: string | null;
  status: string;
  priority?: string | null;
  reason?: string | null;
  notes?: string | null;
  createdAt?: string;
  beneficiary?: BeneficiaryLite | null;
  org?: { id: string; name: string } | null;
}

export interface FollowUpRow {
  id: string;
  beneficiaryId?: string | null;
  dueDate: string;
  status: string; // PENDING | DONE | MISSED | CANCELLED
  outcome?: string | null;
  notes?: string | null;
  createdAt?: string;
  beneficiary?: BeneficiaryLite | null;
}

export interface ScreeningRowLite {
  id: string;
  beneficiaryId?: string | null;
  campId?: string | null;
  type?: string | null;
  result?: string | null;
  abnormal?: boolean;
  notes?: string | null;
  createdAt?: string;
  beneficiary?: BeneficiaryLite | null;
}

export interface InventoryRow {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit?: string | null;
  minStock?: number | null;
}

export interface HealthOrgRow {
  id: string;
  name: string;
  type?: string | null;
  status?: string | null; // PENDING | VERIFIED | REJECTED | SUSPENDED
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  regNumber?: string | null;
  services?: string | null; // JSON string list
  facilities?: string | null;
  operatingHours?: string | null;
  notes?: string | null;
}

export interface ProfessionalRow {
  id: string;
  orgId?: string | null;
  name: string;
  kind?: string | null; // DOCTOR | NURSE | PHARMACIST | LAB_TECH | OTHER
  speciality?: string | null;
  qualification?: string | null;
  regNumber?: string | null;
  experienceYears?: number | null;
  phone?: string | null;
  email?: string | null;
  verificationStatus?: string | null; // PENDING | VERIFIED
  createdAt?: string;
}

/* ──────────────────────────── shared UI atoms ────────────────────────────── */

/** Gentle empty/error state for lists when a backend endpoint hasn't landed yet. */
export function QuietEmpty({
  icon,
  title,
  hint,
  error,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  error?: string | null;
  children?: React.ReactNode;
}) {
  const denied = /40[13]|access|forbidden|unauthor|sign in/i.test(error ?? "");
  return (
    <EmptyState
      icon={icon}
      title={denied ? "You don't have access to this view" : title}
      hint={denied
        ? "This area needs a different role — ask the camp coordinator if you believe this is a mistake."
        : error || hint}
    >
      {children}
    </EmptyState>
  );
}

/** Card-list skeleton matching a 3-row list. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="Loading" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Small inline banner for disclaimers (AI drafts, verification states). */
export function NoteBanner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn";
  children: React.ReactNode;
}) {
  return (
    <p
      role="note"
      className={
        tone === "warn"
          ? "flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
          : "flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground"
      }
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Human line for a beneficiary: "Sunita Devi · 54 · F". */
export function ageSexLine(b?: BeneficiaryLite | null): string {
  if (!b) return "Unknown patient";
  const bits: string[] = [];
  if (b.age != null) bits.push(`${b.age}y`);
  if (b.gender) bits.push(b.gender.charAt(0).toUpperCase());
  return bits.length ? `${b.name} · ${bits.join(" · ")}` : b.name;
}

/** Stable display code for a beneficiary (health id, code, or id tail). */
export function beneficiaryCode(b?: BeneficiaryLite | null): string {
  if (!b) return "—";
  return b.code || `UAR-BEN-${b.id.slice(-6).toUpperCase()}`;
}

/** BMI preview from height (cm) + weight (kg). */
export function bmiOf(heightCm: string, weightKg: string): string {
  const h = Number(heightCm) / 100;
  const w = Number(weightKg);
  if (!h || !w) return "—";
  const bmi = w / (h * h);
  return bmi.toFixed(1);
}

/* ─────────────────────── beneficiary search hook (shared) ────────────────── */

/** Debounced beneficiary search against GET /api/beneficiaries?q=. */
export function useBeneficiarySearch(minChars = 2) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<BeneficiaryLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const queryPending = q.trim() !== debounced;

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const run = useCallback(async (query: string) => {
    const id = ++requestId.current;
    if (query.length < minChars) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await get<unknown>(
        `/api/beneficiaries?q=${encodeURIComponent(query)}&limit=20`
      );
      if (id === requestId.current) setResults(asArray<BeneficiaryLite>(data));
    } catch (e) {
      if (id === requestId.current) {
        setResults([]);
        setError(e instanceof Error ? e.message : "Search failed");
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [minChars]);

  useEffect(() => {
    void run(debounced);
    return () => { requestId.current += 1; };
  }, [debounced, run]);

  return {
    q,
    setQ,
    results: queryPending ? [] : results,
    loading: queryPending || loading,
    error: queryPending ? null : error,
    reload: () => run(debounced),
  };
}

/** Error → toast with a consistent prefix. */
export function toastError(e: unknown, fallback: string) {
  toast.error(e instanceof Error ? e.message : fallback);
}
