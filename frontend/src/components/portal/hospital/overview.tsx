"use client";

/**
 * Hospital partner portal — Overview. Org verification status banner, quick
 * stats, and a simple camp history table (the "reports" placeholder).
 */

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, RefreshCw, ShieldQuestion, Stethoscope, Users } from "lucide-react";
import { get } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import type { SessionUser } from "@/hooks/use-auth";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  asArray,
  ListSkeleton,
  medTone,
  QuietEmpty,
  type CampSummary,
  type ProfessionalRow,
  type ReferralRow,
} from "../doctor/shared";
import { OrgNotFound, PartnerHeader, useMyOrg } from "./shared";

export default function PartnerOverview({ user }: { user: SessionUser }) {
  const { org, loading: orgLoading, error: orgError, reload } = useMyOrg();
  const [staff, setStaff] = useState<ProfessionalRow[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [camps, setCamps] = useState<CampSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        get<unknown>("/api/health-professionals").catch(() => []),
        get<unknown>("/api/referrals").catch(() => []),
        get<unknown>("/api/medical-camps?upcoming=1&status=SCHEDULED,LIVE,COMPLETED").catch(() => []),
      ]);
      setStaff(asArray<ProfessionalRow>(results[0]));
      setReferrals(asArray<ReferralRow>(results[1]));
      setCamps(asArray<CampSummary>(results[2]));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pendingReferrals = referrals.filter((r) => r.status === "PENDING").length;
  const activeCamps = camps.filter((c) => c.status === "LIVE" || c.status === "SCHEDULED").length;
  const verifiedStaff = staff.filter((s) => s.verificationStatus === "VERIFIED").length;

  return (
    <div className="space-y-6">
      <PartnerHeader
        title={org?.name ?? "Partner portal"}
        description="Your organisation's engagement with UAR medical camps."
        actions={
          <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => { void reload(); void load(); }} aria-label="Refresh overview">
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {/* Verification status banner */}
      {orgLoading ? (
        <Skeleton className="h-16 w-full rounded-xl" />
      ) : orgError && !org ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
          {orgError}
        </div>
      ) : !org ? (
        <OrgNotFound />
      ) : (org.status ?? "PENDING").toUpperCase() === "PENDING" ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200"
        >
          <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <p>
            <span className="font-semibold">Awaiting verification.</span> A UAR admin reviews your
            organisation before camps and referrals flow through — profile details can be updated
            anytime from the Profile tab.
          </p>
        </div>
      ) : (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200"
        >
          <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <p>
            <span className="font-semibold">Verified partner.</span> Your organisation can receive
            camp invitations and patient referrals.
          </p>
        </div>
      )}

      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Staff registered" value={loading ? "" : String(staff.length)} icon={<Users className="size-5" />} accent="emerald" loading={loading || orgLoading} />
        <StatCard label="Verified staff" value={loading ? "" : String(verifiedStaff)} icon={<ClipboardCheck className="size-5" />} accent="teal" loading={loading || orgLoading} />
        <StatCard label="Incoming referrals" value={loading ? "" : String(pendingReferrals)} hint={`${referrals.length} total`} icon={<Stethoscope className="size-5" />} accent="amber" loading={loading || orgLoading} />
        <StatCard label="Upcoming camps" value={loading ? "" : String(activeCamps)} icon={<Stethoscope className="size-5" />} accent="lime" loading={loading || orgLoading} />
      </div>

      {/* Camp history (reports placeholder) */}
      <SectionCard title="Camp history" description="Camps your organisation has taken part in — a fuller report pack is on the way" icon={<Stethoscope className="size-5" />}>
        {loading ? (
          <ListSkeleton rows={3} />
        ) : camps.length === 0 ? (
          <QuietEmpty icon={<Stethoscope className="size-5" />} title="No camps on record yet" hint="Once you accept a camp invitation it appears here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Camp</th>
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="hidden py-2 pr-4 font-medium sm:table-cell">Location</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {camps.map((c) => (
                  <tr key={c.id} className="hover:bg-accent/40">
                    <td className="py-2.5 pr-4 font-medium">{c.title}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{formatDate(c.campDate)}</td>
                    <td className="hidden py-2.5 pr-4 text-muted-foreground sm:table-cell">{c.venue || c.city || "—"}</td>
                    <td className="py-2.5">
                      <StatusBadge status={c.status} tone={medTone(c.status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
