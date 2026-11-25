"use client";

/**
 * Beneficiary portal — My Health. Strictly own-record: health ID card with QR,
 * upcoming camps + self registration, registrations/appointments, medical
 * timeline, prescriptions (print), lab reports (download), referrals,
 * follow-ups and personal documents. APIs scope to the caller server-side.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  FileDown,
  FileText,
  FlaskConical,
  HeartPulse,
  Pill,
  Printer,
  QrCode,
  RefreshCw,
  Share2,
  Stethoscope,
  Upload,
  Users,
} from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { get, post } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FilePickButton, fileUrl } from "@/components/shared/file-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  asArray,
  beneficiaryCode,
  ListSkeleton,
  medTone,
  toastError,
  type BeneficiaryLite,
  type CampSummary,
  type FollowUpRow,
  type LabOrderRow,
  type PrescriptionRow,
  type ReferralRow,
  type TimelineItem,
} from "../doctor/shared";

interface AppointmentRow {
  id: string;
  status: string;
  scheduledAt?: string | null;
  notes?: string | null;
}

interface RegistrationRow {
  id: string;
  campId?: string | null;
  camp?: { id?: string; title?: string; campDate?: string; venue?: string; city?: string } | null;
  createdAt?: string;
}

interface DocumentRow {
  id: string;
  title?: string | null;
  url: string;
  createdAt?: string;
}

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  ENCOUNTER: Stethoscope,
  PRESCRIPTION: Pill,
  LAB: FlaskConical,
  VITALS: HeartPulse,
  REFERRAL: Share2,
  FOLLOW_UP: CalendarDays,
  DOCUMENT: FileText,
};

function timelineIcon(kind?: string | null) {
  const Icon = KIND_ICON[(kind ?? "").toUpperCase()] ?? ClipboardList;
  return <Icon className="size-4" aria-hidden="true" />;
}

export default function BeneficiaryHealth({ user }: { user: SessionUser }) {
  const [me, setMe] = useState<BeneficiaryLite | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [camps, setCamps] = useState<CampSummary[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRow[]>([]);
  const [labs, setLabs] = useState<LabOrderRow[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);

  const [registeringId, setRegisteringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Own beneficiary record (?mine=1 works for any signed-in account).
    let mine: BeneficiaryLite | null = null;
    try {
      const rows = await get<unknown>("/api/beneficiaries?mine=1");
      mine = asArray<BeneficiaryLite>(rows)[0] ?? null;
      if (!mine && rows && typeof rows === "object" && "id" in (rows as object)) {
        mine = rows as BeneficiaryLite;
      }
    } catch {
      mine = null;
    }
    setMe(mine);

    // Everything else is independent — one gap never blanks the page.
    const results = await Promise.all([
      get<unknown>("/api/medical-camps?upcoming=1&status=SCHEDULED,LIVE").catch((e: unknown) => ({ __e: e })),
      get<unknown>("/api/camp-registrations").catch(() => []),
      get<unknown>("/api/appointments").catch(() => []),
      get<unknown>("/api/health-timeline").catch(() => []),
      get<unknown>("/api/prescriptions").catch(() => []),
      get<unknown>("/api/lab-orders").catch(() => []),
      get<unknown>("/api/referrals").catch(() => []),
      get<unknown>("/api/follow-ups").catch(() => []),
      get<unknown>("/api/medical-documents").catch(() => []),
    ]);
    const err0 = results[0] as { __e?: unknown };
    if (err0 && "__e" in err0) {
      setError(err0.__e instanceof Error ? err0.__e.message : "Could not load upcoming camps");
      setCamps([]);
    } else {
      setCamps(asArray<CampSummary>(results[0]));
    }
    setRegistrations(asArray<RegistrationRow>(results[1]));
    setAppointments(asArray<AppointmentRow>(results[2]));
    setTimeline(asArray<TimelineItem>(results[3]));
    setPrescriptions(asArray<PrescriptionRow>(results[4]));
    setLabs(asArray<LabOrderRow>(results[5]));
    setReferrals(asArray<ReferralRow>(results[6]));
    setFollowUps(asArray<FollowUpRow>(results[7]));
    setDocuments(asArray<DocumentRow>(results[8]));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // QR for the health ID card (same client-side pattern as kit labels).
  useEffect(() => {
    let alive = true;
    if (!me) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(beneficiaryCode(me), { margin: 1, width: 160 })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        if (alive) setQr(null);
      });
    return () => {
      alive = false;
    };
  }, [me]);

  const registeredCampIds = new Set(registrations.map((r) => r.campId ?? r.camp?.id).filter(Boolean));

  const register = async (camp: CampSummary) => {
    if (!me) {
      toast.error("Your case record isn't linked yet — send a help request from the Help Centre so the team can register you.");
      return;
    }
    setRegisteringId(camp.id);
    try {
      await post("/api/camp-registrations", {
        campId: camp.id,
        beneficiaryId: me.id,
        registeredVia: "SELF",
      });
      toast.success(`Registered for ${camp.title} — arrive with this Health ID`);
      await load();
    } catch (e) {
      toastError(e, "Could not register for the camp");
    } finally {
      setRegisteringId(null);
    }
  };

  const printHealthCard = () => {
    if (!me || !qr) return;
    const code = beneficiaryCode(me);
    const w = window.open("", "_blank", "noopener,width=620,height=760");
    if (!w) {
      toast.error("Allow pop-ups to print your Health ID");
      return;
    }
    w.document.write(`<!doctype html><html><head><title>UAR Health ID — ${code}</title>
      <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#111}
      .card{border:2px solid #059669;border-radius:16px;padding:32px;text-align:center;max-width:340px}
      img{width:160px;height:160px}h1{font-size:18px;margin:12px 0 4px}p{margin:4px 0;color:#444;font-size:14px}
      .brand{letter-spacing:2px;font-size:11px;color:#059669;font-weight:700}</style></head>
      <body><div class="card"><div class="brand">UNITED ANGEL REACH</div>
      <img src="${qr}" alt="Health ID QR" /><h1>${me.name}</h1><p><strong>${code}</strong></p>
      <p>United Angel Reach medical programmes</p><p style="font-size:11px">Show this QR at camps, pharmacies and labs</p></div>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  const registerable = camps.filter((c) => !registeredCampIds.has(c.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Health"
        description="Your medical record with United Angel Reach — camps, prescriptions, reports and referrals."
        icon={<HeartPulse className="size-5" />}
        actions={
          <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={load} aria-label="Refresh my health">
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {/* Health ID card */}
      <SectionCard title="My Health ID" description="Show this QR at every UAR camp, pharmacy counter and lab" icon={<QrCode className="size-5" />}>
        {loading ? (
          <div className="flex items-center gap-4" aria-label="Loading health ID">
            <Skeleton className="size-32 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        ) : me ? (
          <div className="flex flex-wrap items-center gap-5">
            {qr ? (
              <img src={qr} alt={`Health ID QR code for ${me.name}`} className="size-32 rounded-xl border bg-background p-2" width={128} height={128} />
            ) : (
              <div className="flex size-32 items-center justify-center rounded-xl border bg-muted/40 text-muted-foreground" aria-hidden="true">
                <QrCode className="size-10" />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-lg font-bold">{me.name}</p>
              <p className="font-mono text-sm text-muted-foreground">{beneficiaryCode(me)}</p>
              <p className="text-xs text-muted-foreground">
                Your record is private — only the doctors and staff treating you can see it.
              </p>
              <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-9" onClick={printHealthCard} disabled={!qr}>
                <Printer className="size-4" aria-hidden="true" />
                Print Health ID
              </Button>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<QrCode className="size-5" />}
            title="Case record not linked yet"
            hint="Send a help request from the Help Centre — once our team registers you, your Health ID appears here."
          />
        )}
      </SectionCard>

      {/* Upcoming camps */}
      <SectionCard title="Upcoming medical camps" description="Free check-ups, medicines and screenings near you" icon={<CalendarDays className="size-5" />}>
        {loading ? (
          <ListSkeleton rows={2} />
        ) : camps.length === 0 ? (
          <EmptyState icon={<CalendarDays className="size-5" />} title="No camps announced yet" hint={error ?? undefined} />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto scrollbar-thin">
            {camps.map((c) => {
              const done = registeredCampIds.has(c.id);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(c.campDate)}
                      {c.venue ? ` · ${c.venue}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={c.status} tone={medTone(c.status)} />
                  {done ? (
                    <span className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 sm:min-h-9">
                      <CalendarPlus className="size-4" aria-hidden="true" />
                      Registered
                    </span>
                  ) : (
                    <Button size="sm" className="min-h-11 gap-1.5 sm:min-h-9" disabled={registeringId === c.id} onClick={() => void register(c)}>
                      <CalendarPlus className="size-4" aria-hidden="true" />
                      Register
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* Registrations + appointments */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="My camp registrations" icon={<CalendarPlus className="size-5" />}>
          {loading ? (
            <ListSkeleton rows={2} />
          ) : registrations.length === 0 ? (
            <EmptyState icon={<CalendarPlus className="size-5" />} title="No camp registrations yet" hint="Register above with one tap." />
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto scrollbar-thin">
              {registrations.map((r) => (
                <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="truncate text-sm font-medium">{r.camp?.title ?? "Medical camp"}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.camp?.campDate ? formatDate(r.camp.campDate) : r.createdAt ? formatDateTime(r.createdAt) : ""}
                    {r.camp?.venue ? ` · ${r.camp.venue}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="My appointments" icon={<Stethoscope className="size-5" />}>
          {loading ? (
            <ListSkeleton rows={2} />
          ) : appointments.length === 0 ? (
            <EmptyState icon={<Stethoscope className="size-5" />} title="No appointments booked" hint="Appointments made for you at camps appear here." />
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto scrollbar-thin">
              {appointments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.scheduledAt ? formatDateTime(a.scheduledAt) : "To be scheduled"}</p>
                    {a.notes && <p className="truncate text-xs text-muted-foreground">{a.notes}</p>}
                  </div>
                  <StatusBadge status={a.status} tone={medTone(a.status)} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Medical timeline */}
      <SectionCard title="My medical timeline" description="Every consultation, prescription and report — newest first" icon={<HeartPulse className="size-5" />}>
        {loading ? (
          <ListSkeleton rows={3} />
        ) : timeline.length === 0 ? (
          <EmptyState icon={<HeartPulse className="size-5" />} title="Nothing on your timeline yet" hint="It fills in automatically when a doctor sees you at a camp." />
        ) : (
          <ol className="max-h-96 space-y-3 overflow-y-auto pr-1 scrollbar-thin">
            {timeline.map((t, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {timelineIcon(t.kind)}
                </span>
                <div className="min-w-0">
                  <p className="text-sm">{t.summary}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(t.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      {/* Prescriptions */}
      <SectionCard title="My prescriptions" icon={<Pill className="size-5" />}>
        {loading ? (
          <ListSkeleton rows={2} />
        ) : prescriptions.length === 0 ? (
          <EmptyState icon={<Pill className="size-5" />} title="No prescriptions yet" />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto scrollbar-thin">
            {prescriptions.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p.items?.length ? `${p.items.length} medicine${p.items.length === 1 ? "" : "s"}` : "Prescription"}
                    {p.diagnosis ? ` · ${p.diagnosis}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.doctor?.name ? `Dr. ${p.doctor.name} · ` : ""}
                    {p.createdAt ? formatDateTime(p.createdAt) : ""}
                  </p>
                </div>
                <StatusBadge status={p.status} tone={medTone(p.status)} />
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 gap-1.5 sm:min-h-9"
                  onClick={() => window.open(`/api/prescriptions/${p.id}/print`, "_blank", "noopener")}
                  aria-label="Print prescription"
                >
                  <Printer className="size-4" aria-hidden="true" />
                  Print
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Lab reports */}
      <SectionCard title="My lab reports" icon={<FlaskConical className="size-5" />}>
        {loading ? (
          <ListSkeleton rows={2} />
        ) : labs.length === 0 ? (
          <EmptyState icon={<FlaskConical className="size-5" />} title="No lab reports yet" />
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto scrollbar-thin">
            {labs.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.testName || "Laboratory test"}</p>
                  {l.resultText && <p className="mt-1 rounded-md bg-muted/60 p-2 text-xs leading-relaxed">{l.resultText}</p>}
                </div>
                <StatusBadge status={l.status} tone={medTone(l.status)} />
                {l.resultFileUrl && (
                  <a
                    href={l.resultFileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition hover:bg-accent sm:min-h-9"
                    aria-label="Download lab report"
                  >
                    <FileDown className="size-4" aria-hidden="true" />
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Referrals + follow-ups */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="My referrals" icon={<Share2 className="size-5" />}>
          {loading ? (
            <ListSkeleton rows={2} />
          ) : referrals.length === 0 ? (
            <EmptyState icon={<Share2 className="size-5" />} title="No referrals" hint="If a doctor sends you to a hospital, it shows here." />
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto scrollbar-thin">
              {referrals.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.org?.name ?? "Partner hospital"}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.reason || formatDate(r.createdAt)}</p>
                  </div>
                  <StatusBadge status={r.status} tone={medTone(r.status)} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="My follow-ups" icon={<CalendarDays className="size-5" />}>
          {loading ? (
            <ListSkeleton rows={2} />
          ) : followUps.length === 0 ? (
            <EmptyState icon={<CalendarDays className="size-5" />} title="No follow-ups scheduled" />
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto scrollbar-thin">
              {followUps.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Due {formatDate(f.dueDate)}</p>
                    {f.notes && <p className="truncate text-xs text-muted-foreground">{f.notes}</p>}
                  </div>
                  <StatusBadge status={f.status} tone={medTone(f.status)} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Documents */}
      <SectionCard
        title="My documents"
        description="Keep scans of prescriptions and reports handy"
        icon={<FileText className="size-5" />}
      >
        <FilePickButton
          label="Upload a document"
          accept="application/pdf,image/*"
          folder="health-documents"
          onPicked={async (files) => {
            const f = files[0];
            if (!f) return;
            try {
              await post("/api/medical-documents", { url: fileUrl(f.id), title: f.name });
              toast.success("Document saved to your record");
              await load();
            } catch (e) {
              toastError(e, "Could not save the document");
            }
          }}
        />
        <div className="mt-4">
          {loading ? (
            <ListSkeleton rows={2} />
          ) : documents.length === 0 ? (
            <EmptyState icon={<Upload className="size-5" />} title="No documents uploaded" hint="Upload scans of outside prescriptions, discharge summaries or reports." />
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto scrollbar-thin">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title || "Document"}</p>
                    <p className="text-xs text-muted-foreground">{d.createdAt ? formatDateTime(d.createdAt) : ""}</p>
                  </div>
                  <a
                    href={d.url || fileUrl(d.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition hover:bg-accent sm:min-h-9"
                    aria-label="Open document"
                  >
                    <FileDown className="size-4" aria-hidden="true" />
                    Open
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Users className="size-3.5" aria-hidden="true" />
        Your health data is shared only with the UAR clinical staff treating you.
      </p>
    </div>
  );
}
