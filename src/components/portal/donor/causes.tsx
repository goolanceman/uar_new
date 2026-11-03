"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, HeartHandshake, Info, MapPin, Pill } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { useMasters, labelOf } from "@/hooks/use-masters";
import { get, patch, post } from "@/lib/api-client";
import { formatINR, formatDate, initials, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";

interface Cause {
  id: string;
  code: string;
  patientName: string;
  age: number;
  city: string;
  condition: string;
  monthlyCost: number;
  durationMonths: number;
  story: string;
  status: string; // SEEKING | PARTIAL | ADOPTED | PAUSED
  raised: number;
}

interface Pledge {
  id: string;
  amountPerMonth: number;
  months: number;
  startDate: string;
  status: string; // ACTIVE | COMPLETED | CANCELLED
  cause?: { code: string; patientName: string } | null;
}

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data: T[] }).data;
  return [];
}

function CauseStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full text-[10px]",
        status === "SEEKING" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        status === "PARTIAL" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        status === "ADOPTED" &&
          "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
        status === "PAUSED" && "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
      )}
    >
      {status === "SEEKING"
        ? "Seeking donor"
        : status === "PARTIAL"
          ? "Partially adopted"
          : status === "ADOPTED"
            ? "Fully adopted"
            : "Paused"}
    </Badge>
  );
}

export default function DonorCauses(_props: { user: SessionUser }) {
  const { options: conditionOptions } = useMasters("CONDITION");
  const [causes, setCauses] = useState<Cause[]>([]);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [loading, setLoading] = useState(true);

  // Adopt wizard
  const [adoptCause, setAdoptCause] = useState<Cause | null>(null);
  const [amount, setAmount] = useState(100);
  const [months, setMonths] = useState("6");
  const [submitting, setSubmitting] = useState(false);

  // Cancel pledge
  const [cancelPledge, setCancelPledge] = useState<Pledge | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        get<unknown>("/api/causes"),
        get<unknown>("/api/causes/pledges?mine=1"),
      ]);
      setCauses(asArray<Cause>(c));
      setPledges(asArray<Pledge>(p));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load causes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openAdopt = (cause: Cause) => {
    setAdoptCause(cause);
    setAmount(Math.max(100, Math.round(cause.monthlyCost)));
    setMonths("6");
  };

  const sliderMax = Math.max(100, Math.round(adoptCause?.monthlyCost ?? 100));

  const submitAdopt = async () => {
    if (!adoptCause) return;
    if (amount < 100) {
      toast.error("Minimum pledge is ₹100 per month");
      return;
    }
    if (amount > adoptCause.monthlyCost) {
      toast.error(`Monthly cost for this patient is ${formatINR(adoptCause.monthlyCost)}`);
      return;
    }
    setSubmitting(true);
    try {
      await post(`/api/causes/${adoptCause.id}/pledges`, {
        amountPerMonth: amount,
        months: Number(months),
      });
      toast.success(
        `Thank you! You're adopting ${initials(adoptCause.patientName)}'s medicines at ${formatINR(amount)}/mo for ${months} months. A medicine-sponsor certificate lands in your Receipts → Certificates once issued.`
      );
      setAdoptCause(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create pledge");
    } finally {
      setSubmitting(false);
    }
  };

  const submitCancel = async () => {
    if (!cancelPledge) return;
    setCancelling(true);
    try {
      await patch(`/api/pledges/${cancelPledge.id}`, { status: "CANCELLED" });
      toast.success("Pledge paused. You can start a new one anytime.");
      setCancelPledge(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel pledge");
    } finally {
      setCancelling(false);
    }
  };

  const open = causes.filter((c) => c.status === "SEEKING" || c.status === "PARTIAL");
  const activePledges = pledges.filter((p) => p.status === "ACTIVE");
  const monthlyCommitment = activePledges.reduce((s, p) => s + (p.amountPerMonth || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Adopt-a-Medicine"
        description="Adopt a patient's monthly medicines — partial pledges welcome, pause anytime."
        icon={<Pill className="size-5" />}
      />

      {/* ---------- Adopt a patient ---------- */}
      <section aria-label="Adopt a patient">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Patients seeking donors
        </h2>
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        ) : open.length === 0 ? (
          <SectionCard title="No open causes" icon={<Pill className="size-5" />}>
            <EmptyState
              icon={<Pill className="size-5" />}
              title="Every open patient is adopted right now"
              hint="Wonderful news — you made it happen. Check back soon or sponsor an animal while you wait."
            />
          </SectionCard>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {open.map((c) => {
              const totalNeeded = c.monthlyCost * (c.durationMonths || 12);
              const pct =
                totalNeeded > 0
                  ? Math.min(100, Math.round((c.raised / totalNeeded) * 100))
                  : 0;
              return (
                <div key={c.id} className="flex flex-col rounded-xl border bg-card p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {c.code}
                      </p>
                      <p className="truncate text-base font-semibold">
                        {initials(c.patientName)}, {c.age}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" aria-hidden="true" />
                          {c.city}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{labelOf(conditionOptions, c.condition)}</span>
                      </p>
                    </div>
                    <CauseStatusBadge status={c.status} />
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{c.story}</p>

                  <div className="mt-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm">
                        <span className="font-bold text-primary">{formatINR(c.monthlyCost)}</span>
                        <span className="text-muted-foreground">/mo medicines</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatINR(c.raised)} raised of {formatINR(totalNeeded)}
                      </p>
                    </div>
                    <Progress value={pct} className="mt-2" aria-label={`${pct}% funded`} />
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      {c.durationMonths} months of treatment
                    </span>
                    <Button
                      className="min-h-11 gap-1.5 sm:min-h-9"
                      onClick={() => openAdopt(c)}
                      aria-label={`Adopt medicines for patient ${c.code}`}
                    >
                      <HeartHandshake className="size-4" aria-hidden="true" />
                      {c.status === "PARTIAL" ? "Adopt remaining" : "Adopt"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Separator />

      {/* ---------- My pledges ---------- */}
      <section aria-label="My medicine pledges">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            My pledges
          </h2>
          {!loading && activePledges.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Active commitment:{" "}
              <span className="font-semibold text-foreground">
                {formatINR(monthlyCommitment)}/mo
              </span>
            </p>
          )}
        </div>
        {loading ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : pledges.length === 0 ? (
          <SectionCard title="Pledges" icon={<HeartHandshake className="size-5" />}>
            <EmptyState
              icon={<HeartHandshake className="size-5" />}
              title="No pledges yet"
              hint="Adopt a patient above to start a monthly medicine mandate — even ₹100/month keeps a dose from being skipped."
            />
          </SectionCard>
        ) : (
          <div className="grid gap-3">
            {pledges.map((p) => (
              <div key={p.id} className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-xs text-muted-foreground">
                        {p.cause?.code ?? "UAR-MED"}
                      </p>
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full text-[10px]",
                          p.status === "ACTIVE" &&
                            "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                          p.status === "COMPLETED" &&
                            "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
                          p.status === "CANCELLED" &&
                            "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
                        )}
                      >
                        {titleCase(p.status)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-sm font-semibold">
                      {p.cause?.patientName ?? "Patient"} — {formatINR(p.amountPerMonth)}/mo
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarClock className="size-3" aria-hidden="true" />
                      {p.months} months · from {formatDate(p.startDate)}
                    </p>
                  </div>
                  {p.status === "ACTIVE" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 sm:min-h-9"
                      onClick={() => setCancelPledge(p)}
                      aria-label={`Pause pledge for ${p.cause?.patientName ?? "patient"}`}
                    >
                      Pause
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Pausing a pledge stops the monthly mandate — the patient may lose
              medicine coverage unless another donor adopts them.
            </p>
          </div>
        )}
      </section>

      {/* ---------- Adopt wizard dialog ---------- */}
      <Dialog
        open={adoptCause !== null}
        onOpenChange={(openDlg) => !openDlg && setAdoptCause(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Adopt {adoptCause ? `${initials(adoptCause.patientName)}'s` : "the patient's"} medicines
            </DialogTitle>
            <DialogDescription>
              {adoptCause &&
                `${adoptCause.code} · ${labelOf(conditionOptions, adoptCause.condition)} · ${formatINR(adoptCause.monthlyCost)}/mo for ${adoptCause.durationMonths} months`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="pledge-amount">Amount per month</Label>
                <span className="text-lg font-bold text-primary">{formatINR(amount)}</span>
              </div>
              <Slider
                id="pledge-amount"
                min={100}
                max={sliderMax}
                step={50}
                value={[Math.min(amount, sliderMax)]}
                onValueChange={(v) => setAmount(Array.isArray(v) ? v[0] : v)}
                aria-label="Monthly pledge amount in rupees"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>₹100 partial</span>
                <span>Full cost {formatINR(sliderMax)}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pledge-months">Duration</Label>
              <Select value={months} onValueChange={setMonths}>
                <SelectTrigger id="pledge-months" className="w-full">
                  <SelectValue placeholder="Select months" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 months</SelectItem>
                  <SelectItem value="6">6 months</SelectItem>
                  <SelectItem value="12">12 months</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <p>
                This sets up a <strong>monthly auto-debit mandate</strong> of{" "}
                {formatINR(amount)} for {months} months. Pause it any time from
                &quot;My pledges&quot;. Your medicine-sponsor certificate will appear
                in Receipts → Certificates once issued by our team.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setAdoptCause(null)}
            >
              Cancel
            </Button>
            <Button className="min-h-11" onClick={submitAdopt} disabled={submitting}>
              {submitting ? "Setting up…" : "Confirm adoption"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Pause pledge dialog ---------- */}
      <Dialog
        open={cancelPledge !== null}
        onOpenChange={(openDlg) => !openDlg && setCancelPledge(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pause this pledge?</DialogTitle>
            <DialogDescription>
              {cancelPledge &&
                `The monthly mandate of ${formatINR(cancelPledge.amountPerMonth)} for ${cancelPledge.cause?.patientName ?? "the patient"} will stop. The patient may lose medicine coverage unless another donor adopts them.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setCancelPledge(null)}
            >
              Keep pledge
            </Button>
            <Button
              variant="destructive"
              className="min-h-11"
              onClick={submitCancel}
              disabled={cancelling}
            >
              {cancelling ? "Pausing…" : "Yes, pause pledge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
