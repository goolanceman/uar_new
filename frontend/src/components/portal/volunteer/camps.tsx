"use client";

/**
 * Volunteer tab — Camps. Upcoming camps, a simplified registration desk
 * (identify a beneficiary via QR / ID / phone / manual search and register
 * them), and attendance check-in. Strictly NO clinical data access — only
 * registration and queue presence.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CalendarCheck,
  CheckCircle2,
  HeartPulse,
  MapPin,
  Phone,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch, post } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ageSexLine,
  asArray,
  beneficiaryCode,
  ListSkeleton,
  medTone,
  QuietEmpty,
  toastError,
  type AttendanceRow,
  type BeneficiaryLite,
  type CampSummary,
} from "../doctor/shared";

interface RegistrationRowLite {
  id: string;
  campId?: string | null;
  beneficiaryId?: string | null;
  code?: string | null;
  status?: string;
}

type DeskMode = "QR" | "ID" | "PHONE" | "MANUAL";

const MODES: { key: DeskMode; label: string; icon: typeof QrCode; hint: string; inputMode: "text" | "tel" }[] = [
  { key: "QR", label: "QR scan", icon: QrCode, hint: "Scan or type the code from the patient's Health ID QR", inputMode: "text" },
  { key: "ID", label: "Health ID", icon: ShieldCheck, hint: "Type the UAR-BEN-… code from their card", inputMode: "text" },
  { key: "PHONE", label: "Phone", icon: Phone, hint: "Type their registered mobile number", inputMode: "tel" },
  { key: "MANUAL", label: "Name", icon: UserRound, hint: "Search by name and confirm the details", inputMode: "text" },
];

export default function VolunteerCamps({ user }: { user: SessionUser }) {
  const [camps, setCamps] = useState<CampSummary[]>([]);
  const [campId, setCampId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<DeskMode>("QR");
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BeneficiaryLite[]>([]);
  const [searching, setSearching] = useState(false);

  const [queue, setQueue] = useState<AttendanceRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const activeMode = MODES.find((m) => m.key === mode) ?? MODES[0];

  const loadCamps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<unknown>("/api/medical-camps?upcoming=1&status=SCHEDULED,LIVE");
      const list = asArray<CampSummary>(data);
      setCamps(list);
      setCampId((prev) => prev || (list.find((c) => c.status === "LIVE") ?? list[0])?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load camps");
      setCamps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCamps();
  }, [loadCamps]);

  // Debounce the desk search.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(term.trim()), 300);
    return () => window.clearTimeout(t);
  }, [term]);

  useEffect(() => {
    let alive = true;
    if (query.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    get<unknown>(`/api/beneficiaries?q=${encodeURIComponent(query)}&limit=10`)
      .then((data) => {
        if (alive) setResults(asArray<BeneficiaryLite>(data));
      })
      .catch(() => {
        if (alive) setResults([]);
      })
      .finally(() => {
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [query]);

  const loadQueue = useCallback(async () => {
    if (!campId) return;
    setQueueLoading(true);
    try {
      const data = await get<unknown>(`/api/camp-attendance?campId=${campId}`);
      setQueue(asArray<AttendanceRow>(data));
    } catch (e) {
      setQueue([]);
      toastError(e, "Could not load the attendance list");
    } finally {
      setQueueLoading(false);
    }
  }, [campId]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const checkIn = async (b: BeneficiaryLite) => {
    if (!campId) {
      toast.error("Pick a camp first");
      return;
    }
    setBusy(true);
    try {
      // 1. Find (or create) the camp registration for this beneficiary.
      const regs = await get<unknown>(
        `/api/camp-registrations?campId=${campId}&q=${encodeURIComponent(b.name)}`
      );
      let registration = asArray<RegistrationRowLite>(regs).find(
        (r) => r.beneficiaryId === b.id
      );
      if (!registration) {
        await post("/api/camp-registrations", {
          campId,
          beneficiaryId: b.id,
          registeredVia: "DESK",
        });
        const fresh = await get<unknown>(
          `/api/camp-registrations?campId=${campId}&q=${encodeURIComponent(b.name)}`
        );
        registration = asArray<RegistrationRowLite>(fresh).find(
          (r) => r.beneficiaryId === b.id
        );
        if (!registration) {
          toast.error("Registered, but the desk list didn't update — refresh and try the check-in again.");
          await loadQueue();
          return;
        }
        toast.success(`${b.name} registered for the camp`);
      }
      // 2. Check-in — the API assigns the next queue token (idempotent).
      await post("/api/camp-attendance", {
        registrationId: registration.id,
        method: mode,
      });
      toast.success(`${b.name} checked in — token issued`);
      setTerm("");
      setResults([]);
      await loadQueue();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Check-in failed";
      if (/already checked in/i.test(msg)) {
        toast.info(`${b.name} is already checked in for this camp`);
        setTerm("");
        setResults([]);
        await loadQueue();
      } else {
        toastError(e, "Check-in failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const markWaiting = async (row: AttendanceRow) => {
    setRowBusyId(row.id);
    try {
      await patch("/api/camp-attendance", { id: row.id, status: "WAITING" });
      setQueue((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: "WAITING" } : r)));
      toast.success(`${row.beneficiary?.name ?? "Patient"} moved to the waiting queue`);
    } catch (e) {
      toastError(e, "Could not update the check-in");
    } finally {
      setRowBusyId(null);
    }
  };

  const waiting = queue.filter((r) => r.status === "WAITING").length;
  const activeCamp = camps.find((c) => c.id === campId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Medical camps"
        description="Help at the camp desk: register patients and check them into the queue. Patient medical details stay with the doctors."
        icon={<HeartPulse className="size-5" />}
        actions={
          <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => { void loadCamps(); void loadQueue(); }} aria-label="Refresh camps">
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {/* Camp picker */}
      <SectionCard title="Camp" description="Pick the camp you're helping at" icon={<CalendarCheck className="size-5" />}>
        {loading ? (
          <ListSkeleton rows={2} />
        ) : camps.length === 0 ? (
          <QuietEmpty icon={<CalendarCheck className="size-5" />} title="No upcoming camps" error={error} />
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Select camp">
            {camps.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCampId(c.id)}
                aria-pressed={campId === c.id}
                className={cn(
                  "flex min-h-11 flex-col items-start gap-0.5 rounded-xl border px-4 py-2.5 text-left text-sm transition",
                  campId === c.id ? "border-primary bg-primary/10" : "bg-card hover:bg-accent"
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  {c.title}
                  {c.status === "LIVE" && (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                      LIVE
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="size-3 shrink-0" aria-hidden="true" />
                  {formatDate(c.campDate)}
                  {c.venue ? ` · ${c.venue}` : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Registration desk */}
      <SectionCard
        title="Registration desk"
        description={activeMode.hint}
        icon={<Search className="size-5" />}
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Identification method">
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  setMode(m.key);
                  setTerm("");
                  setResults([]);
                }}
                aria-pressed={mode === m.key}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition",
                  mode === m.key ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {m.label}
              </button>
            );
          })}
        </div>

        <Input
          type="search"
          inputMode={activeMode.inputMode}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={
            mode === "PHONE"
              ? "e.g. 98765 43210"
              : mode === "MANUAL"
                ? "e.g. Sunita Devi"
                : "e.g. UAR-BEN-000123"
          }
          aria-label={`Identify patient by ${activeMode.label}`}
          className="mt-3 h-11"
          disabled={!campId}
        />
        {!campId && <p className="mt-2 text-xs text-muted-foreground">Pick a camp above to start registering patients.</p>}

        {searching && <p className="mt-3 text-xs text-muted-foreground" role="status">Searching…</p>}
        {results.length > 0 && (
          <ul className="mt-3 max-h-64 divide-y overflow-y-auto rounded-lg border scrollbar-thin">
            {results.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {beneficiaryCode(b)} · {ageSexLine(b)}
                    {b.phone ? ` · ${b.phone}` : ""}
                  </p>
                </div>
                <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-9" disabled={busy || !campId} onClick={() => void checkIn(b)}>
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  Check in
                </Button>
              </li>
            ))}
          </ul>
        )}
        {term.trim().length >= 2 && !searching && results.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            No match — check the {activeMode.label.toLowerCase()}, or register the person at the UAR help desk first.
          </p>
        )}
      </SectionCard>

      {/* Attendance list */}
      <SectionCard
        title="Attendance"
        description={activeCamp ? `${activeCamp.title} · ${waiting} in queue` : "Attendance for the selected camp"}
        icon={<UserRound className="size-5" />}
      >
        {queueLoading ? (
          <ListSkeleton rows={3} />
        ) : queue.length === 0 ? (
          <QuietEmpty
            icon={<UserRound className="size-5" />}
            title="Nobody checked in yet"
            hint="Use the desk above to register and check patients in. Only names and queue status appear here — never clinical notes."
          />
        ) : (
          <ul className="max-h-[28rem] divide-y overflow-y-auto scrollbar-thin">
            {queue.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.beneficiary?.name ?? "Patient"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.beneficiary ? beneficiaryCode(row.beneficiary) : ""}
                    {row.queueToken != null ? ` · token ${row.queueToken}` : ""}
                    {row.checkInAt ? ` · ${formatDateTime(row.checkInAt)}` : ""}
                  </p>
                </div>
                <StatusBadge status={row.status} tone={medTone(row.status)} />
                {row.status !== "WAITING" && row.status !== "COMPLETED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    disabled={rowBusyId === row.id}
                    onClick={() => void markWaiting(row)}
                    aria-label={`Check ${row.beneficiary?.name ?? "patient"} into the waiting queue`}
                  >
                    Check in
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
