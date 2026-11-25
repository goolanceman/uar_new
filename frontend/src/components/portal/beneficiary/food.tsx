"use client";

/**
 * Beneficiary portal — "My Food" tab.
 * Available food distributions (published events), self-registration,
 * the beneficiary's own registrations and handover history, and a
 * low-friction way to report a problem. Data comes only from the
 * beneficiary's own records — never another household's.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Apple, CalendarPlus, MessageSquareWarning, PackageCheck,
} from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, post } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TextareaField } from "@/components/shared/form-fields";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useRowBusy } from "@/hooks/use-row-busy";

interface PublicEvent {
  id: string;
  code: string;
  title: string;
  eventDate: string;
  startTime?: string | null;
  venue: string;
  city?: string | null;
  status: string;
  registrationOpen: boolean;
  programme?: { title: string; eligibilityCriteria: string | null } | null;
  registeredCount?: number | null;
  maxCapacity?: number | null;
}

interface MyRegistration {
  id: string;
  code: string;
  status: string;
  unitsAllocated: number;
  unitsDelivered: number;
  reason?: string | null;
  createdAt: string;
  event: {
    id: string; code: string; title: string; eventDate: string;
    venue: string; city?: string | null; status: string;
    programme?: { title: string } | null;
  };
}

const REG_STATUS_COPY: Record<string, string> = {
  REGISTERED: "Registered — waiting for approval",
  APPROVED: "Approved — you can attend",
  CONFIRMED: "Confirmed — see you there",
  CHECKED_IN: "Checked in at the venue",
  DISTRIBUTED: "Food received",
  PARTIALLY_DISTRIBUTED: "Partially received",
  NOT_COLLECTED: "Not collected",
  NO_SHOW: "Missed — you can be rescheduled",
  CANCELLED: "Cancelled",
  RESCHEDULED: "Rescheduled",
  REJECTED: "Not approved this time",
};

export default function BeneficiaryFood({ user }: { user: SessionUser }) {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [regs, setRegs] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const { busyId, setBusyId } = useRowBusy();
  const [report, setReport] = useState<{ reg: MyRegistration | null; text: string }>({ reg: null, text: "" });

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled([
      get<PublicEvent[]>("/api/food/events?public=1").then((d) => setEvents(Array.isArray(d) ? d : [])),
      get<MyRegistration[]>("/api/food/events?mine=1").then((d) => setRegs(Array.isArray(d) ? d : [])),
    ]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const register = async (e: PublicEvent) => {
    setBusyId(e.id);
    try {
      await post(`/api/food/events/${e.id}/registrations`, {});
      toast.success("Registered! Remember to bring your registration code on the day.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusyId(null);
    }
  };

  const sendReport = async () => {
    if (!report.reg || report.text.trim().length < 10) {
      toast.error("Tell us briefly what went wrong (at least a sentence)");
      return;
    }
    try {
      await post("/api/beneficiary-requests", {
        category: "FOOD_FEEDBACK",
        urgency: "MEDIUM",
        details: `Issue with ${report.reg.code} (${report.reg.event.title}): ${report.text.trim()}`,
      });
      toast.success("Reported — our team will follow up with you");
      setReport({ reg: null, text: "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send report");
    }
  };

  const registeredEventIds = new Set(regs.map((r) => r.event.id));
  const openForMe = events.filter((e) => e.status === "REGISTRATION_OPEN" && !registeredEventIds.has(e.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Food Assistance"
        description="Distributions open to you, your registrations and your food assistance history."
        icon={<Apple className="size-5" />}
      />

      <SectionCard title="Open for registration" description="Distribution events you can join" icon={<CalendarPlus className="size-4" />}>
        {loading ? (
          <div className="space-y-2 px-5 pb-5">{[0, 1].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        ) : openForMe.length === 0 ? (
          <EmptyState
            icon={<CalendarPlus className="size-8" />}
            title={regs.length ? "You're registered for everything open" : "No distributions open right now"}
            hint="New events appear here as soon as they're published. You'll also get a notification."
            className="border-0"
          />
        ) : (
          <ul className="divide-y px-5 pb-5">
            {openForMe.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(e.eventDate)}{e.startTime ? ` · ${e.startTime}` : ""} · {e.venue}{e.city ? `, ${e.city}` : ""}
                  </p>
                  {e.programme?.eligibilityCriteria && (
                    <p className="text-xs text-muted-foreground">For: {e.programme.eligibilityCriteria}</p>
                  )}
                </div>
                <Button size="sm" onClick={() => register(e)} disabled={busyId !== null}>
                  {busyId === e.id ? "Registering…" : "Register"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="My registrations & assistance history" description="Every food registration and handover linked to you" icon={<PackageCheck className="size-4" />}>
        {loading ? (
          <div className="space-y-2 px-5 pb-5">{[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : regs.length === 0 ? (
          <EmptyState
            icon={<PackageCheck className="size-8" />}
            title="No food assistance yet"
            hint="Register for an open distribution above, or apply for ongoing support on the public site."
            className="border-0"
          />
        ) : (
          <ul className="divide-y px-5 pb-5">
            {regs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {r.event.title} <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(r.event.eventDate)} · {r.event.venue} · {REG_STATUS_COPY[r.status] ?? r.status}
                    {r.unitsDelivered ? ` · ${r.unitsDelivered} of ${r.unitsAllocated} unit(s) received` : ` · ${r.unitsAllocated} unit(s) allocated`}
                  </p>
                  {r.reason && <p className="text-xs text-muted-foreground">Reason on record: {r.reason.replace(/_/g, " ").toLowerCase()}</p>}
                </div>
                <StatusBadge status={r.status} />
                {["DISTRIBUTED", "PARTIALLY_DISTRIBUTED", "NOT_COLLECTED", "NO_SHOW"].includes(r.status) && (
                  <Button size="sm" variant="ghost" onClick={() => setReport({ reg: r, text: "" })}>
                    <MessageSquareWarning className="size-4" /> Report a problem
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Dialog open={!!report.reg} onOpenChange={(o) => !o && setReport({ reg: null, text: "" })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report a problem</DialogTitle>
            <DialogDescription>
              {report.reg && <>About {report.reg.code} — {report.reg.event.title}. Our team follows up confidentially.</>}
            </DialogDescription>
          </DialogHeader>
          <TextareaField
            label="What went wrong?"
            value={report.text}
            onChange={(v) => setReport((r) => ({ ...r, text: v }))}
            placeholder="Items missing, quality concern, behaviour issue, couldn't reach the venue…"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReport({ reg: null, text: "" })}>Cancel</Button>
            <Button onClick={sendReport}>Send report</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
