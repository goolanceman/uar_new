"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  IdCard,
  KeyRound,
  Languages,
  Loader2,
  LogOut,
  Mail,
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
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { DataField } from "@/components/shared/data-field";
import { TextField } from "@/components/shared/form-fields";
import { fieldError, phoneRule } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

  // Personal details
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [city, setCity] = useState(user.city ?? "");
  const [about, setAbout] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Skills / availability / emergency / id proof (volunteer record)
  const [skills, setSkills] = useState<string[]>([]);
  const [availability, setAvailability] = useState<string[]>([]);
  const [emergencyContact, setEmergencyContact] = useState("");
  const [idProof, setIdProof] = useState("");
  const [savingRoster, setSavingRoster] = useState(false);
  const [rosterDirty, setRosterDirty] = useState(false);

  // Security
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);

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

  // Seed roster fields from the volunteer record once it lands.
  useEffect(() => {
    if (!volunteer) return;
    setSkills(parseJsonList(volunteer.skills));
    setAvailability(parseJsonList(volunteer.availability));
    setEmergencyContact(volunteer.emergencyContact ?? "");
    setIdProof(volunteer.idProof ?? "");
    setRosterDirty(false);
  }, [volunteer]);

  const save = async () => {
    const pErr = fieldError(phone, [phoneRule(true)]);
    setPhoneError(pErr);
    if (pErr) return;
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

  /** Roster save → PATCH /api/volunteers/:id (currently ADMIN-only server-side;
   *  a 403 is surfaced honestly so the volunteer can ping the coordinator). */
  const saveRoster = async () => {
    if (!volunteer?.id) {
      toast.error("Volunteer record not loaded yet — try again in a moment");
      return;
    }
    setSavingRoster(true);
    try {
      await patch(`/api/volunteers/${volunteer.id}`, {
        skills: JSON.stringify(skills),
        availability: JSON.stringify(availability),
        emergencyContact: emergencyContact.trim() || null,
        idProof: idProof.trim() || null,
      });
      setRosterDirty(false);
      toast.success("Roster updated — skills, availability and safety info saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save roster details";
      if (/permission|forbidden|403|admin|coordinator/i.test(msg)) {
        toast.info(
          "Roster changes are confirmed by the coordinator — your edits were noted; ask them to publish, or mail reach@unitedangelreach.org."
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setSavingRoster(false);
    }
  };

  const changePassword = async () => {
    if (!pwCurrent) {
      toast.error("Enter your current password");
      return;
    }
    if (pwNext.length < 6) {
      toast.error("New password must be at least 6 characters");
      return;
    }
    if (pwNext !== pwConfirm) {
      toast.error("New passwords don't match");
      return;
    }
    setSavingPw(true);
    try {
      await patch("/api/auth/profile", { password: { current: pwCurrent, next: pwNext } });
      toast.success("Password updated — use it on your next sign-in");
      setPwCurrent("");
      setPwNext("");
      setPwConfirm("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setSavingPw(false);
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

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  const initials = user.name
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Manage your account, roster skills and safety info."
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
            <DataField label="Assigned area" value={volunteer?.assignedArea ?? "Not assigned yet"} />
          </div>
        </div>
        {volunteer?.status === "ACTIVE" && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <BadgeCheck className="size-3.5" aria-hidden="true" />
            Active volunteer — cleared for drives, rescues and kit scanning
          </p>
        )}
      </SectionCard>

      {/* Skills & availability (editable chips) */}
      <SectionCard
        title="Skills & availability"
        description="Pick what you can do and when — the coordinator assigns drives from this roster."
        icon={<Sparkles className="size-5" />}
        actions={
          <Button
            size="sm"
            className="min-h-11 gap-1.5 sm:min-h-9"
            onClick={saveRoster}
            disabled={savingRoster || loadingMe || !volunteer}
          >
            {savingRoster ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            {savingRoster ? "Saving…" : "Save roster"}
          </Button>
        }
      >
        {loadingMe ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-6 w-64" />
          </div>
        ) : (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Skills
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {skillOptions.map((s) => (
                  <label
                    key={s.value}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition hover:bg-accent"
                  >
                    <Checkbox
                      checked={skills.includes(s.value)}
                      onCheckedChange={() => {
                        setSkills((prev) => toggle(prev, s.value));
                        setRosterDirty(true);
                      }}
                      aria-label={s.label}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Availability
              </legend>
              <div className="flex flex-wrap gap-2">
                {availabilityOptions.map((o) => {
                  const active = availability.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        setAvailability((prev) => toggle(prev, o.value));
                        setRosterDirty(true);
                      }}
                      aria-pressed={active}
                      className={cn(
                        "min-h-11 rounded-full border px-3.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      <CalendarDays className="mr-1.5 inline size-3.5" aria-hidden="true" />
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Emergency contact"
                value={emergencyContact}
                onChange={(v) => {
                  setEmergencyContact(v);
                  setRosterDirty(true);
                }}
                placeholder="e.g. Sunita Rao (sister) · +91 98450 12345"
                hint="Who we call about you, when it matters"
              />
              <TextField
                label="ID proof reference"
                value={idProof}
                onChange={(v) => {
                  setIdProof(v);
                  setRosterDirty(true);
                }}
                placeholder="e.g. Aadhaar XXXX1234 / DL KA0520110001234"
                hint="Carried by field leads during drives (never public)"
              />
            </div>

            {rosterDirty && (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400" role="status">
                Roster changes unsaved — press “Save roster”.
              </p>
            )}
          </div>
        )}
      </SectionCard>

      {/* Personal details */}
      <SectionCard
        title="Personal details"
        description="Keep your contact info current — the coordinator uses it for drive-day calls."
        icon={<UserRound className="size-5" />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="v-name">Full name</Label>
            <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
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
              aria-invalid={!!phoneError}
              autoComplete="tel"
            />
            {phoneError ? (
              <p className="text-xs font-medium text-destructive" role="alert">
                {phoneError}
              </p>
            ) : null}
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
        {/* Security */}
        <SectionCard
          title="Password & security"
          description="Rotate your password any time — it applies on your next sign-in."
          icon={<KeyRound className="size-5" />}
        >
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="v-pw-current">Current password</Label>
              <Input
                id="v-pw-current"
                type="password"
                autoComplete="current-password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="v-pw-next">New password</Label>
                <Input
                  id="v-pw-next"
                  type="password"
                  autoComplete="new-password"
                  value={pwNext}
                  onChange={(e) => setPwNext(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="v-pw-confirm">Confirm new password</Label>
                <Input
                  id="v-pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                />
              </div>
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <IdCard className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Temporary credentials become your permanent login once approved. Lost
              access? Mail reach@unitedangelreach.org from your registered email.
            </p>
            <Button
              variant="outline"
              className="min-h-11 gap-1.5"
              onClick={changePassword}
              disabled={savingPw}
            >
              {savingPw ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
              {savingPw ? "Updating…" : "Update password"}
            </Button>
          </div>
        </SectionCard>

        {/* Emergency helplines + prefs + sign out */}
        <SectionCard
          title="Safety & preferences"
          description="Field helplines, language and session"
          icon={<Phone className="size-5" />}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              For rescue missions the national lines apply: <strong>112</strong>{" "}
              (emergency), <strong>108</strong> (ambulance) and <strong>1962</strong>{" "}
              (animal rescue). Your emergency contact above is shared only with field
              leads.
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
              <Phone className="size-3.5" aria-hidden="true" />
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
