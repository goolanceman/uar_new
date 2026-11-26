"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CreditCard, HeartHandshake, Info, MapPin, Pill, Wallet } from "lucide-react";
import { toast } from "sonner";
import type { SessionUser } from "@/hooks/use-auth";
import { useMasters, labelOf } from "@/hooks/use-masters";
import { get, patch, post } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatINR, formatDate, initials } from "@/lib/format";
import { StatCard } from "@/components/shared/stat-card";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheet } from "@/components/shared/form-sheet";
import { HowItWorksDialog } from "@/components/shared/how-it-works-dialog";
import {
  Field,
  FieldGrid,
  FormSection,
  SelectField,
  TextField,
} from "@/components/shared/form-fields";
import { amountRule, fieldError, minLen, required } from "@/lib/validators";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { asArray, payPendingDonation } from "./portal-utils";
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
  // schedule + payment tracking (backend-computed, additive)
  totalCommitted?: number;
  paymentsMade?: number;
  paymentCount?: number;
  remaining?: number;
  nextDueAt?: string | null;
  completedAt?: string | null;
  schedule?: Array<{ n: number; dueDate: string; amount: number; covered: boolean }>;
  installments?: Array<{
    id: string;
    receiptNumber: string;
    amount: number;
    currency: string;
    paymentStatus: string;
    createdAt: string;
  }>;
}

const MONTH_OPTIONS = [
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "12 months" },
];

interface PledgeForm {
  amountPerMonth: string;
  months: string;
  startDate: string;
}

export default function DonorCauses({ user }: { user: SessionUser }) {
  const { options: conditionOptions } = useMasters("CONDITION");
  const [causes, setCauses] = useState<Cause[]>([]);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [loading, setLoading] = useState(true);

  // How-it-works explainer, then the Pledge FormSheet
  const [howItWorksCause, setHowItWorksCause] = useState<Cause | null>(null);
  const [adoptCause, setAdoptCause] = useState<Cause | null>(null);
  const [form, setForm] = useState<PledgeForm>({ amountPerMonth: "100", months: "6", startDate: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof PledgeForm, string | null>>>({});
  const [submitting, setSubmitting] = useState(false);

  // Cancel pledge
  const [cancelPledge, setCancelPledge] = useState<Pledge | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Pledge schedule detail + installment payment
  const [schedulePledge, setSchedulePledge] = useState<Pledge | null>(null);
  const [payingPledge, setPayingPledge] = useState<string | null>(null);

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
    setErrors({});
    setForm({
      amountPerMonth: String(Math.max(100, Math.round(cause.monthlyCost))),
      months: "6",
      startDate: new Date().toISOString().slice(0, 10),
    });
  };

  const submitAdopt = async () => {
    if (!adoptCause) return;
    const errs = {
      amountPerMonth: fieldError(form.amountPerMonth, [
        required("Monthly amount"),
        amountRule({ min: 100, max: adoptCause.monthlyCost, label: "Monthly amount" }),
      ]),
      months: fieldError(form.months, [required("Duration")]),
      startDate: fieldError(form.startDate, [minLen(8, "Start date")]),
    };
    setErrors(errs);
    if (errs.amountPerMonth || errs.months || errs.startDate) return;

    setSubmitting(true);
    try {
      await post(`/api/causes/${adoptCause.id}/pledges`, {
        amountPerMonth: Number(form.amountPerMonth),
        months: Number(form.months),
        startDate: form.startDate || undefined,
      });
      toast.success(
        `Thank you! You're adopting ${initials(adoptCause.patientName)}'s medicines at ${formatINR(Number(form.amountPerMonth))}/mo for ${form.months} months. A medicine-sponsor certificate lands in your Tax Centre once issued.`
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

  /** Pays the next pledge installment through the normal donation flow. */
  const payPledgeInstallment = async (p: Pledge) => {
    setPayingPledge(p.id);
    try {
      const created = await post<{ receiptNumber: string; checkoutPending?: boolean }>(
        "/api/donations",
        {
          amount: p.amountPerMonth,
          pledgeId: p.id,
          paymentMethod: "RAZORPAY",
          donorName: user.name,
          donorEmail: user.email,
        }
      );
      if (!created.checkoutPending) {
        toast.success(`Installment recorded — receipt ${created.receiptNumber}.`);
        setSchedulePledge(null);
        await load();
        return;
      }
      const result = await payPendingDonation({
        receiptNumber: created.receiptNumber,
        description: p.cause?.patientName ? `Medicine pledge — ${initials(p.cause.patientName)}` : "Medicine pledge installment",
        name: user.name,
        email: user.email,
      });
      if (result.ok) {
        toast.success("Payment confirmed — your pledge commitment is on track!");
        setSchedulePledge(null);
        await load();
      } else {
        toast.error(result.error);
        if (result.redirectToDonate) navigate("/donate");
        else await load();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not pay this installment");
    } finally {
      setPayingPledge(null);
    }
  };

  const open = useMemo(
    () => causes.filter((c) => c.status === "SEEKING" || c.status === "PARTIAL"),
    [causes]
  );
  const activePledges = useMemo(() => pledges.filter((p) => p.status === "ACTIVE"), [pledges]);
  const monthlyCommitment = activePledges.reduce((s, p) => s + (p.amountPerMonth || 0), 0);
  const totalPledgedMonths = activePledges.reduce((s, p) => s + (p.months || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Adopt-a-Medicine"
        description="Adopt a patient's monthly medicines — partial pledges welcome, pause anytime."
        icon={<Pill className="size-5" />}
      />

      {/* ---------- My pledges summary strip ---------- */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Active pledges"
          value={loading ? "" : String(activePledges.length)}
          hint="Monthly medicine mandates"
          icon={<HeartHandshake className="size-5" />}
          accent="amber"
          loading={loading}
        />
        <StatCard
          label="Monthly commitment"
          value={loading ? "" : `${formatINR(monthlyCommitment)}/mo`}
          hint={monthlyCommitment > 0 ? "Auto-debit via the finance desk" : "Start from ₹100/month"}
          icon={<Wallet className="size-5" />}
          accent="teal"
          loading={loading}
        />
        <StatCard
          label="Months pledged"
          value={loading ? "" : String(totalPledgedMonths)}
          hint="Across all active pledges"
          icon={<CalendarClock className="size-5" />}
          accent="emerald"
          loading={loading}
        />
      </div>

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
              const pct = totalNeeded > 0 ? Math.min(100, Math.round((c.raised / totalNeeded) * 100)) : 0;
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
                    <StatusBadge status={c.status} />
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
                      onClick={() => setHowItWorksCause(c)}
                      aria-label={`Learn how adopting medicines works for patient ${c.code}`}
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

      {/* ---------- My pledges ---------- */}
      <section aria-label="My medicine pledges">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          My pledges
        </h2>
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
            {pledges.map((p) => {
              const showSchedule = schedulePledge?.id === p.id;
              const canPay = p.status === "ACTIVE" && (p.remaining ?? p.amountPerMonth * p.months) > 0;
              return (
                <div key={p.id} className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-xs text-muted-foreground">
                          {p.cause?.code ?? "UAR-MED"}
                        </p>
                        <StatusBadge status={p.status} />
                      </div>
                      <p className="mt-0.5 truncate text-sm font-semibold">
                        {p.cause?.patientName ?? "Patient"} — {formatINR(p.amountPerMonth)}/mo
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarClock className="size-3" aria-hidden="true" />
                        {p.months} months · from {formatDate(p.startDate)}
                      </p>
                      {typeof p.paymentsMade === "number" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Paid {formatINR(p.paymentsMade)} of {formatINR(p.totalCommitted ?? p.amountPerMonth * p.months)} ·{" "}
                          <span className="font-semibold text-foreground">{formatINR(p.remaining ?? 0)} remaining</span>
                          {p.status === "ACTIVE" && p.nextDueAt ? ` · next due ${formatDate(p.nextDueAt)}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 sm:min-h-9"
                        onClick={() => setSchedulePledge(showSchedule ? null : p)}
                        aria-expanded={showSchedule}
                        aria-label={`View payment schedule for ${p.cause?.patientName ?? "patient"}`}
                      >
                        Schedule
                      </Button>
                      {canPay && (
                        <Button
                          size="sm"
                          className="min-h-11 gap-1.5 sm:min-h-9"
                          disabled={payingPledge === p.id}
                          onClick={() => payPledgeInstallment(p)}
                          aria-label={`Pay the next installment for ${p.cause?.patientName ?? "patient"}`}
                        >
                          <CreditCard className="size-4" aria-hidden="true" />
                          Pay installment
                        </Button>
                      )}
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
                  {showSchedule && <PledgeScheduleDetail p={p} />}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              Pausing a pledge stops the monthly mandate — the patient may lose
              medicine coverage unless another donor adopts them.
            </p>
          </div>
        )}
      </section>

      {/* ---------- How adopt-a-medicine works (explain → agree → proceed) ---------- */}
      <HowItWorksDialog
        open={howItWorksCause !== null}
        onOpenChange={(o) => !o && setHowItWorksCause(null)}
        icon={HeartHandshake}
        title={howItWorksCause ? `Adopting ${initials(howItWorksCause.patientName)}'s medicines` : "How Adopt-a-Medicine works"}
        description="A monthly mandate that keeps a patient's treatment uninterrupted."
        steps={[
          {
            title: "Choose your monthly amount",
            detail: "Pledge the full monthly medicine cost or a partial amount — other donors can cover the remaining balance.",
          },
          {
            title: "Set up the mandate",
            detail: "Confirm the amount and duration (3/6/12 months). This starts a monthly auto-debit mandate from the date you choose.",
          },
          {
            title: "Medicines are dispensed",
            detail: "Our field team uses your pledge to buy and deliver the patient's medicines every month, on schedule.",
          },
          {
            title: "Track & pause anytime",
            detail: "See your pledge under \u201cMy pledges\u201d. Pause it anytime — a medicine-sponsor certificate appears in your Tax Centre once issued.",
          },
        ]}
        note="Pausing a pledge stops the mandate immediately — the patient may lose coverage unless another donor adopts them."
        continueLabel="I understand, continue to pledge"
        onContinue={() => {
          const c = howItWorksCause;
          setHowItWorksCause(null);
          if (c) openAdopt(c);
        }}
      />

      {/* ---------- Pledge FormSheet ---------- */}
      <FormSheet
        open={adoptCause !== null}
        onOpenChange={(o) => !o && setAdoptCause(null)}
        title={adoptCause ? `Adopt ${initials(adoptCause.patientName)}'s medicines` : "Adopt medicines"}
        description={
          adoptCause
            ? `${adoptCause.code} · ${labelOf(conditionOptions, adoptCause.condition)} · ${formatINR(adoptCause.monthlyCost)}/mo for ${adoptCause.durationMonths} months`
            : undefined
        }
        submitLabel="Confirm adoption"
        loading={submitting}
        dirty={Boolean(adoptCause)}
        size="sm"
        onSubmit={submitAdopt}
        footerExtra={
          <span className="hidden sm:inline">Monthly auto-debit mandate · pause anytime</span>
        }
      >
        {adoptCause && (
          <FormSection title="Pledge details" description="Partial pledges are welcome — the balance is matched by other donors.">
            <FieldGrid>
              <TextField
                label="Amount per month"
                required
                prefix="₹"
                inputMode="numeric"
                value={form.amountPerMonth}
                onChange={(v) => setForm((f) => ({ ...f, amountPerMonth: v.replace(/[^\d]/g, "") }))}
                error={errors.amountPerMonth}
                hint={`₹100 partial → full cost ${formatINR(adoptCause.monthlyCost)}`}
              />
              <SelectField
                label="Duration"
                required
                value={form.months}
                onChange={(v) => setForm((f) => ({ ...f, months: v }))}
                options={MONTH_OPTIONS}
                placeholder="Select months"
              />
            </FieldGrid>
            <Field label="Start date" hint="Mandates start on the 1st of the chosen month or immediately.">
              <input
                type="date"
                value={form.startDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                aria-label="Pledge start date"
                className="h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <p>
                This sets up a <strong>monthly auto-debit mandate</strong> of{" "}
                {formatINR(Number(form.amountPerMonth) || 0)} for {form.months} months. Pause it
                any time from &quot;My pledges&quot;. Your medicine-sponsor certificate will
                appear in the Tax Centre once issued by our team.
              </p>
            </div>
          </FormSection>
        )}
      </FormSheet>

      {/* ---------- Pause pledge ConfirmDialog ---------- */}
      <ConfirmDialog
        open={cancelPledge !== null}
        onOpenChange={(o) => !o && setCancelPledge(null)}
        title="Pause this pledge?"
        recordName={
          cancelPledge
            ? `${cancelPledge.cause?.patientName ?? "Patient"} · ${formatINR(cancelPledge.amountPerMonth)}/mo · ${cancelPledge.months} months`
            : null
        }
        description="The monthly mandate stops immediately. The patient may lose medicine coverage unless another donor adopts them."
        confirmLabel="Yes, pause pledge"
        loading={cancelling}
        onConfirm={submitCancel}
      />
    </div>
  );
}

/**
 * Pledge schedule detail — month-by-month due dates with covered markers,
 * completed contributions history and the paid-vs-remaining commitment math.
 * All numbers come from the backend (GET /api/causes/pledges?mine=1 and
 * GET /api/pledges/:id compute the schedule server-side).
 */
function PledgeScheduleDetail({ p }: { p: Pledge }) {
  const installments = p.installments ?? [];
  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-muted-foreground">Total commitment</p>
          <p className="mt-0.5 text-sm font-bold">
            {formatINR(p.totalCommitted ?? p.amountPerMonth * p.months)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-muted-foreground">Paid so far</p>
          <p className="mt-0.5 text-sm font-bold">
            {formatINR(p.paymentsMade ?? 0)}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              ({p.paymentCount ?? 0} installment{(p.paymentCount ?? 0) === 1 ? "" : "s"})
            </span>
          </p>
        </div>
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-muted-foreground">Remaining</p>
          <p className="mt-0.5 text-sm font-bold">{formatINR(p.remaining ?? 0)}</p>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Schedule
        </p>
        <div className="grid gap-1.5">
          {(p.schedule ?? []).map((s) => (
            <div
              key={s.n}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-1.5 text-xs"
            >
              <span className="text-muted-foreground">#{s.n}</span>
              <span>{formatDate(s.dueDate)}</span>
              <span className="font-semibold">{formatINR(s.amount)}</span>
              {s.covered ? (
                <StatusBadge status="COMPLETED" />
              ) : (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                  Upcoming
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {installments.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Completed contributions
          </p>
          <div className="grid gap-1.5">
            {installments.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-mono text-muted-foreground">{i.receiptNumber}</span>
                <span className="text-muted-foreground">{formatDate(i.createdAt)}</span>
                <StatusBadge status={i.paymentStatus} />
                <span className="font-semibold">{formatINR(i.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        A pledge is a commitment to give; a completed donation is money already
        received and receipted. Pay each installment with the button above — the
        pledge completes automatically once the full commitment is covered.
      </p>
    </div>
  );
}
