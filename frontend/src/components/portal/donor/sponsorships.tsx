"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarRange,
  HeartHandshake,
  MapPin,
  Pause,
  Pill,
  Play,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch } from "@/lib/api-client";
import { formatDate, formatINR, titleCase } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRowBusy } from "@/hooks/use-row-busy";

interface SponsorshipRow {
  id: string;
  donorName: string;
  amountPerMonth: number;
  months: number;
  status: string; // ACTIVE | PAUSED | COMPLETED | CANCELLED
  startDate: string;
  beneficiary: { id: string; name: string; city?: string | null; category: string };
  recurringNeed?: { item: { name: string; unit: string } } | null;
}

export default function DonorSponsorships({ user }: { user: SessionUser }) {
  const [rows, setRows] = useState<SponsorshipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { busyId, setBusyId } = useRowBusy();
  const [cancelTarget, setCancelTarget] = useState<SponsorshipRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<SponsorshipRow[]>("/api/sponsorships?mine=1");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load your sponsorships");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (row: SponsorshipRow) => {
    const next = row.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setBusyId(row.id);
    try {
      await patch(`/api/sponsorships/${row.id}`, { status: next });
      toast.success(next === "PAUSED" ? "Sponsorship paused" : "Sponsorship resumed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update sponsorship");
    } finally {
      setBusyId(null);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setBusyId(cancelTarget.id);
    try {
      await patch(`/api/sponsorships/${cancelTarget.id}`, { status: "CANCELLED" });
      toast.success("Sponsorship cancelled");
      setCancelTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel sponsorship");
    } finally {
      setBusyId(null);
    }
  };

  const active = rows.filter((r) => r.status === "ACTIVE");
  const paused = rows.filter((r) => r.status === "PAUSED");
  const monthlyTotal = active.reduce((s, r) => s + r.amountPerMonth, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My sponsorships"
        description="Beneficiaries you're committed to supporting every month — assigned by our team based on verified, standing needs."
        icon={<HeartHandshake className="size-5" aria-hidden="true" />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Active sponsorships"
          value={active.length}
          icon={<HeartHandshake className="size-5" aria-hidden="true" />}
          accent="emerald"
          loading={loading}
        />
        <StatCard
          label="Monthly commitment"
          value={`${formatINR(monthlyTotal)}/mo`}
          icon={<CalendarRange className="size-5" aria-hidden="true" />}
          accent="teal"
          loading={loading}
        />
        <StatCard
          label="Paused"
          value={paused.length}
          icon={<Pause className="size-5" aria-hidden="true" />}
          accent="amber"
          loading={loading}
        />
      </div>

      <SectionCard
        title="Your beneficiaries"
        description="Pause if you need a break, or cancel to free up the slot for another supporter."
        icon={<Pill className="size-5" aria-hidden="true" />}
      >
        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<HeartHandshake className="size-6" aria-hidden="true" />}
            title="No sponsorships yet"
            hint="Our team assigns monthly sponsorships from verified beneficiary cases with standing needs — reach out to us to be considered, or look out for an assignment after your next monthly gift."
          />
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{r.beneficiary.name}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3" aria-hidden="true" />
                      {r.beneficiary.city ?? "\u2014"} \u00b7 {titleCase(r.beneficiary.category)}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                {r.recurringNeed && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Covers: {r.recurringNeed.item.name} ({r.recurringNeed.item.unit})
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {formatINR(r.amountPerMonth)}/mo \u00d7 {r.months}mo \u00b7 since {formatDate(r.startDate)}
                  </span>
                  {(r.status === "ACTIVE" || r.status === "PAUSED") && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggle(r)}
                        disabled={busyId !== null}
                        aria-label={r.status === "ACTIVE" ? "Pause sponsorship" : "Resume sponsorship"}
                      >
                        {r.status === "ACTIVE" ? (
                          <>
                            <Pause className="size-3.5" aria-hidden="true" /> Pause
                          </>
                        ) : (
                          <>
                            <Play className="size-3.5" aria-hidden="true" /> Resume
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setCancelTarget(r)}
                        disabled={busyId !== null}
                        aria-label="Cancel sponsorship"
                      >
                        <XCircle className="size-3.5" aria-hidden="true" /> Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Cancel this sponsorship?"
        recordName={cancelTarget?.beneficiary.name ?? ""}
        description="This frees up the slot for another supporter. You can always start a new sponsorship later."
        confirmLabel="Cancel sponsorship"
        onConfirm={confirmCancel}
      />
    </div>
  );
}
