"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  Bell,
  KeyRound,
  Landmark,
  Languages,
  Loader2,
  LogOut,
  Mail,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth, type SessionUser } from "@/hooks/use-auth";
import { get, patch } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatDate, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { DataField } from "@/components/shared/data-field";
import { SwitchField } from "@/components/shared/form-fields";
import { panRule, phoneRule, fieldError } from "@/lib/validators";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface MeUser {
  pan?: string | null;
  about?: string | null;
  createdAt?: string;
  emailOptIn?: boolean;
  smsOptIn?: boolean;
  whatsappOptIn?: boolean;
}

type Prefs = { email: boolean; sms: boolean; whatsapp: boolean };

export default function DonorProfile({ user }: { user: SessionUser }) {
  const { refresh, logout } = useAuth();

  const [pan, setPan] = useState<string | null>(null);
  const [joinedAt, setJoinedAt] = useState<string | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [language, setLanguage] = useState<string | null>(null);

  // Profile form
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [city, setCity] = useState(user.city ?? "");
  const [panInput, setPanInput] = useState("");
  const [about, setAbout] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [panError, setPanError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Communication preferences (Donor CRM prefs where the API supports them)
  const [prefs, setPrefs] = useState<Prefs>({ email: true, sms: true, whatsapp: true });
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Password form
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const loadMe = useCallback(async () => {
    setLoadingMe(true);
    try {
      const [me, pub] = await Promise.all([
        get<{ user?: MeUser | null }>("/api/auth/me").catch(() => null),
        get<{ defaultLanguage?: string }>("/api/settings/public").catch(() => null),
      ]);
      const u = me?.user ?? null;
      setPan(u?.pan ?? null);
      setPanInput(u?.pan ?? "");
      setAbout(u?.about ?? "");
      setJoinedAt(u?.createdAt ?? null);
      setLanguage(pub?.defaultLanguage ?? null);
      setPrefs({
        email: u?.emailOptIn ?? true,
        sms: u?.smsOptIn ?? true,
        whatsapp: u?.whatsappOptIn ?? true,
      });
    } finally {
      setLoadingMe(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const save = async () => {
    const pErr = fieldError(phone, [phoneRule(true)]);
    const panErr = fieldError(panInput, [panRule(true)]);
    setPhoneError(pErr);
    setPanError(panErr);
    if (pErr || panErr) return;
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
        pan: panInput.trim().toUpperCase() || null,
        about: about.trim() || null,
      });
      await refresh();
      setPan(panInput.trim().toUpperCase() || null);
      toast.success(
        panInput.trim() && !pan
          ? "Profile saved — 80G receipts will now carry your PAN"
          : "Profile saved"
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Communication preferences — PATCH /api/auth/profile persists only the
   * fields it knows (name/phone/city/pan/about/password today). We verify the
   * echo and tell the user honestly when a channel pref was not persisted.
   */
  const savePrefs = async (next: Prefs) => {
    const prev = prefs;
    setPrefs(next);
    setSavingPrefs(true);
    try {
      const res = await patch<{ user?: MeUser }>("/api/auth/profile", {
        emailOptIn: next.email,
        smsOptIn: next.sms,
        whatsappOptIn: next.whatsapp,
      });
      const persisted =
        res?.user &&
        (res.user.emailOptIn !== undefined ||
          res.user.smsOptIn !== undefined ||
          res.user.whatsappOptIn !== undefined);
      if (!persisted) {
        setPrefs(prev);
        toast.info(
          "Channel preferences are managed by the trust office for now — write to reach@unitedangelreach.org to update them."
        );
      } else {
        toast.success("Communication preferences saved");
      }
    } catch (e) {
      setPrefs(prev);
      toast.error(e instanceof Error ? e.message : "Could not save preferences");
    } finally {
      setSavingPrefs(false);
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

  const initials = user.name
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Manage your donor account, PAN and preferences."
        icon={<UserRound className="size-5" />}
      />

      {/* Account card */}
      <SectionCard title="Account" icon={<BadgeCheck className="size-5" />}>
        {loadingMe ? (
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
              {initials || "U"}
            </span>
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <DataField label="Email" value={user.email} icon={<Mail className="size-3.5" />} copy />
              <DataField label="Role" value={titleCase(user.role)} />
              <DataField label="Member since" value={joinedAt ? formatDate(joinedAt) : "—"} />
              <DataField label="Account status" value={titleCase(user.status)} />
            </div>
          </div>
        )}
        {/* 80G-ready badge */}
        {!loadingMe && (
          <div className="mt-4">
            {pan ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                80G-ready · PAN {pan} prints on every receipt
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <Landmark className="size-3.5" aria-hidden="true" />
                Add PAN below for 80G-ready receipts
              </span>
            )}
          </div>
        )}
        {user.status === "ACTIVE" && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <BadgeCheck className="size-3.5" aria-hidden="true" />
            Verified active donor account
          </p>
        )}
      </SectionCard>

      {/* Editor */}
      <SectionCard
        title="Personal details"
        description="Keep your contact info current — receipts and helplines depend on it."
        icon={<UserRound className="size-5" />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="p-name">Full name</Label>
            <Input
              id="p-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-phone">Phone</Label>
            <Input
              id="p-phone"
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
            <Label htmlFor="p-city">City</Label>
            <Input
              id="p-city"
              placeholder="e.g. Bengaluru"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              autoComplete="address-level2"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-pan">PAN (for 80G receipts)</Label>
            <div className="relative">
              <ShieldCheck
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="p-pan"
                className={cn("pl-9 font-mono uppercase", pan && "border-emerald-500/40")}
                placeholder="ABCDE1234F"
                maxLength={10}
                value={panInput}
                onChange={(e) => setPanInput(e.target.value.toUpperCase())}
                aria-invalid={!!panError}
                aria-describedby="p-pan-hint"
              />
            </div>
            {panError ? (
              <p className="text-xs font-medium text-destructive" role="alert">
                {panError}
              </p>
            ) : (
              <p id="p-pan-hint" className="text-xs text-muted-foreground">
                {pan ? `Saved — prints on receipts as ${pan}.` : "Add your PAN so 80G receipts are ITR-ready."}
              </p>
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="p-about">About you (optional)</Label>
            <Textarea
              id="p-about"
              rows={3}
              placeholder="A line about why you give — it helps our team thank you personally."
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
        {/* Password */}
        <SectionCard
          title="Password & security"
          description="Rotate your password any time — it applies on your next sign-in."
          icon={<KeyRound className="size-5" />}
        >
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="p-pw-current">Current password</Label>
              <Input
                id="p-pw-current"
                type="password"
                autoComplete="current-password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="p-pw-next">New password</Label>
                <Input
                  id="p-pw-next"
                  type="password"
                  autoComplete="new-password"
                  value={pwNext}
                  onChange={(e) => setPwNext(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-pw-confirm">Confirm new password</Label>
                <Input
                  id="p-pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Minimum 6 characters. Lost access instead? Write to
              reach@unitedangelreach.org from your registered email.
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

        {/* Preferences + sign out */}
        <SectionCard
          title="Donor preferences"
          description="How we reach you — 80G receipts always arrive by email."
          icon={<Bell className="size-5" />}
        >
          <div className="space-y-3">
            <SwitchField
              label="Email updates"
              hint="Receipts, certificate issuances and monthly impact digests"
              checked={prefs.email}
              onChange={(v) => void savePrefs({ ...prefs, email: v })}
              disabled={savingPrefs}
            />
            <SwitchField
              label="SMS updates"
              hint="Urgent drives and donation confirmations"
              checked={prefs.sms}
              onChange={(v) => void savePrefs({ ...prefs, sms: v })}
              disabled={savingPrefs}
            />
            <SwitchField
              label="WhatsApp updates"
              hint="Short field stories from the ground team"
              checked={prefs.whatsapp}
              onChange={(v) => void savePrefs({ ...prefs, whatsapp: v })}
              disabled={savingPrefs}
            />
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Languages className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                App language:{" "}
                <span className="font-medium text-foreground">
                  {loadingMe ? "…" : (language ?? "English")}
                </span>{" "}
                — set by the organisation by default. Regional languages (ಕನ್ನಡ,
                हिन्दी) are rolling out.
              </span>
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="outline"
                className="min-h-11 gap-1.5 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                onClick={signOut}
              >
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
