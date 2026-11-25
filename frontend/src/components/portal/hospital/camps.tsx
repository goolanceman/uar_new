"use client";

/**
 * Hospital partner portal — Camps & invitations. Accept/decline camp
 * invitations, open assigned camps (day detail), assign your own staff to the
 * camp roster, and read the completion summary.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarCheck, CheckCircle2, ClipboardCheck, Inbox, MapPin, Stethoscope, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, patch, post } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  asArray,
  ListSkeleton,
  medTone,
  QuietEmpty,
  toastError,
  type CampSummary,
  type ProfessionalRow,
} from "../doctor/shared";
import { PartnerHeader, useMyOrg } from "./shared";
import { useRowBusy } from "@/hooks/use-row-busy";

interface CampPartnerRow {
  id: string;
  status: string; // INVITED | ACCEPTED | DECLINED
  campId?: string | null;
  camp?: {
    id: string;
    code?: string | null;
    title: string;
    campDate?: string | null;
    venue?: string | null;
    city?: string | null;
    status?: string;
  } | null;
  createdAt?: string;
}

interface CampDetail extends CampSummary {
  description?: string | null;
  campPartners?: Array<{ id: string; org?: { id?: string; name?: string } | null; status?: string }>;
  campStaff?: Array<{ id: string; professional?: { id?: string; name?: string; kind?: string } | null; volunteer?: { name?: string } | null }>;
}

export default function PartnerCamps({ user }: { user: SessionUser }) {
  const { org } = useMyOrg();

  const [invites, setInvites] = useState<CampPartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { busyId, setBusyId } = useRowBusy();
  const [declineTarget, setDeclineTarget] = useState<CampPartnerRow | null>(null);

  const [camp, setCamp] = useState<CampDetail | null>(null);
  const [campLoading, setCampLoading] = useState(false);
  const [staff, setStaff] = useState<ProfessionalRow[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<unknown>("/api/camp-partners?mine=1");
      setInvites(asArray<CampPartnerRow>(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load camp invitations");
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pending = invites.filter((i) => (i.status ?? "INVITED").toUpperCase() === "INVITED");
  const accepted = invites.filter((i) => (i.status ?? "").toUpperCase() === "ACCEPTED");

  const respond = async (invite: CampPartnerRow, status: "ACCEPTED" | "DECLINED") => {
    setBusyId(invite.id);
    try {
      await patch(`/api/camp-partners/${invite.id}`, { status });
      toast.success(status === "ACCEPTED" ? "Invitation accepted — see your camps below" : "Invitation declined");
      await load();
    } catch (e) {
      toastError(e, "Could not respond to the invitation");
    } finally {
      setBusyId(null);
    }
  };

  const openCamp = useCallback(async (campId: string) => {
    setCampLoading(true);
    try {
      const [detail, staffData] = await Promise.all([
        get<CampDetail>(`/api/medical-camps/${campId}`),
        get<unknown>("/api/health-professionals").catch(() => []),
      ]);
      setCamp(detail && typeof detail === "object" && "id" in detail ? detail : null);
      setStaff(asArray<ProfessionalRow>(staffData));
    } catch (e) {
      toastError(e, "Could not open the camp");
    } finally {
      setCampLoading(false);
    }
  }, []);

  const assignStaff = async (professionalId: string) => {
    if (!camp) return;
    setAssigningId(professionalId);
    try {
      // Camp roster management is admin-controlled in the current API —
      // the server may reject with 403 for partner accounts.
      await post("/api/camp-staff", { campId: camp.id, professionalId, role: "SUPPORT" });
      toast.success("Staff member assigned to the camp");
      await openCamp(camp.id);
    } catch (e) {
      toastError(e, "Could not assign the staff member");
    } finally {
      setAssigningId(null);
    }
  };

  /* ─────────────────────────── camp day view ─────────────────────────── */

  if (camp) {
    const assignedIds = new Set((camp.campStaff ?? []).map((s) => s.professional?.id).filter(Boolean));
    return (
      <div className="space-y-6">
        <PageHeader
          title={camp.title}
          description={`${formatDate(camp.campDate)}${camp.venue ? ` · ${camp.venue}` : ""}`}
          actions={
            <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => setCamp(null)} aria-label="Back to camps">
              <ArrowLeft className="size-4" aria-hidden="true" />
              All camps
            </Button>
          }
        />

        <SectionCard title="Completion summary" description="Live counters from the camp day" icon={<ClipboardCheck className="size-5" />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Patients registered", value: camp.counts?.registrations ?? 0 },
              { label: "Checked in", value: camp.counts?.checkedIn ?? 0 },
              { label: "Consultations done", value: camp.counts?.completed ?? 0 },
              { label: "Status", value: camp.status },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border bg-card p-3 text-center sm:p-4">
                <p className="truncate text-2xl font-bold tabular-nums">{s.value}</p>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Assign your staff" description="Roster your own clinical team for this camp" icon={<Users className="size-5" />}>
          {staff.length === 0 ? (
            <QuietEmpty icon={<Users className="size-5" />} title="No staff in your organisation yet" hint="Add staff from the Profile tab first." />
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto scrollbar-thin">
              {staff.map((s) => {
                const already = assignedIds.has(s.id);
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.kind ? s.kind.replace("_", " ") : "Staff"}
                        {s.speciality ? ` · ${s.speciality}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={s.verificationStatus ?? "PENDING"} tone={medTone(s.verificationStatus)}>
                      {s.verificationStatus === "VERIFIED" ? "Verified" : "Awaiting verification"}
                    </StatusBadge>
                    {already ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        Assigned
                      </span>
                    ) : (
                      <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" disabled={assigningId === s.id} onClick={() => void assignStaff(s.id)}>
                        Assign
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>
    );
  }

  /* ────────────────────────────── list view ────────────────────────────── */

  return (
    <div className="space-y-6">
      <PartnerHeader
        title="Camps & invitations"
        description="Invitations from UAR coordinators and the camps you're part of."
      />

      <SectionCard
        title="Invitations"
        description={pending.length > 0 ? `${pending.length} waiting for your response` : "No pending invitations"}
        icon={<Inbox className="size-5" />}
      >
        {loading ? (
          <ListSkeleton rows={2} />
        ) : pending.length === 0 ? (
          <QuietEmpty icon={<Inbox className="size-5" />} title="No pending invitations" error={error} />
        ) : (
          <ul className="divide-y">
            {pending.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.camp?.title ?? "Medical camp"}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                    {inv.camp ? `${formatDate(inv.camp.campDate)}${inv.camp.venue ? ` · ${inv.camp.venue}` : ""}` : "Date to be confirmed"}
                  </p>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <Button size="sm" className="min-h-11 flex-1 gap-1.5 sm:min-h-9 sm:flex-none" disabled={busyId !== null} onClick={() => void respond(inv, "ACCEPTED")}>
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" disabled={busyId !== null} onClick={() => setDeclineTarget(inv)} aria-label="Decline invitation">
                    <X className="size-4" aria-hidden="true" />
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Your camps" description="Accepted invitations — open a camp for staff assignment and the day summary" icon={<CalendarCheck className="size-5" />}>
        {loading ? (
          <ListSkeleton rows={2} />
        ) : accepted.length === 0 ? (
          <QuietEmpty icon={<CalendarCheck className="size-5" />} title="No camps yet" hint="Accept an invitation above to take part in a camp." />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto scrollbar-thin">
            {accepted.map((inv) => {
              const c = inv.camp;
              return (
                <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Stethoscope className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c?.title ?? "Medical camp"}</p>
                    <p className="text-xs text-muted-foreground">
                      {c ? `${formatDate(c.campDate)}${c.venue ? ` · ${c.venue}` : ""}` : ""}
                    </p>
                  </div>
                  {c && <StatusBadge status={c.status} tone={medTone(c.status)} />}
                  <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => c && void openCamp(c.id)} aria-label="Open camp detail">
                    Open
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* Decline confirmation */}
      <ConfirmDialog
        open={!!declineTarget}
        onOpenChange={(o) => !o && setDeclineTarget(null)}
        title="Decline this camp invitation?"
        recordName={declineTarget?.camp?.title}
        description="The UAR coordinator will be notified and may invite another partner organisation."
        confirmLabel="Decline"
        loading={busyId === declineTarget?.id}
        onConfirm={() => {
          if (declineTarget) void respond(declineTarget, "DECLINED");
        }}
      />
    </div>
  );
}
