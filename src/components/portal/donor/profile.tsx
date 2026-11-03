"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  KeyRound,
  Languages,
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
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { DataField } from "@/components/shared/data-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface MeResponse {
  user?: {
    pan?: string | null;
    about?: string | null;
    createdAt?: string;
  } | null;
}

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
  const [saving, setSaving] = useState(false);

  const loadMe = useCallback(async () => {
    setLoadingMe(true);
    try {
      const [me, pub] = await Promise.all([
        get<MeResponse>("/api/auth/me").catch(() => null),
        get<{ defaultLanguage?: string }>("/api/settings/public").catch(() => null),
      ]);
      const u = me?.user ?? null;
      setPan(u?.pan ?? null);
      setPanInput(u?.pan ?? "");
      setAbout(u?.about ?? "");
      setJoinedAt(u?.createdAt ?? null);
      setLanguage(pub?.defaultLanguage ?? null);
    } finally {
      setLoadingMe(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    const v = panInput.trim().toUpperCase();
    if (v && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v)) {
      toast.error("PAN looks invalid — format: ABCDE1234F");
      return;
    }
    setSaving(true);
    try {
      await patch("/api/auth/profile", {
        name: name.trim(),
        phone: phone.trim() || null,
        city: city.trim() || null,
        pan: v || null,
        about: about.trim() || null,
      });
      await refresh();
      setPan(v || null);
      toast.success(
        v && !pan ? "Profile saved — 80G receipts will now carry your PAN" : "Profile saved"
      );
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
              <DataField label="Role" value={titleSafe(user.role)} />
              <DataField
                label="Member since"
                value={joinedAt ? formatDate(joinedAt) : "—"}
              />
              <DataField
                label="Account status"
                value={titleSafe(user.status)}
              />
            </div>
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
              autoComplete="tel"
            />
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
                aria-describedby="p-pan-hint"
              />
            </div>
            <p id="p-pan-hint" className="text-xs text-muted-foreground">
              {pan
                ? `Saved — prints on receipts as ${pan}.`
                : "Add your PAN so 80G receipts are ITR-ready."}
            </p>
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
        {/* Password note */}
        <SectionCard
          title="Password & security"
          description="How to keep your donor account safe."
          icon={<KeyRound className="size-5" />}
        >
          <p className="text-sm text-muted-foreground">
            For your protection, password changes for donor accounts are handled by
            our support desk — write to{" "}
            <span className="font-medium text-foreground">
              reach@unitedangelreach.org
            </span>{" "}
            from your registered email and we&apos;ll rotate it within a working
            day. Always sign out on shared devices.
          </p>
        </SectionCard>

        {/* Preferences + sign out */}
        <SectionCard
          title="Preferences"
          description="Language and session"
          icon={<Languages className="size-5" />}
        >
          <div className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Languages className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                App language:{" "}
                <span className="font-medium text-foreground">
                  {loadingMe ? "…" : (language ?? "English")}
                </span>{" "}
                — set by the organisation by default. Regional languages (ಕನ್ನಡ,
                हिन्दी) are rolling out; your preference will follow this setting.
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
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

/** titleCase guard for short codes like roles/statuses. */
function titleSafe(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
}
