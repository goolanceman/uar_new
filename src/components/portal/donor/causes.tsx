"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, HeartHandshake, Info, MapPin, Pill } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { useMasters, labelOf } from "@/hooks/use-masters";
import { get, patch, post } from "@/lib/api-client";
import { cn, formatINR, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
        status === "SEEKING" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        status === "PARTIAL" && "border-amber-200 bg-amber-50 text-amber-700",
        status === "ADOPTED" && "border-teal-200 bg-teal-50 text-teal-700",
        status === "PAUSED" && "border-zinc-200 bg-zinc-50 text-zinc-600"
      )}
    >
      {status === "SEEKING" ? "Seeking donor" : status === "PARTIAL" ? "Partially adopted" : status === "ADOPTED" ? "Fully adopted" : "Paused"}
    </Badge>
  );
}

export default function DonorCauses(_props: { user: SessionUser }) {
  const { options: conditionOptions } = useMasters("CONDITION");
  const [causes, setCauses] = useState<Cause[]>([]);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [loading, setLoading] = useState(true);

  const [adoptCause, setAdoptCause] = useState<Cause | null>(null);
  const [amount, setAmount] = useState("");
  const [months, setMonths] = useState("6");
  const [submitting, setSubmitting] = useState(false);

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
    setAmount(String(Math.round(cause.monthlyCost)));
    setMonths("6");
  };

  const submitAdopt = async () => {
    if (!adoptCause) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 100) {
      toast.error("Minimum pledge is ₹100 per month");
      return;
    }
    if (amt > adoptCause.monthlyCost) {
      toast.error(`Monthly cost for this patient is ${formatINR(adoptCause.monthlyCost)}`);
      return;
    }
    setSubmitting(true);
    try {
      await post(`/api/causes/${adoptCause.id}/pledges`, {
        amountPerMonth: amt,
        months: Number(months),
      });
      toast.success(
        `Thank you! You're adopting ${adoptCause.patientName}'s medicines at ${formatINR(amt)}/mo for ${months} months.`
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
      toast.success("Pledge cancelled. You can start a new one anytime.");
      setCancelPledge(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel pledge");
    } finally {
      setCancelling(false);
    }
  };

  const activePledges = pledges.filter((p) => p.status === "ACTIVE");
  const monthlyCommitment = activePledges.reduce(
    (s, p) => s + (p.amountPerMonth || 0),
    0
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Adopt-a-Medicine
        </h1>
        <p className="text-sm text-muted-foreground">
          Adopt a patient's monthly medicines — partial pledges welcome, cancel anytime.
        </p>
      </div>

      {/* ---------- Adopt a patient ---------- */}
      <section aria-label="Adopt a patient">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Pill className="size-4" aria-hidden="true" /> Adopt a patient
        </h2>
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        ) : causes.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <Pill className="size-8 text-primary/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                No medicine causes are open right now — check back soon.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {causes.map((c) => {
              const totalNeeded = c.monthlyCost * (c.durationMonths || 12);
              const pct = totalNeeded > 0
                ? Math.min(100, Math.round((c.raised / totalNeeded) * 100))
                : 0;
              return (
                <Card key={c.id} className="flex flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {c.code}
                      </p>
                      <CardTitle className="truncate text-base">
                        {c.patientName}, {c.age}
                      </CardTitle>
                      <CardDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" aria-hidden="true" />
                          {c.city}
                        </span>
                        <span>·</span>
                        <span>{labelOf(conditionOptions, c.condition)}</span>
                      </CardDescription>
                    </div>
                    <CauseStatusBadge status={c.status} />
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                    {c.story}
                  </p>

                  <div className="mt-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm">
                        <span className="font-bold text-primary">
                          {formatINR(c.monthlyCost)}
                        </span>
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
                      disabled={c.status === "ADOPTED" || c.status === "PAUSED"}
                      onClick={() => openAdopt(c)}
                    >
                      <HeartHandshake className="size-4" aria-hidden="true" />
                      {c.status === "PARTIAL" ? "Adopt remaining" : "Adopt"}
                    </Button>
                  </div>
                </Card>
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
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No pledges yet. Adopt a patient above to start a monthly medicine
              mandate.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {pledges.map((p) => (
              <Card key={p.id} className="p-4 sm:p-5">
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
                            "border-emerald-200 bg-emerald-50 text-emerald-700",
                          p.status === "COMPLETED" &&
                            "border-teal-200 bg-teal-50 text-teal-700",
                          p.status === "CANCELLED" &&
                            "border-zinc-200 bg-zinc-50 text-zinc-600"
                        )}
                      >
                        {p.status}
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
                      className="min-h-11 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 sm:min-h-9"
                      onClick={() => setCancelPledge(p)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ---------- Adopt dialog ---------- */}
      <Dialog
        open={adoptCause !== null}
        onOpenChange={(open) => !open && setAdoptCause(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Adopt {adoptCause?.patientName}&apos;s medicines
            </DialogTitle>
            <DialogDescription>
              {adoptCause &&
                `${adoptCause.code} · ${labelOf(conditionOptions, adoptCause.condition)} · ${formatINR(adoptCause.monthlyCost)}/mo for ${adoptCause.durationMonths} months`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pledge-amount">Amount per month (₹)</Label>
              <Input
                id="pledge-amount"
                type="number"
                min={100}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Full cost is {formatINR(adoptCause?.monthlyCost ?? 0)}/mo — partial
                pledges from ₹100 are welcome.
              </p>
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
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
              <p>
                This sets up a <strong>monthly auto-debit mandate</strong> of{" "}
                {formatINR(Number(amount) || 0)} for {months} months. You can
                cancel from &quot;My pledges&quot; at any time.
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
            <Button
              className="min-h-11"
              onClick={submitAdopt}
              disabled={submitting}
            >
              {submitting ? "Setting up…" : "Confirm adoption"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Cancel pledge dialog ---------- */}
      <Dialog
        open={cancelPledge !== null}
        onOpenChange={(open) => !open && setCancelPledge(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel this pledge?</DialogTitle>
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
              {cancelling ? "Cancelling…" : "Yes, cancel pledge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
