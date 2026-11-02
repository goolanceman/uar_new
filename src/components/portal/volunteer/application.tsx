"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Hourglass,
  Info,
  Send,
  ShieldX,
} from "lucide-react";
import { toast } from "sonner";
import { useMasters, labelOf } from "@/hooks/use-masters";
import type { SessionUser } from "@/hooks/use-auth";
import type { VolunteerProfile } from "../portal-router";
import { get, post } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
        data && typeof data === "object" && "data" in (data as Record<string, unknown>)
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

  const activeVolunteer = user.status === "ACTIVE" && volunteer != null;
  const isPending = application?.status === "PENDING";
  const isRejected = application?.status === "REJECTED";
  const showForm = !loading && (!application || isRejected);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Volunteer application
        </h1>
        <p className="text-sm text-muted-foreground">
          Join United Angel Reach on the ground — drives, rescues and relief kits.
        </p>
      </div>

      {/* Active volunteer card */}
      {activeVolunteer && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div className="text-sm text-emerald-900">
            <p className="font-semibold">You&apos;re an active volunteer 🎉</p>
            <p className="mt-0.5 text-emerald-800">
              {volunteer?.assignedArea
                ? `Assigned area: ${volunteer.assignedArea}. `
                : ""}
              Head to Overview to see your tasks, distributions and kit scans.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : isPending && application ? (
        /* ---------- Under review ---------- */
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-amber-100">
              <Hourglass className="size-6 text-amber-600" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Application under review</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Submitted on {formatDate(application.createdAt)} — we&apos;ll be in
                touch soon.
              </p>

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  What happens next
                </p>
                <ol className="mt-2 space-y-2">
                  {NEXT_STEPS.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-lg bg-secondary p-3 text-xs text-secondary-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <p>
                  You signed in with <strong>temporary credentials</strong> — they
                  become your permanent login once approved. You can change your
                  password anytime from Profile.
                </p>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {/* ---------- Rejected: reason ---------- */}
      {isRejected && application && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <ShieldX className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden="true" />
          <div>
            <p className="font-semibold">Your previous application was not approved</p>
            {application.reviewNote && (
              <p className="mt-0.5">
                Reason from the team: “{application.reviewNote}”
              </p>
            )}
            <p className="mt-1">You can reapply below — we&apos;d love to have you.</p>
          </div>
        </div>
      )}

      {/* ---------- Application form ---------- */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="size-4 text-primary" aria-hidden="true" />
              {isRejected ? "Reapply as a volunteer" : "Apply to volunteer"}
            </CardTitle>
            <CardDescription>
              Fields marked with location & skills help us assign you to the right drives.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                <Input id="va-email" value={user.email} readOnly aria-readonly="true" className="bg-muted" />
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
              <Label htmlFor="va-motivation">
                Why do you want to volunteer with UAR?
              </Label>
              <Textarea
                id="va-motivation"
                rows={4}
                placeholder="Tell us in a few lines — min 20 characters…"
                value={motivation}
                onChange={(e) => setMotivation(e.target.value)}
              />
              <p
                className={`text-xs ${motivation.trim().length >= 20 ? "text-emerald-700" : "text-muted-foreground"}`}
              >
                {motivation.trim().length}/20 characters minimum
              </p>
            </div>

            <Button
              className="min-h-11 gap-1.5"
              onClick={submit}
              disabled={submitting}
            >
              <Send className="size-4" aria-hidden="true" />
              {submitting ? "Submitting…" : "Submit application"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Skills summary for approved/pending applicants */}
      {!loading && application && !isRejected && application.skills && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Your application</CardTitle>
            <CardDescription>
              {labelOf(availabilityOptions, parseJsonList(application.availability)[0]) !== "—"
                ? `Availability: ${parseJsonList(application.availability).map((a) => labelOf(availabilityOptions, a)).join(", ")}`
                : undefined}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {parseJsonList(application.skills).map((s) => (
              <span
                key={s}
                className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
              >
                {labelOf(skillOptions, s)}
              </span>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
