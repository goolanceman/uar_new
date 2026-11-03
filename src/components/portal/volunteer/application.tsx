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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  // Form state
  const [fullName, setFullName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [city, setCity] = useState(user.city ?? "");
  const [occupation, setOccupation] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [availability, setAvailability] = useState("");
  const [motivation, setMotivation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshStatus = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
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

  const toggleSkill = (value: string) => {
    setSkills((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]
    );
  };

  const submit = async () => {
    if (!fullName.trim() || !phone.trim() || !city) {
      toast.error("Please fill your name, phone and city");
      return;
    }
    if (motivation.trim().length < 20) {
      toast.error("Tell us a little more — motivation needs at least 20 characters");
      return;
    }
    setSubmitting(true);
    try {
      await post("/api/volunteer-applications", {
        fullName: fullName.trim(),
        email: user.email,
        phone: phone.trim(),
        city,
        occupation: occupation.trim() || undefined,
        skills: JSON.stringify(skills),
        availability: availability || undefined,
        motivation: motivation.trim(),
      });
      toast.success("Application submitted! Our team will review it within 48 hours.");
      setMotivation("");
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
  const showForm = !loading && (!application || isRejected);

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
      />

      {/* ---------- Status journey timeline ---------- */}
      {loading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : application ? (
        <SectionCard
          title="Your application journey"
          description={`Latest application · submitted ${formatDateTime(application.createdAt)}`}
          icon={<Sparkles className="size-5" />}
        >
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
                  {/* connector */}
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
                      done &&
                        "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
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
                    <p
                      className={cn(
                        "text-sm font-medium",
                        !done && !current && "text-muted-foreground"
                      )}
                    >
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
        </SectionCard>
      ) : null}

      {/* ---------- Approved ---------- */}
      {!loading && isApproved && (
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
                Your volunteer profile is being activated — the full portal unlocks
                the moment an admin flips it live (usually minutes).
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
      {!loading && isPending && application && (
        <SectionCard
          title="Application under review"
          description={`Submitted ${formatDateTime(application.createdAt)} — we'll be in touch soon`}
          icon={<Hourglass className="size-5" />}
          actions={
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 gap-1.5 sm:min-h-9"
              onClick={refreshStatus}
              disabled={refreshing}
              aria-label="Refresh application status"
            >
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
              Refresh
            </Button>
          }
        >
          <div className="space-y-4">
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
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <p>
                You signed in with <strong>temporary credentials</strong> — they
                become your permanent login once approved. Change your password any
                time from Profile.
              </p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ---------- Rejected ---------- */}
      {!loading && isRejected && application && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200"
        >
          <ShieldX className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div>
            <p className="font-semibold">Your previous application wasn&apos;t approved this time</p>
            {application.reviewNote && (
              <p className="mt-0.5">
                Note from the team: “{application.reviewNote}”
              </p>
            )}
            <p className="mt-1">
              This is often about timing or nearby drive coverage, not about you.
              You&apos;re welcome to apply again below — we&apos;d love to have you.
            </p>
          </div>
        </div>
      )}

      {/* ---------- Application form ---------- */}
      {showForm && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div>
              <p className="text-base font-semibold">
                {isRejected ? "Apply again" : "Apply to volunteer"}
              </p>
              <p className="text-sm text-muted-foreground">
                Location &amp; skills help us assign you to the right drives.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="va-name">Full name</Label>
                <Input
                  id="va-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="va-email">Email</Label>
                <div className="flex gap-2">
                  <Input
                    id="va-email"
                    value={user.email}
                    readOnly
                    aria-readonly="true"
                    className="bg-muted"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0"
                    onClick={copyEmail}
                    aria-label="Copy email address"
                  >
                    <Copy className={cn("size-4", copiedEmail && "text-emerald-600 dark:text-emerald-400")} aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="va-phone">Phone</Label>
                <Input
                  id="va-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="va-city">City</Label>
                <Select value={city} onValueChange={setCity}>
                  <SelectTrigger id="va-city" className="w-full">
                    <SelectValue placeholder="Select your city" />
                  </SelectTrigger>
                  <SelectContent>
                    {cityOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="va-occupation">Occupation</Label>
                <Input
                  id="va-occupation"
                  placeholder="e.g. Teacher, Engineer, Student"
                  value={occupation}
                  onChange={(e) => setOccupation(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="va-availability">Availability</Label>
                <Select value={availability} onValueChange={setAvailability}>
                  <SelectTrigger id="va-availability" className="w-full">
                    <SelectValue placeholder="When can you help?" />
                  </SelectTrigger>
                  <SelectContent>
                    {availabilityOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Skills</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {skillOptions.map((s) => (
                  <label
                    key={s.value}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition hover:bg-accent"
                  >
                    <Checkbox
                      checked={skills.includes(s.value)}
                      onCheckedChange={() => toggleSkill(s.value)}
                      aria-label={s.label}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="va-motivation">Why do you want to volunteer with UAR?</Label>
              <Textarea
                id="va-motivation"
                rows={4}
                placeholder="Tell us in a few lines — min 20 characters…"
                value={motivation}
                onChange={(e) => setMotivation(e.target.value)}
              />
              <p
                className={cn(
                  "text-xs",
                  motivation.trim().length >= 20
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-muted-foreground"
                )}
              >
                {motivation.trim().length}/20 characters minimum
              </p>
            </div>

            <Button className="min-h-11 gap-1.5" onClick={submit} disabled={submitting}>
              <Send className="size-4" aria-hidden="true" />
              {submitting ? "Submitting…" : "Submit application"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Skills summary for approved/pending applicants */}
      {!loading && application && !isRejected && application.skills && (
        <SectionCard title="Your application" icon={<ClipboardCheck className="size-5" />}>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <DataField label="Status" value={titleCase(application.status)} />
              <DataField
                label="Availability"
                value={
                  parseJsonList(application.availability)
                    .map((a) => labelOf(availabilityOptions, a))
                    .join(", ") || "—"
                }
              />
            </div>
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
          </div>
        </SectionCard>
      )}
    </div>
  );
}
