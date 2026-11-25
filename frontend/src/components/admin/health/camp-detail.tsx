"use client";

/**
 * Camp DetailSheet — the camp-day workbench opened from the camps tab.
 *
 *  - Header: status badge + lifecycle actions (Go live / Complete / Cancel via
 *    ConfirmDialog) + camp QR label (QRCode.toDataURL of camp.code, printable).
 *  - Live ops counters grid from GET /api/camp-attendance?campId&summary=1.
 *  - Inner tabs: Attendance · Registrations · Staff · Partners · Expenses
 *    (each an export from camp-ops.tsx).
 */

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  ArrowUpRight,
  BadgeIndianRupee,
  Handshake,
  Loader2,
  Play,
  Printer,
  QrCode,
  SquareCheck,
  Stethoscope,
  Ticket,
  TriangleAlert,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { navigate } from "@/lib/router";
import { get, patch } from "@/lib/api-client";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DetailGrid, DetailSection, DetailSheet } from "@/components/shared/detail-sheet";
import { DataField } from "@/components/shared/data-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { jsonList, type CampAttendanceSummary, type CampDetail } from "./shared";
import { AttendanceOps, ExpensesOps, PartnersOps, RegistrationsOps, StaffOps } from "./camp-ops";

type Lifecycle = "LIVE" | "COMPLETED" | "CANCELLED";

export function CampDetailSheet({
  campId,
  open,
  onOpenChange,
  onChanged,
}: {
  campId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const [camp, setCamp] = useState<CampDetail | null>(null);
  const [summary, setSummary] = useState<CampAttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Lifecycle | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const c = await get<CampDetail>(`/api/medical-camps/${campId}`);
      setCamp(c);
      try {
        const s = await fetchSummary(campId);
        setSummary(s);
      } catch {
        setSummary(null); // counters are decorative if the summary route is missing
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load camp");
    } finally {
      setLoading(false);
    }
  }, [campId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  /* camp QR label — client-side dataURL like the kits label pattern */
  useEffect(() => {
    if (!open || !camp?.code) return;
    let alive = true;
    QRCode.toDataURL(camp.code, { margin: 1, width: 180 })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        if (alive) setQr(null);
      });
    return () => {
      alive = false;
    };
  }, [open, camp?.code]);

  const transition = async (status: Lifecycle) => {
    if (!camp) return;
    setTransitioning(true);
    try {
      await patch(`/api/medical-camps/${camp.id}`, { status });
      toast.success(`Camp is now ${status.toLowerCase()}`);
      setConfirming(null);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status change failed");
    } finally {
      setTransitioning(false);
    }
  };

  const openLabel = () => {
    if (!qr || !camp) return;
    const w = window.open("", "_blank", "noopener,noreferrer,width=420,height=560");
    if (!w) {
      toast.error("Allow pop-ups to print the label");
      return;
    }
    w.document.write(`<!doctype html><html><head><title>${camp.code} · camp label</title>
      <style>
        body { font-family: ui-sans-serif, system-ui, sans-serif; display:flex; align-items:center; justify-content:center; margin:0; padding:24px; }
        .label { text-align:center; border:2px solid #10b981; border-radius:12px; padding:20px; }
        .org { font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#059669; font-weight:700; }
        .code { font-family:ui-monospace,monospace; font-size:14px; margin-top:8px; }
        .title { font-size:13px; color:#374151; margin-top:2px; }
        img { width:180px; height:180px; }
      </style></head>
      <body><div class="label">
        <div class="org">United Angel Reach · Medical camp</div>
        ${qr ? `<img alt="Camp QR" src="${qr}" />` : ""}
        <div class="code">${camp.code}</div>
        <div class="title">${camp.title}</div>
      </div>
      <script>window.onload = () => window.print();</script>
      </body></html>`);
    w.document.close();
  };

  const services = jsonList(camp?.services);
  const counts = camp?.counts;
  const sum = summary;

  return (
    <>
      <DetailSheet
        open={open}
        onOpenChange={onOpenChange}
        loading={loading && !camp}
        eyebrow={`Medical camp · ${camp?.code ?? ""}`}
        title={camp?.title ?? "Camp"}
        description={camp ? [camp.venue, camp.city].filter(Boolean).join(" · ") : undefined}
        status={camp ? <StatusBadge status={camp.status} /> : null}
        actions={
          camp ? (
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="min-h-9" onClick={openLabel} aria-label="Print camp QR label">
                <Printer className="size-3.5" aria-hidden="true" /> Label
              </Button>
              {camp.status === "SCHEDULED" || camp.status === "DRAFT" ? (
                <Button size="sm" className="min-h-9" onClick={() => setConfirming("LIVE")}>
                  <Play className="size-3.5" aria-hidden="true" /> Go live
                </Button>
              ) : null}
              {camp.status === "LIVE" ? (
                <Button size="sm" variant="outline" className="min-h-9" onClick={() => setConfirming("COMPLETED")}>
                  <SquareCheck className="size-3.5" aria-hidden="true" /> Complete
                </Button>
              ) : null}
            </div>
          ) : null
        }
        footer={
          camp && camp.status !== "CANCELLED" && camp.status !== "COMPLETED" ? (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
              onClick={() => setConfirming("CANCELLED")}
            >
              <TriangleAlert className="size-3.5" aria-hidden="true" /> Cancel camp
            </Button>
          ) : null
        }
      >
        {loading && !camp ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : loadError ? (
          <div className="rounded-xl border-2 border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-6 text-center">
            <p className="text-sm font-medium">{loadError}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={load}>
              Retry
            </Button>
          </div>
        ) : camp ? (
          <>
            {/* cross-link: this camp's outputs roll up into the unified ledger */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => navigate("/admin/distributions")}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {"This camp's dispenses & distributions → central ledger"}
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </button>
            </div>

            {/* identity + QR */}
            <DetailSection
              title="Camp card"
              description="Scan the QR at the venue entrance for the camp register."
              actions={
                qr ? (
                  <img src={qr} alt={`QR code for camp ${camp.code}`} className="size-24 rounded-lg border bg-card p-1" />
                ) : (
                  <span className="flex size-24 items-center justify-center rounded-lg border bg-muted/40" aria-hidden="true">
                    <QrCode className="size-6 text-muted-foreground" />
                  </span>
                )
              }
            >
              <DetailGrid cols={3}>
                <DataField label="Date" value={formatDate(camp.campDate)} />
                <DataField
                  label="Timings"
                  value={[camp.startTime, camp.endTime].filter(Boolean).join(" – ") || null}
                />
                <DataField label="Venue" value={camp.venue} />
                <DataField label="City" value={camp.city ?? null} />
                <DataField label="Capacity" value={camp.capacity} />
                <DataField label="Coordinator" value={camp.coordinatorName ?? null} />
                <DataField label="Budget" value={camp.budget != null ? formatINR(camp.budget) : null} />
                <DataField label="Created" value={camp.createdAt ? formatDateTime(camp.createdAt) : null} />
                <DataField label="Services" value={services.length ? services.join(", ") : null} />
              </DetailGrid>
            </DetailSection>

            {/* live ops counters */}
            <DetailSection title="Live operations" description="Queue health from the check-in desk.">
              {sum ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {(
                    [
                      ["Registered", sum.registered],
                      ["Checked in", sum.checkedIn],
                      ["Waiting", sum.waiting],
                      ["In consultation", sum.inConsultation],
                      ["Completed", sum.completed],
                      ["Checked out", sum.checkedOut],
                      ["No-show", sum.noShow],
                      ["Cancelled", sum.cancelled],
                    ] as Array<[string, number]>
                  ).map(([label, v]) => (
                    <div key={label} className="rounded-lg border bg-muted/30 px-3 py-2.5">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums">{v}</p>
                    </div>
                  ))}
                </div>
              ) : counts ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Counter label="Registrations" value={counts.registrations} />
                  <Counter label="Checked in" value={counts.checkedIn} />
                  <Counter label="Completed" value={counts.completed} />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Counters unavailable (camp-attendance summary API not reachable).
                </p>
              )}
            </DetailSection>

            {/* operational inner tabs */}
            <Tabs defaultValue="attendance">
              <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto sm:flex-wrap">
                <TabsTrigger value="attendance" className="shrink-0 gap-1.5">
                  <Ticket className="size-3.5" aria-hidden="true" /> Attendance
                </TabsTrigger>
                <TabsTrigger value="registrations" className="shrink-0 gap-1.5">
                  <Users className="size-3.5" aria-hidden="true" /> Registrations
                </TabsTrigger>
                <TabsTrigger value="staff" className="shrink-0 gap-1.5">
                  <Stethoscope className="size-3.5" aria-hidden="true" /> Staff
                </TabsTrigger>
                <TabsTrigger value="partners" className="shrink-0 gap-1.5">
                  <Handshake className="size-3.5" aria-hidden="true" /> Partners
                </TabsTrigger>
                <TabsTrigger value="expenses" className="shrink-0 gap-1.5">
                  <BadgeIndianRupee className="size-3.5" aria-hidden="true" /> Expenses
                </TabsTrigger>
              </TabsList>

              <TabsContent value="attendance" className="mt-4">
                <AttendanceOps camp={camp} summary={sum} onChanged={load} />
              </TabsContent>
              <TabsContent value="registrations" className="mt-4">
                <RegistrationsOps camp={camp} onChanged={load} />
              </TabsContent>
              <TabsContent value="staff" className="mt-4">
                <StaffOps camp={camp} onChanged={load} />
              </TabsContent>
              <TabsContent value="partners" className="mt-4">
                <PartnersOps camp={camp} onChanged={load} />
              </TabsContent>
              <TabsContent value="expenses" className="mt-4">
                <ExpensesOps camp={camp} onChanged={load} />
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </DetailSheet>

      {/* lifecycle confirmations */}
      <ConfirmDialog
        open={confirming === "LIVE"}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Go live with this camp?"
        recordName={camp ? `${camp.title} · ${camp.code}` : null}
        description="The check-in desk opens, the queue goes live and the camp appears as LIVE on the overview. This is the signal that camp day has started."
        confirmLabel="Go live"
        loading={transitioning}
        onConfirm={() => transition("LIVE")}
      />
      <ConfirmDialog
        open={confirming === "COMPLETED"}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Mark this camp completed?"
        recordName={camp ? `${camp.title} · ${camp.code}` : null}
        description="The camp closes for check-ins and its results move into reports. Make sure consultations and prescriptions are wrapped up first."
        confirmLabel="Complete camp"
        loading={transitioning}
        onConfirm={() => transition("COMPLETED")}
      />
      <ConfirmDialog
        open={confirming === "CANCELLED"}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Cancel this camp?"
        recordName={camp ? `${camp.title} · ${camp.code}` : null}
        description="Registrations and invitations stay on record but the camp will not run. This cannot be undone from the console."
        confirmLabel="Cancel camp"
        loading={transitioning}
        onConfirm={() => transition("CANCELLED")}
      />
    </>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

async function fetchSummary(campId: string): Promise<CampAttendanceSummary | null> {
  const d = await get<unknown>(`/api/camp-attendance?campId=${campId}&summary=1`);
  const s = (d ?? {}) as { summary?: CampAttendanceSummary };
  return s.summary ?? null;
}

export default CampDetailSheet;
