"use client";

import * as React from "react";
import { useState } from "react";
import { Link } from "@/lib/router";
import { post } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useMasters } from "@/hooks/use-masters";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Section, StepFlow } from "@/components/public/shared";
import {
  Copy,
  HandHeart,
  Info,
  KeyRound,
  Laptop,
  LogIn,
  PawPrint,
  Package,
  ShieldCheck,
  Stethoscope,
  GraduationCap,
} from "lucide-react";

interface TempCreds {
  email: string;
  password: string;
  fullName: string;
}

const ROLES_GRID = [
  {
    icon: Package,
    title: "Field Distributor",
    desc: "Run ration-kit lanes and pad-bank restocks. Two hours, one fixed lane, real names.",
  },
  {
    icon: GraduationCap,
    title: "Awareness Educator",
    desc: "Host anti-drug, cyber and menstrual-health sessions in schools, colleges and offices.",
  },
  {
    icon: PawPrint,
    title: "Animal Rescuer",
    desc: "Feeding points, ABC drive coordination and 1962 rescue callouts with trained handlers.",
  },
  {
    icon: Stethoscope,
    title: "Medicine Runner",
    desc: "Deliver adopted medicines with QR receipts and record patient adherence notes.",
  },
  {
    icon: Laptop,
    title: "Tech & Data",
    desc: "Maintain kit QR flows, dashboards and the corridor event logs — remote-friendly.",
  },
  {
    icon: ShieldCheck,
    title: "Event Marshal",
    desc: "Corridor demos, campus drives and fundraiser days — logistics and safety.",
  },
];

export function VolunteerPage() {
  const { user } = useAuth();
  const { options: cities, loading: citiesLoading } = useMasters("CITY");
  const { options: skills, loading: skillsLoading } = useMasters("SKILL");
  const { options: availability } = useMasters("AVAILABILITY");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [occupation, setOccupation] = useState("");
  const [skillSel, setSkillSel] = useState<Set<string>>(new Set());
  const [avail, setAvail] = useState("");
  const [motivation, setMotivation] = useState("");
  const [busy, setBusy] = useState(false);
  const [tempCreds, setTempCreds] = useState<TempCreds | null>(null);

  React.useEffect(() => {
    if (!user) return;
    setFullName((n) => n || user.name || "");
    setEmail((e) => e || user.email || "");
    setPhone((p) => p || user.phone || "");
    setCity((c) => c || user.city || "");
  }, [user]);

  const toggleSkill = (value: string) => {
    setSkillSel((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const submit = async () => {
    if (fullName.trim().length < 3) {
      toast.error("Please enter your full name");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error("Please enter a valid email");
      return;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      toast.error("Please enter a valid 10-digit phone number");
      return;
    }
    if (!city) {
      toast.error("Please choose your city");
      return;
    }
    if (motivation.trim().length < 20) {
      toast.error("Tell us a little more — at least 20 characters about why you want to join");
      return;
    }
    setBusy(true);
    try {
      const res = await post<{ application?: unknown; tempCreds?: TempCreds }>(
        "/api/volunteer-applications",
        {
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          city,
          occupation: occupation.trim() || undefined,
          skills: Array.from(skillSel).join(",") || undefined,
          availability: avail || undefined,
          motivation: motivation.trim(),
        }
      );
      if (user) {
        toast.success("Application received — track its status in your Volunteer Portal.");
        setMotivation("");
      } else if (res?.tempCreds) {
        setTempCreds(res.tempCreds);
        toast.success("Application received!");
      } else {
        toast.success("Application received — we'll be in touch within 3 working days.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit application");
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed — select the text manually");
    }
  };

  return (
    <>
      <Section
        title="Volunteer with United Angel Reach"
        subtitle="Background-verified, angel-trained, always accompanied on field duties. Two hours a month is enough to change a lane."
      >
        {/* Roles grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES_GRID.map((r) => (
            <Card key={r.title} className="p-5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <r.icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-3 font-semibold">{r.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.desc}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title="Apply now"
        subtitle="Every application is reviewed by a programme lead within 3 working days."
        className="bg-muted/40"
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* -------- Form -------- */}
          <Card className="p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="v-name">Full name *</Label>
                <Input id="v-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-email">Email *</Label>
                <Input id="v-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-phone">Phone *</Label>
                <Input id="v-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-city">City *</Label>
                {citiesLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={city} onValueChange={setCity}>
                    <SelectTrigger id="v-city" className="h-10">
                      <SelectValue placeholder="Choose your city" />
                    </SelectTrigger>
                    <SelectContent>
                      {cities.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="v-occ">Occupation</Label>
                <Input id="v-occ" value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="Student / teacher / engineer / retired…" />
              </div>
            </div>

            <Separator className="my-5" />

            <Label className="text-sm font-semibold">Skills (choose all that apply)</Label>
            {skillsLoading ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {skills.map((s) => (
                  <label
                    key={s.value}
                    className={cn(
                      "flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm transition",
                      skillSel.has(s.value) ? "border-emerald-600 bg-emerald-50/60" : "hover:bg-accent"
                    )}
                  >
                    <Checkbox checked={skillSel.has(s.value)} onCheckedChange={() => toggleSkill(s.value)} />
                    {s.label}
                  </label>
                ))}
              </div>
            )}

            <div className="mt-5 max-w-xs space-y-1.5">
              <Label htmlFor="v-avail">Availability</Label>
              <Select value={avail} onValueChange={setAvail}>
                <SelectTrigger id="v-avail" className="h-10">
                  <SelectValue placeholder="When can you help?" />
                </SelectTrigger>
                <SelectContent>
                  {availability.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-5 space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="v-mot">Why do you want to join? *</Label>
                <span
                  className={cn(
                    "text-xs",
                    motivation.trim().length >= 20 ? "text-emerald-600" : "text-muted-foreground"
                  )}
                >
                  {motivation.trim().length}/20 min
                </span>
              </div>
              <Textarea
                id="v-mot"
                rows={4}
                value={motivation}
                onChange={(e) => setMotivation(e.target.value)}
                placeholder="A cause that touched you, a skill you want to give, hours you can commit…"
              />
            </div>

            <Button
              size="lg"
              className="mt-6 h-12 w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto sm:px-8"
              onClick={submit}
              disabled={busy}
            >
              {busy ? "Submitting…" : "Submit application"}
              {!busy && <HandHeart className="ml-1 size-5" aria-hidden />}
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              Not registered yet? You&rsquo;ll get temporary login details right after applying.{" "}
              <Link href="/login" className="font-semibold text-emerald-700 hover:underline">
                Already applied? Sign in
              </Link>
            </p>
          </Card>

          {/* -------- Side: what happens next -------- */}
          <div className="space-y-4">
            <Card className="p-5">
              <h3 className="font-semibold">What happens after you apply</h3>
              <StepFlow
                accent="emerald"
                className="mt-4"
                steps={[
                  {
                    title: "Instant temporary login",
                    desc: "You receive a one-time password to sign in and track your application status.",
                  },
                  {
                    title: "Lead review (≤3 days)",
                    desc: "A programme lead checks your skills, availability and references.",
                  },
                  {
                    title: "Orientation call",
                    desc: "30 minutes on the programme you picked — child-safety and data-privacy basics included.",
                  },
                  {
                    title: "Portal unlocks",
                    desc: "Approved volunteers see tasks, distribution lanes, kit scans and their impact log.",
                  },
                ]}
              />
            </Card>
            <Card className="border-emerald-200 bg-emerald-50/60 p-5">
              <p className="flex items-start gap-2 text-sm leading-relaxed text-emerald-900">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-700" aria-hidden />
                Volunteers working with children or patients complete an ID verification and sign
                our child-protection charter — non-negotiable, like everywhere at UAR.
              </p>
            </Card>
          </div>
        </div>
      </Section>

      {/* -------- Temp creds dialog -------- */}
      <Dialog open={!!tempCreds} onOpenChange={(o) => !o && setTempCreds(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-emerald-600" aria-hidden />
              Save your temporary login — shown once
            </DialogTitle>
            <DialogDescription>
              These credentials let you sign in and track your application. Once an admin approves
              you, your Volunteer Portal unlocks automatically.
            </DialogDescription>
          </DialogHeader>
          {tempCreds && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Email
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="truncate text-sm font-semibold select-all">
                    {tempCreds.email}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label="Copy email"
                    onClick={() => copyText(tempCreds.email)}
                  >
                    <Copy className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Temporary password
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="truncate text-sm font-semibold select-all">{tempCreds.password}</code>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label="Copy password"
                    onClick={() => copyText(tempCreds.password)}
                  >
                    <Copy className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                This password will not be shown again. Screenshot it or copy it to your notes now.
                You&rsquo;ll be asked to keep it safe when you first sign in.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTempCreds(null)}>
              Continue browsing
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" asChild>
              <Link href="/login">
                <LogIn className="size-4" aria-hidden /> Go to sign in
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
