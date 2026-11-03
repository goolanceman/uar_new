"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  KeyRound,
  Languages,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Save,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth, type SessionUser } from "@/hooks/use-auth";
import { useMasters, labelOf } from "@/hooks/use-masters";
import type { VolunteerProfile } from "../portal-router";
import { get, patch } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatDate, titleCase } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { DataField } from "@/components/shared/data-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

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

export default function VolunteerProfileView({
  user,
  volunteer,
}: {
  user: SessionUser;
  volunteer?: VolunteerProfile | null;
}) {
  const { refresh, logout } = useAuth();
  const { options: skillOptions } = useMasters("SKILL");
  const { options: availabilityOptions } = useMasters("AVAILABILITY");

  const [joinedAt, setJoinedAt] = useState<string | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [language, setLanguage] = useState<string | null>(null);

  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [city, setCity] = useState(user.city ?? "");
  const [about, setAbout] = useState("");
  const [saving, setSaving] = useState(false);

  const loadMe = useCallback(async () => {
    setLoadingMe(true);
    try {
      const [me, pub] = await Promise.all([
        get<{ user?: { about?: string | null; createdAt?: string } | null }>("/api/auth/me").catch(() => null),
        get<{ defaultLanguage?: string }>("/api/settings/public").catch(() => null),
      ]);
      setAbout(me?.user?.about ?? "");
      setJoinedAt(me?.user?.createdAt ?? null);
      setLanguage(pub?.defaultLanguage ?? null);
    } finally {
      setLoadingMe(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    setName(user.name);
    setPhone(user.phone ?? "");
    setCity(user.city ?? "");
  }, [user.name, user.phone, user.city]);

  const skills = parseJsonList(volunteer?.skills);
  const availability = parseJsonList(volunteer?.availability);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      await patch("/api/auth/profile", {
        name: name.trim(),
        phone: phone.trim() || null,
        city: city.trim() || null,
        about: about.trim() || null,
      });
      await refresh();
      toast.success("Profile saved — the coordinator sees your latest contact info");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    try {
      await logout();
      navigate("/");
    } catch {
      toast.error("Sign out failed — try again");
    }
  };

  const initials = user.name
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Manage your account and check your volunteer status."
        icon={<UserRound className="size-5" />}
      />

      {/* Account card */}
      <SectionCard title="Account" icon={<BadgeCheck className="size-5" />}>
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
            {initials || "U"}
          </span>
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <DataField label="Email" value={user.email} icon={<Mail className="size-3.5" />} copy />
            <DataField label="Status" value={titleCase(volunteer?.status ?? user.status)} />
            <DataField
              label="Volunteer since"
              value={volunteer?.joinedAt ? formatDate(volunteer.joinedAt) : joinedAt ? formatDate(joinedAt) : "—"}
            />
            <DataField
              label="Assigned area"
              value={volunteer?.assignedArea ?? "Not assigned yet"}
            />
          </div>
        </div>
        {volunteer?.status === "ACTIVE" && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <BadgeCheck className="size-3.5" aria-hidden="true" />
            Active volunteer — cleared for drives, rescues and kit scanning
          </p>
        )}
      </SectionCard>

      {/* Skills & availability (read-only) */}
      <SectionCard
        title="Skills & availability"
        description="Set during your application — the coordinator uses these to assign the right drives."
        icon={<Sparkles className="size-5" />}
      >
        {loadingMe ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-6 w-64" />
          </div>
        ) : skills.length === 0 && availability.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No skills recorded yet — they&apos;re picked from your volunteer
            application when it&apos;s approved.
          </p>
        ) : (
          <div className="space-y-3">
            {availability.length > 0 && (
              <p className="flex flex-wrap items-center gap-1.5 text-sm">
                <CalendarDays className="size-4 text-primary" aria-hidden="true" />
                <span className="text-muted-foreground">Availability:</span>
                {availability.map((a) => (
                  <span
                    key={a}
                    className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
                  >
                    {labelOf(availabilityOptions, a)}
                  </span>
                ))}
              </p>
            )}
            {skills.length > 0 && (
              <p className="flex flex-wrap items-center gap-1.5 text-sm">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />
                <span className="text-muted-foreground">Skills:</span>
                {skills.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
                  >
                    {labelOf(skillOptions, s)}
                  </span>
                ))}
              </p>
            )}
            <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              Skills and availability are read-only here — to change them, contact
              your coordinator or mail reach@unitedangelreach.org and we&apos;ll
              update your roster entry.
            </p>
          </div>
        )}
      </SectionCard>

      {/* Editor */}
      <SectionCard
        title="Personal details"
        description="Keep your contact info current — the coordinator uses it for drive-day calls."
        icon={<UserRound className="size-5" />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="v-name">Full name</Label>
            <Input
              id="v-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="v-phone">Phone</Label>
            <Input
              id="v-phone"
              type="tel"
              inputMode="tel"
              placeholder="+91 98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="v-city">City</Label>
            <Input
              id="v-city"
              placeholder="e.g. Bengaluru"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              autoComplete="address-level2"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="v-about">About (optional)</Label>
            <Textarea
              id="v-about"
              rows={3}
              placeholder="A line about yourself — languages you speak, interests, anything useful on ground."
              value={about}
              onChange={(e) => setAbout(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4">
          <Button className="min-h-11 gap-1.5" onClick={save} disabled={saving}>
            <Save className="size-4" aria-hidden="true" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Emergency contact */}
        <SectionCard
          title="Emergency contact"
          description="Who we call about you, when it matters."
          icon={<Phone className="size-3.5" />}
        >
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <DataField label="Your phone" value={user.phone ?? "—"} icon={<Phone className="size-3.5" />} />
              <DataField
                label="On-file contact"
                value={user.phone ? "Your number above" : "None on file"}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              For rescue missions we also use the national lines: 112 (emergency),
              108 (ambulance) and 1962 (animal rescue). To add a family contact,
              share it with your coordinator.
            </p>
          </div>
        </SectionCard>

        {/* Security + prefs + sign out */}
        <SectionCard
          title="Security & preferences"
          description="Password, language and session"
          icon={<KeyRound className="size-5" />}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Password:</span> use at
              least 8 characters and never share it. Temporary credentials become
              your permanent login once approved — to reset a lost password, mail
              reach@unitedangelreach.org from your registered email.
            </p>
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Languages className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                App language:{" "}
                <span className="font-medium text-foreground">
                  {loadingMe ? "…" : (language ?? "English")}
                </span>{" "}
                — follows the organisation default.
              </span>
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3.5" aria-hidden="true" />
              Always sign out on shared devices before leaving a drive.
            </p>
            <Button
              variant="outline"
              className="min-h-11 gap-1.5 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
              onClick={signOut}
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
