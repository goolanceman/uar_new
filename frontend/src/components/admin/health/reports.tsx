"use client";

/**
 * Health Programme — Reports tab.
 *
 * Camp report cards (registrations / checked-in / completed / expenses per
 * camp), CSV exports (attendance per camp, referrals, expenses) and a
 * print-friendly summary (print CSS scopes the page to the report cards).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  FileBarChart,
  Loader2,
  Printer,
  RefreshCw,
  Tent,
} from "lucide-react";
import { toast } from "sonner";
import { get } from "@/lib/api-client";
import { formatDate, formatINR } from "@/lib/format";
import { CampStatusBadge, StatTile } from "@/components/admin/health/shared";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCsv } from "@/components/shared/csv";
import type { TabProps } from "./overview";
import {
  asPaged,
  errorText,
  type AttendanceRow,
  type CampAttendanceSummary,
  type ExpenseRow,
  type MedicalCamp,
  type RegRow,
  type ReferralRow,
} from "./shared";

interface CampReport {
  camp: MedicalCamp;
  summary: CampAttendanceSummary | null;
  expenseTotal: number | null;
}

/** programmes.food shape from GET /api/reports (optional, ADMIN-only endpoint). */
interface FoodSnapshot {
  kits: { templates: number; batches: number; totalUnits: number; scannedUnits: number; scannedInRange: number; readyUnits: number; expiredUnits: number };
  distributions: { count: number; quantity: number; value: number; beneficiaries: number };
  inventory: { items: number; stockUnits: number; lowStock: number };
}

export default function ReportsTab({ revision }: TabProps) {
  const [camps, setCamps] = useState<MedicalCamp[] | null>(null);
  const [reports, setReports] = useState<Record<string, CampReport>>({});
  const [food, setFood] = useState<FoodSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingCampId, setLoadingCampId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await get<unknown>("/api/medical-camps?limit=50&withCounts=1");
      setCamps(asPaged<MedicalCamp>(d).items);
      setReports({});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Food programme snapshot — silent: hidden for non-admin roles (the reports
  // endpoint is ADMIN-gated).
  useEffect(() => {
    let alive = true;
    get<{ programmes?: { food?: FoodSnapshot } }>("/api/reports", { suppressAuthRedirect: true })
      .then((d) => {
        if (alive) setFood(d?.programmes?.food ?? null);
      })
      .catch(() => {
        if (alive) setFood(null);
      });
    return () => {
      alive = false;
    };
  }, [revision]);

  useEffect(() => {
    load();
  }, [load, revision]);

  /** Lazily load one camp's summary + expense total (cards stay light). */
  const loadCampReport = useCallback(async (camp: MedicalCamp) => {
    setLoadingCampId(camp.id);
    const [summary, expenses] = await Promise.allSettled([
      get<unknown>(`/api/camp-attendance?campId=${camp.id}&summary=1`),
      get<unknown>(`/api/camp-expenses?campId=${camp.id}`),
    ]);
    setReports((prev) => ({
      ...prev,
      [camp.id]: {
        camp,
        summary:
          summary.status === "fulfilled"
            ? ((summary.value as { summary?: CampAttendanceSummary }).summary ?? null)
            : null,
        expenseTotal:
          expenses.status === "fulfilled"
            ? ((expenses.value as { totalAmount?: number }).totalAmount ?? null)
            : null,
      },
    }));
    setLoadingCampId(null);
  }, []);

  /* ------------------------------ CSV exports ----------------------------- */

  const exportAttendance = async (camp: MedicalCamp) => {
    try {
      const d = await get<unknown>(`/api/camp-attendance?campId=${camp.id}&limit=500`);
      const rows = asPaged<AttendanceRow>(d).items;
      downloadCsv(
        `uar-attendance-${camp.code}`,
        [
          { header: "Token", value: (r) => r.queueToken ?? "" },
          { header: "Beneficiary", value: (r) => r.beneficiary?.name ?? "" },
          { header: "Status", value: (r) => r.status },
          { header: "Check-in method", value: (r) => r.checkInMethod ?? "" },
          { header: "Checked in at", value: (r) => r.checkInAt ?? "" },
        ].map((c) => c),
        rows
      );
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const exportRegistrations = async (camp: MedicalCamp) => {
    try {
      const d = await get<unknown>(`/api/camp-registrations?campId=${camp.id}&limit=500`);
      const rows = asPaged<RegRow>(d).items;
      downloadCsv(
        `uar-registrations-${camp.code}`,
        [
          { header: "Code", value: (r) => r.code ?? "" },
          { header: "Beneficiary", value: (r) => r.beneficiary?.name ?? "" },
          { header: "Phone", value: (r) => r.beneficiary?.phone ?? "" },
          { header: "Status", value: (r) => r.status },
          { header: "Via", value: (r) => r.registeredVia ?? "" },
        ],
        rows
      );
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const exportExpenses = async (camp: MedicalCamp) => {
    try {
      const d = await get<unknown>(`/api/camp-expenses?campId=${camp.id}`);
      const rows = asPaged<ExpenseRow>(d).items;
      downloadCsv(
        `uar-expenses-${camp.code}`,
        [
          { header: "Head", value: (r) => r.head },
          { header: "Amount", value: (r) => r.amount },
          { header: "Notes", value: (r) => r.notes ?? "" },
        ],
        rows
      );
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const exportAllReferrals = async () => {
    try {
      const d = await get<unknown>("/api/referrals?limit=500");
      const rows = asPaged<ReferralRow>(d).items;
      downloadCsv(
        "uar-referrals",
        [
          { header: "Beneficiary", value: (r) => r.beneficiary?.name ?? "" },
          { header: "Facility", value: (r) => r.facility ?? "" },
          { header: "Priority", value: (r) => r.priority ?? "" },
          { header: "Status", value: (r) => r.status },
        ],
        rows
      );
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  /* ------------------------------- derived -------------------------------- */

  const totals = useMemo(() => {
    const list = camps ?? [];
    const registrations = list.reduce((s, c) => s + (c.counts?.registrations ?? 0), 0);
    const checkedIn = list.reduce((s, c) => s + (c.counts?.checkedIn ?? 0), 0);
    const completed = list.reduce((s, c) => s + (c.counts?.completed ?? 0), 0);
    return { registrations, checkedIn, completed, camps: list.length };
  }, [camps]);

  return (
    <div className="space-y-4 print-area">
      {/* summary — the only section that survives window.print() */}
      <div className="print:hidden">
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          <StatCard label="Camps in report" value={loading ? "…" : totals.camps} icon={<Tent className="size-5" aria-hidden="true" />} accent="emerald" loading={loading} />
          <StatCard label="Total registrations" value={loading ? "…" : totals.registrations} icon={<Tent className="size-5" aria-hidden="true" />} accent="cyan" loading={loading} />
          <StatCard label="Checked in" value={loading ? "…" : totals.checkedIn} icon={<Tent className="size-5" aria-hidden="true" />} accent="teal" loading={loading} />
          <StatCard label="Consultations done" value={loading ? "…" : totals.completed} icon={<Tent className="size-5" aria-hidden="true" />} accent="lime" loading={loading} />
        </div>
      </div>

      {/* Food programme snapshot — admin-only (comes from the admin reports API) */}
      {food && (
        <SectionCard
          title="Food programme snapshot"
          description="Ration-kit pipeline, distributions and stock — current financial year"
          icon={<FileBarChart className="size-4" aria-hidden="true" />}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            <StatTile label="Kit units assembled" value={food.kits.totalUnits.toLocaleString("en-IN")} tone="success" />
            <StatTile label="Units scanned" value={food.kits.scannedUnits.toLocaleString("en-IN")} tone="info" />
            <StatTile label="Units ready" value={food.kits.readyUnits.toLocaleString("en-IN")} />
            <StatTile label="Food distributions" value={food.distributions.count.toLocaleString("en-IN")} tone="progress" />
            <StatTile label="Beneficiaries served" value={food.distributions.beneficiaries.toLocaleString("en-IN")} tone="success" />
            <StatTile label="Stock units (FOOD_KIT)" value={food.inventory.stockUnits.toLocaleString("en-IN")} />
            <StatTile label="Low-stock alerts" value={food.inventory.lowStock.toLocaleString("en-IN")} tone={food.inventory.lowStock > 0 ? "danger" : undefined} />
          </div>
          {food.inventory.lowStock > 0 && (
            <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-500/30 dark:text-red-400">
              {food.inventory.lowStock} FOOD_KIT item{food.inventory.lowStock === 1 ? "" : "s"} at or below minimum stock — restock before the next distribution lane.
            </p>
          )}
        </SectionCard>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Per-camp reports</h2>
        <span className="text-xs text-muted-foreground">Open a camp card to pull its attendance summary and expenses.</span>
        <div className="flex gap-2 sm:ml-auto">
          <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={exportAllReferrals}>
            <Download className="size-4" aria-hidden="true" /> All referrals (CSV)
          </Button>
          <Button variant="outline" className="min-h-11 sm:min-h-9 print:hidden" onClick={() => window.print()} aria-label="Print report summary">
            <Printer className="size-4" aria-hidden="true" /> Print summary
          </Button>
          <Button variant="outline" className="min-h-11 sm:min-h-9 print:hidden" onClick={load} aria-label="Refresh reports">
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <EmptyState icon={<FileBarChart className="size-8" aria-hidden="true" />} title="Reports could not load" hint={error}>
          <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
            Retry
          </Button>
        </EmptyState>
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : (camps ?? []).length === 0 ? (
        <EmptyState
          icon={<FileBarChart className="size-8" aria-hidden="true" />}
          title="No camps to report on yet"
          hint="Create a camp and run it — its attendance, consultations and expenses roll up here automatically."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 print:grid-cols-2">
          {(camps ?? []).map((c) => {
            const rep = reports[c.id];
            return (
              <SectionCard
                key={c.id}
                title={c.title}
                description={`${formatDate(c.campDate)} · ${[c.venue, c.city].filter(Boolean).join(", ")}`}
                actions={<CampStatusBadge status={c.status} />}
              >
                <div className="grid grid-cols-3 gap-2">
                  <StatTile label="Reg." value={c.counts?.registrations ?? 0} />
                  <StatTile label="In" value={c.counts?.checkedIn ?? 0} />
                  <StatTile label="Done" value={c.counts?.completed ?? 0} />
                </div>
                {rep ? (
                  <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                    Queue: {rep.summary ? `${rep.summary.checkedIn} in · ${rep.summary.waiting} waiting · ${rep.summary.noShow} no-show` : "summary unavailable"}
                    {rep.expenseTotal != null ? ` · spent ${formatINR(rep.expenseTotal)}` : ""}
                  </p>
                ) : loadingCampId === c.id ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Loading details…
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-1.5 print:hidden">
                  {rep ? (
                    <>
                      <Button size="sm" variant="outline" className="min-h-9" onClick={() => exportAttendance(c)}>
                        <Download className="size-3.5" aria-hidden="true" /> Attendance
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-9" onClick={() => exportRegistrations(c)}>
                        <Download className="size-3.5" aria-hidden="true" /> Registrations
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-9" onClick={() => exportExpenses(c)}>
                        <Download className="size-3.5" aria-hidden="true" /> Expenses
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" className="min-h-9" onClick={() => loadCampReport(c)}>
                      <FileBarChart className="size-3.5" aria-hidden="true" /> Load report
                    </Button>
                  )}
                </div>
              </SectionCard>
            );
          })}
        </div>
      )}

      {/* print-only footer */}
      <p className="hidden text-center text-xs text-muted-foreground print:block">
        United Angel Reach · Health Programme report · generated {formatDate(new Date())}
      </p>
    </div>
  );
}
