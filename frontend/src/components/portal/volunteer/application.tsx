"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Hourglass,
  Info,
  RefreshCw,
  Send,
  ShieldX,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useMasters, labelOf } from "@/hooks/use-masters";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, post } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatDateTime, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { DataField } from "@/components/shared/data-field";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  Field,
  FieldGrid,
  FormSection,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/shared/form-fields";
import { fieldError, minLen, phoneRule, required } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

interface VolunteerApplication {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  occupation?: string | null;
  skills?: string | null; // JSON string
  availability?: string | null; // JSON string
  motivation: string;
  status: string; // PENDING | APPROVED | REJECTED
  reviewNote?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
}

interface ApplicationForm {
  fullName: string;
  phone: string;
  city: string;
  occupation: string;
  availability: string;
  motivation: string;
}

const NEXT_STEPS = [
  "Our team reviews every application within 48 hours.",
  "We call you on your phone for a quick verification chat.",
  "On approval, your full volunteer portal unlocks — tasks, distributions and kit scanning.",
];

function parseJsonList(value: string | undefined | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
  } catch {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export default function VolunteerApplicationView({
  user,
  volunteer,
}: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const { options: cityOptions } = useMasters("CITY");
  const { options: skillOptions } = useMasters("SKILL");
  const { options: availabilityOptions } = useMasters("AVAILABILITY");

  const [application, setApplication] = useState<VolunteerApplication | null>(null);
  // Page state machine: initial load (skeleton) → ready ⇄ refreshing
  // (in-place refresh — the refresh button spins, content stays mounted).
  // A discriminated union replaces the old loading/refreshing boolean pair,
  // which allowed impossible combos (loading+refreshing) and skeleton flashes
  // on refresh.
  const [pageState, setPageState] = useState<"loading" | "ready" | "refreshing">("loading");
  const [copiedEmail, setCopiedEmail] = useState(false);

  // FormSheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState<ApplicationForm>({
    fullName: user.name,
    phone: user.phone ?? "",
    city: user.city ?? "",
    occupation: "",
    availability: "",
    motivation: "",
  });
  const [skills, setSkills] = useState<string[]>([]);
  const [errors, setErrors] = useState<Partial<Record<keyof ApplicationForm, string | null>>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (mode: "loading" | "refreshing" = "loading") => {
    setPageState(mode);
    try {
      const data = await get<unknown>("/api/volunteer-applications/mine");
      const inner =
        data && typeof data === "object" && "application" in (data as Record<string, unknown>)
          ? (data as { application: unknown }).application
          : data && typeof data === "object" && "data" in (data as Record<string, unknown>)
            ? (data as { data: unknown }).data
            : data;
      setApplication(
        inner && typeof inner === "object" && "id" in (inner as Record<string, unknown>)
          ? (inner as VolunteerApplication)
          : null
      );
    } catch {
      setApplication(null);
    } finally {
      setPageState("ready");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openSheet = () => {
    setForm({
      fullName: application?.fullName ?? user.name,
      phone: application?.phone ?? user.phone ?? "",
      city: application?.city ?? user.city ?? "",
      occupation: application?.occupation ?? "",
      availability: parseJsonList(application?.availability)[0] ?? "",
      motivation: "",
    });
    setSkills(parseJsonList(application?.skills));
    setErrors({});
    setSheetOpen(true);
  };

  const refreshStatus = async () => {
    await load("refreshing");
    toast.success("Status refreshed");
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(user.email);
      setCopiedEmail(true);
      toast.success("Email copied");
      setTimeout(() => setCopiedEmail(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  };

  const submit = async () => {
    const errs = {
      fullName: fieldError(form.fullName, [required("Full name")]),
      phone: fieldError(form.phone, [required("Phone number"), phoneRule(false)]),
      city: fieldError(form.city, [required("City")]),
      availability: fieldError(form.availability, [required("Availability")]),
      motivation: fieldError(form.motivation, [minLen(20, "Motivation")]),
    };
    setErrors(errs);
    if (errs.fullName || errs.phone || errs.city || errs.availability || errs.motivation) return;

    setSubmitting(true);
    try {
      await post("/api/volunteer-applications", {
        fullName: form.fullName.trim(),
        email: user.email,
        phone: form.phone.trim(),
        city: form.city,
        occupation: form.occupation.trim() || undefined,
        skills: JSON.stringify(skills),
        availability: form.availability || undefined,
        motivation: form.motivation.trim(),
      });
      toast.success("Application submitted! Our team will review it within 48 hours.");
      setSheetOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit application");
    } finally {
      setSubmitting(false);
    }
  };

  const isActiveVolunteer = volunteer?.status === "ACTIVE" && user.status === "ACTIVE";
  const isPending = application?.status === "PENDING";
  const isRejected = application?.status === "REJECTED";
  const isApproved = application?.status === "APPROVED";

  const stepDone = (step: "applied" | "review" | "decision") => {
    if (!application) return false;
    if (step === "applied") return true;
    if (step === "review") return isPending || isApproved || isRejected;
    return isApproved || isRejected;
  };
  const stepCurrent = (step: "applied" | "review" | "decision") => {
    if (!application) return step === "applied";
    if (isPending) return step === "review";
    return step === "decision";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Volunteer application"
        description="Join United Angel Reach on the ground — drives, rescues and relief kits."
        icon={<ClipboardCheck className="size-5" />}
        actions={
          pageState !== "loading" && (!application || isRejected) ? (
            <Button className="min-h-11 gap-1.5 sm:min-h-9" onClick={openSheet}>
              <Send className="size-4" aria-hidden="true" />
              {isRejected ? "Apply again" : "Apply to volunteer"}
            </Button>
          ) : null
        }
      />

      {/* ---------- Status journey timeline ---------- */}
      {pageState === "loading" ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : application ? (
        <SectionCard
          title="Your application journey"
          description={`Latest application · submitted ${formatDateTime(application.createdAt)}`}
          icon={<Sparkles className="size-5" />}
          actions={
            isPending ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 gap-1.5 sm:min-h-9"
                onClick={refreshStatus}
                disabled={pageState === "refreshing"}
                aria-label="Refresh application status"
              >
                <RefreshCw className={cn("size-4", pageState === "refreshing" && "animate-spin")} aria-hidden="true" />
                Refresh
              </Button>
            ) : null
          }
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <ol className="space-y-0" aria-label="Application status timeline">
              {(
                [
                  { key: "applied", label: "Applied", at: application.createdAt },
                  { key: "review", label: "Under review", at: null },
                  {
                    key: "decision",
                    label: isApproved ? "Approved" : isRejected ? "Not approved" : "Decision",
                    at: application.reviewedAt,
                  },
                ] as const
              ).map((step, i, arr) => {
                const done = stepDone(step.key);
                const current = stepCurrent(step.key);
                return (
                  <li key={step.key} className="relative flex gap-3 pb-6 last:pb-0">
                    {i < arr.length - 1 && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute left-[11px] top-6 h-full w-px",
                          done && step.key !== "decision" ? "bg-emerald-500/50" : "bg-border"
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
                        done && "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                        !done && current && "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
                        !done && !current && "border-border bg-muted text-muted-foreground"
                      )}
                    >
                      {done ? (
                        <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      ) : current ? (
                        <Hourglass className="size-3.5" aria-hidden="true" />
                      ) : (
                        <XCircle className="size-3.5 opacity-40" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className={cn("text-sm font-medium", !done && !current && "text-muted-foreground")}>
                        {step.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {step.key === "review" && isPending
                          ? "In progress — usually within 48 hours"
                          : step.at
                            ? formatDateTime(step.at)
                            : "Pending"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <StatusBadge status={application.status} />
                <span className="text-xs text-muted-foreground">Application status</span>
              </div>
              {parseJsonList(application.skills).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {parseJsonList(application.skills).map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
                    >
                      {labelOf(skillOptions, s)}
                    </span>
                  ))}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <DataField
                  label="Availability"
                  value={
                    parseJsonList(application.availability)
                      .map((a) => labelOf(availabilityOptions, a))
                      .join(", ") || "—"
                  }
                />
                <DataField label="Phone" value={application.phone} />
              </div>
              {application.reviewNote && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                  Team note: “{application.reviewNote}”
                </p>
              )}
            </div>
          </div>
        </SectionCard>
      ) : (
        (
          <SectionCard title="Your journey starts here" icon={<Sparkles className="size-5" />}>
            <EmptyState
              icon={<ClipboardCheck className="size-5" />}
              title="No application yet"
              hint="Tell us who you are and when you can help — approval unlocks the full field toolkit."
            >
              <Button className="min-h-11 gap-1.5" onClick={openSheet}>
                <Send className="size-4" aria-hidden="true" />
                Apply to volunteer
              </Button>
            </EmptyState>
          </SectionCard>
        )
      )}

      {/* ---------- Approved ---------- */}
      {pageState !== "loading" && isApproved && (
        <SectionCard
          title="Welcome to the team 🎉"
          description="Your application was approved by our coordinators."
          icon={<CheckCircle2 className="size-5" />}
        >
          <div className="space-y-4">
            {isActiveVolunteer ? (
              <p className="text-sm text-muted-foreground">
                Your volunteer profile is active
                {volunteer?.assignedArea ? ` and you are assigned to ${volunteer.assignedArea}` : ""}.
                Head to your tools to see tasks, scan kits and log distributions.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your volunteer profile is being activated — the full portal unlocks the
                moment an admin flips it live (usually minutes).
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <DataField label="Sign-in email" value={user.email} copy />
              <DataField
                label="Password"
                value="Your temporary password from registration — change it in Profile"
              />
            </div>
            <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              Tip: the temporary password was shared once when you registered. If
              you&apos;ve lost it, use Profile → sign-out → contact the team to reset.
            </p>
            {isActiveVolunteer && (
              <Button
                className="min-h-11 gap-1.5"
                onClick={() => navigate("/volunteer/overview")}
                aria-label="Open my volunteer tools"
              >
                <Wrench className="size-4" aria-hidden="true" />
                Open my volunteer tools
              </Button>
            )}
          </div>
        </SectionCard>
      )}

      {/* ---------- Pending ---------- */}
      {pageState !== "loading" && isPending && application && (
        <SectionCard
          title="Application under review"
          description={`Submitted ${formatDateTime(application.createdAt)} — we'll be in touch soon`}
          icon={<Hourglass className="size-5" />}
        >
          <ol className="space-y-2">
            {NEXT_STEPS.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <p>
              You signed in with <strong>temporary credentials</strong> — they become
              your permanent login once approved. Change your password any time from
              Profile.
            </p>
          </div>
        </SectionCard>
      )}

      {/* ---------- Rejected ---------- */}
      {pageState !== "loading" && isRejected && application && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200"
        >
          <ShieldX className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div>
            <p className="font-semibold">Your previous application wasn&apos;t approved this time</p>
            {application.reviewNote && (
              <p className="mt-0.5">Note from the team: “{application.reviewNote}”</p>
            )}
            <p className="mt-1">
              This is often about timing or nearby drive coverage, not about you.
              You&apos;re welcome to apply again — we&apos;d love to have you.
            </p>
          </div>
        </div>
      )}

      {/* ---------- Application FormSheet ---------- */}
      <FormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={isRejected ? "Apply again to volunteer" : "Apply to volunteer"}
        description="Location & skills help us assign you to the right drives — takes about two minutes."
        submitLabel="Submit application"
        loading={submitting}
        dirty={form.motivation.trim().length > 0 || form.occupation.trim().length > 0 || skills.length > 0}
        size="md"
        onSubmit={submit}
        footerExtra={<span className="hidden sm:inline">Reviewed within 48 hours</span>}
      >
        <FormSection title="About you" description="Your sign-in email is attached automatically.">
          <FieldGrid>
            <TextField
              label="Full name"
              required
              value={form.fullName}
              onChange={(v) => setForm((f) => ({ ...f, fullName: v }))}
              error={errors.fullName}
            />
            <Field label="Email" hint="From your UAR account">
              <div className="flex gap-2">
                <input
                  value={user.email}
                  readOnly
                  aria-readonly="true"
                  aria-label="Sign-in email (read only)"
                  className="h-9 w-full rounded-md border bg-muted px-3 py-1 text-sm text-muted-foreground"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9 shrink-0"
                  onClick={copyEmail}
                  aria-label="Copy email address"
                >
                  <Copy className={cn("size-4", copiedEmail && "text-emerald-600 dark:text-emerald-400")} aria-hidden="true" />
                </Button>
              </div>
            </Field>
          </FieldGrid>
          <FieldGrid>
            <TextField
              label="Phone"
              required
              type="tel"
              inputMode="tel"
              placeholder="+91 98765 43210"
              value={form.phone}
              onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
              error={errors.phone}
              hint="We call this number for the verification chat"
            />
            <SelectField
              label="City"
              required
              value={form.city}
              onChange={(v) => setForm((f) => ({ ...f, city: v }))}
              options={cityOptions as Array<{ value: string; label: string }>}
              placeholder="Select your city"
              error={errors.city}
            />
          </FieldGrid>
          <TextField
            label="Occupation"
            placeholder="e.g. Teacher, Engineer, Student"
            value={form.occupation}
            onChange={(v) => setForm((f) => ({ ...f, occupation: v }))}
          />
        </FormSection>

        <FormSection title="Availability & skills" description="Tick everything you can help with.">
          <SelectField
            label="Availability"
            required
            value={form.availability}
            onChange={(v) => setForm((f) => ({ ...f, availability: v }))}
            options={availabilityOptions as Array<{ value: string; label: string }>}
            placeholder="When can you help?"
            error={errors.availability}
          />
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Skills</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {skillOptions.map((s) => (
                <label
                  key={s.value}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition hover:bg-accent"
                >
                  <Checkbox
                    checked={skills.includes(s.value)}
                    onCheckedChange={() =>
                      setSkills((prev) =>
                        prev.includes(s.value) ? prev.filter((x) => x !== s.value) : [...prev, s.value]
                      )
                    }
                    aria-label={s.label}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </fieldset>
        </FormSection>

        <FormSection title="Why UAR?" description="A few honest lines beat a perfect essay.">
          <TextareaField
            label="Motivation"
            required
            rows={4}
            placeholder="Tell us in a few lines — min 20 characters…"
            value={form.motivation}
            onChange={(v) => setForm((f) => ({ ...f, motivation: v }))}
            error={errors.motivation}
          />
          <p
            className={cn(
              "text-xs",
              form.motivation.trim().length >= 20
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-muted-foreground"
            )}
          >
            {form.motivation.trim().length}/20 characters minimum
          </p>
        </FormSection>
      </FormSheet>
    </div>
  );
}
