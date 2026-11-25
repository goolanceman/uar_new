"use client";

/**
 * UserProfileView — the universal profile page for EVERY role (ADMIN, DONOR,
 * VOLUNTEER, BENEFICIARY). Works inside the admin console (dropdown "My
 * profile") and inside any portal.
 *
 * Sections:
 *  - Hero card: avatar initials, name, role + status badges, member-since and
 *    email/phone/city DataFields, plus role-aware summary stats.
 *  - "Personal details" FormSheet → PATCH /api/profile (self-service fields
 *    only; role and email are admin-managed and never editable here).
 *  - Security → change password (current + new + confirm) → POST /api/profile/password.
 *  - Preferences → theme toggle + organisation default language (display).
 *  - Quick links → the role's portal home.
 */

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  CalendarClock,
  ClipboardList,
  ExternalLink,
  HandHeart,
  HandCoins,
  KeyRound,
  Languages,
  LayoutDashboard,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { get, patch, post } from "@/lib/api-client";
import { navigate } from "@/lib/router";
import { formatDate, formatINR, initials, titleCase } from "@/lib/format";
import { fieldError, minLen, phoneRule, required } from "@/lib/validators";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { DataField } from "@/components/shared/data-field";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormSheet } from "@/components/shared/form-sheet";
import {
  FieldGrid,
  FormSection,
  TextareaField,
  TextField,
} from "@/components/shared/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/shared/theme-toggle";

/* --------------------------------- types ---------------------------------- */

interface ProfileUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  isActive: boolean;
  phone?: string | null;
  city?: string | null;
  pan?: string | null;
  about?: string | null;
  avatar?: string | null;
  createdAt?: string;
}

interface ProfileExtras {
  donor?: {
    type?: string;
    category?: string;
    wants80g?: boolean;
  } | null;
  volunteer?: {
    status?: string;
    assignedArea?: string | null;
    joinedAt?: string;
    skills?: string | null;
  } | null;
  beneficiary?: {
    name?: string;
    category?: string;
    caseStatus?: string;
    city?: string | null;
  } | null;
  stats?: Record<string, number | string | null | undefined>;
  recentRequests?: Array<Record<string, unknown>>;
}

interface ProfilePayload {
  user: ProfileUser;
  extras?: ProfileExtras;
}

interface EditForm {
  name: string;
  phone: string;
  city: string;
  about: string;
}

/* ------------------------------ quick links ------------------------------- */

const PORTAL_LINKS: Record<string, { label: string; to: string; icon: React.ComponentType<{ className?: string }> }> = {
  ADMIN: { label: "Open admin console", to: "/admin/dashboard", icon: LayoutDashboard },
  DONOR: { label: "Open donor portal", to: "/donor/overview", icon: HandCoins },
  VOLUNTEER: { label: "Open volunteer portal", to: "/volunteer/overview", icon: ClipboardList },
  BENEFICIARY: { label: "Open help centre", to: "/beneficiary/help", icon: HandHeart },
};

/* ---------------------------------- view ---------------------------------- */

export function UserProfileView() {
  const { refresh } = useAuth();

  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<string | null>(null);

  // Personal-details FormSheet
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<EditForm>({ name: "", phone: "", city: "", about: "" });
  const [snapshot, setSnapshot] = useState<string>(JSON.stringify({ name: "", phone: "", city: "", about: "" }));
  const [saving, setSaving] = useState(false);

  // Change password
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, pub] = await Promise.all([
        get<ProfilePayload>("/api/profile"),
        get<{ defaultLanguage?: string }>("/api/settings/public").catch(() => null),
      ]);
      setProfile(data);
      setLanguage(pub?.defaultLanguage ?? null);
      const next: EditForm = {
        name: data.user.name ?? "",
        phone: data.user.phone ?? "",
        city: data.user.city ?? "",
        about: data.user.about ?? "",
      };
      setForm(next);
      setSnapshot(JSON.stringify(next));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load your profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const u = profile?.user;
  const extras = profile?.extras;
  const stats = extras?.stats ?? {};
  const role = (u?.role ?? "DONOR").toUpperCase();
  const quickLink = PORTAL_LINKS[role] ?? PORTAL_LINKS.DONOR;
  const QuickIcon = quickLink.icon;

  /* ----------------------------- personal form ----------------------------- */

  const dirty = editOpen && JSON.stringify(form) !== snapshot;

  const submitEdit = async () => {
    const nameErr = required("Name")(form.name);
    if (nameErr) {
      toast.error(nameErr);
      return;
    }
    const phoneErr = fieldError(form.phone, [phoneRule(true)]);
    if (phoneErr) {
      toast.error(phoneErr);
      return;
    }
    setSaving(true);
    try {
      await patch("/api/profile", {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        city: form.city.trim() || null,
        about: form.about.trim() || null,
      });
      toast.success("Profile updated");
      setEditOpen(false);
      await Promise.all([load(), refresh()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update your profile");
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------- change password ---------------------------- */

  const changePassword = async () => {
    const curErr = required("Current password")(pwCurrent);
    if (curErr) {
      toast.error(curErr);
      return;
    }
    const nextErr = minLen(6, "New password")(pwNext);
    if (nextErr) {
      toast.error(nextErr);
      return;
    }
    if (pwNext !== pwConfirm) {
      toast.error("New passwords don't match");
      return;
    }
    setSavingPw(true);
    try {
      await post("/api/profile/password", { current: pwCurrent, next: pwNext });
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

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="My profile"
        description="Your account, contact details and security settings."
        icon={<UserRound className="size-5" aria-hidden="true" />}
      />

      {/* Hero card */}
      <section className="overflow-hidden rounded-xl border bg-card" aria-label="Account overview">
        <div className="relative border-b bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 sm:p-6">
          {loading ? (
            <div className="flex items-center gap-4">
              <Skeleton className="size-16 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-3 w-60" />
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-start gap-4">
              <span
                className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xl font-bold text-primary ring-1 ring-primary/20"
                aria-hidden="true"
              >
                {initials(u?.name) || "U"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-bold tracking-tight sm:text-xl">
                    {u?.name ?? "—"}
                  </h2>
                  <Badge className="bg-primary/10 text-primary border-primary/20" variant="outline">
                    {titleCase(role)}
                  </Badge>
                  <StatusBadge status={u?.status} />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="size-3.5" aria-hidden="true" />
                    Member since {u?.createdAt ? formatDate(u.createdAt) : "—"}
                  </span>
                  {u?.about ? <span className="hidden sm:inline">· {u.about}</span> : null}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setEditOpen(true)}
                aria-label="Edit personal details"
                className="min-h-11 sm:min-h-9"
              >
                <Pencil className="size-4" aria-hidden="true" /> Edit details
              </Button>
            </div>
          )}
        </div>
        <div className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
          ) : (
            <>
              <DataField
                label="Email"
                value={u?.email ?? ""}
                icon={<Mail className="size-3" aria-hidden="true" />}
                copy
              />
              <DataField
                label="Phone"
                value={u?.phone ?? ""}
                icon={<Phone className="size-3" aria-hidden="true" />}
                copy
              />
              <DataField
                label="City"
                value={u?.city ?? ""}
                icon={<MapPin className="size-3" aria-hidden="true" />}
              />
              <DataField label="Account status" value={<StatusBadge status={u?.status} />} />
              <DataField label="Sign-in enabled" value={u?.isActive ? "Yes" : "No"} />
              {u?.pan ? (
                <DataField label="PAN" value={u.pan} mono copy />
              ) : (
                <DataField label="User ID" value={u?.id ?? ""} mono copy />
              )}
            </>
          )}
        </div>
      </section>

      {/* Role-aware summary */}
      <SectionCard
        title={role === "DONOR" ? "Giving snapshot" : role === "VOLUNTEER" ? "Service snapshot" : role === "BENEFICIARY" ? "Case snapshot" : "Console snapshot"}
        description="Role-specific highlights from your account."
        icon={<ShieldCheck className="size-5" aria-hidden="true" />}
      >
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            {role === "DONOR" && (
              <>
                <DataField label="Lifetime giving" value={formatINR(Number(stats.lifetimeValue ?? 0))} />
                <DataField label="Donations" value={String(stats.donationCount ?? 0)} />
                <DataField label="80G receipts" value={String(stats.receiptsCount ?? 0)} />
                <DataField label="Campaigns supported" value={String(stats.campaignsSupported ?? 0)} />
              </>
            )}
            {role === "VOLUNTEER" && (
              <>
                <DataField
                  label="Volunteer status"
                  value={
                    extras?.volunteer ? (
                      <StatusBadge status={extras.volunteer.status ?? "PENDING"} />
                    ) : (
                      "No profile yet"
                    )
                  }
                />
                <DataField label="Assigned area" value={extras?.volunteer?.assignedArea ?? ""} />
                <DataField label="Tasks completed" value={`${stats.tasksCompleted ?? 0} / ${stats.tasksAssigned ?? 0}`} />
                <DataField
                  label="Hours logged"
                  value={`${Number(stats.hoursLogged ?? 0)} h · ${stats.attendanceDays ?? 0} days`}
                />
              </>
            )}
            {role === "BENEFICIARY" && (
              <>
                <DataField
                  label="Case status"
                  value={extras?.beneficiary?.caseStatus ? <StatusBadge status={extras.beneficiary.caseStatus} /> : "No case yet"}
                />
                <DataField label="Category" value={titleCase(extras?.beneficiary?.category ?? "")} />
                <DataField label="Help requests" value={String(stats.totalRequests ?? 0)} />
                <DataField label="Case name" value={extras?.beneficiary?.name ?? ""} />
              </>
            )}
            {role === "ADMIN" && (
              <>
                <DataField label="Logged actions" value={String(stats.actionsCount ?? 0)} />
                <DataField label="Console role" value={titleCase(role)} />
                <DataField label="Sign-in status" value={u?.isActive ? "Enabled" : "Disabled"} />
                <DataField label="PAN" value={u?.pan ?? ""} mono />
              </>
            )}
          </div>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Security — change password */}
        <SectionCard
          title="Password & security"
          description="Rotate your password any time — it applies on your next sign-in."
          icon={<KeyRound className="size-5" aria-hidden="true" />}
        >
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="up-pw-current">Current password</Label>
              <Input
                id="up-pw-current"
                type="password"
                autoComplete="current-password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="up-pw-next">New password</Label>
                <Input
                  id="up-pw-next"
                  type="password"
                  autoComplete="new-password"
                  value={pwNext}
                  onChange={(e) => setPwNext(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="up-pw-confirm">Confirm new password</Label>
                <Input
                  id="up-pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Minimum 6 characters.</p>
            <Button
              variant="outline"
              className="min-h-11 gap-1.5 sm:min-h-9"
              onClick={changePassword}
              disabled={savingPw}
            >
              {savingPw ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="size-4" aria-hidden="true" />
              )}
              {savingPw ? "Updating…" : "Update password"}
            </Button>
          </div>
        </SectionCard>

        {/* Preferences + quick links */}
        <SectionCard
          title="Preferences & quick links"
          description="Appearance, language and shortcuts to your portal."
          icon={<Languages className="size-5" aria-hidden="true" />}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-medium">Appearance</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Switch between light and dark theme.
                </p>
              </div>
              <ThemeToggle align="end" />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-medium">Language</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Set by the organisation by default — regional languages are rolling out.
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0 border bg-accent">
                {loading ? "…" : language === "en" || !language ? "English" : language}
              </Badge>
            </div>
            <Button
              variant="outline"
              className="min-h-11 w-full gap-1.5 sm:w-auto"
              onClick={() => navigate(quickLink.to)}
              aria-label={quickLink.label}
            >
              <QuickIcon className="size-4" aria-hidden="true" />
              {quickLink.label}
              <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </Button>
          </div>
        </SectionCard>
      </div>

      {/* Personal details FormSheet */}
      <FormSheet
        open={editOpen}
        onOpenChange={(o) => {
          if (!o && !saving) setEditOpen(false);
        }}
        title="Personal details"
        description="Update how the trust reaches you. Email and role are managed by administrators."
        onSubmit={submitEdit}
        submitLabel="Save changes"
        loading={saving}
        dirty={dirty}
        size="md"
      >
        <FormSection title="Contact" description="Keep this current — receipts and helplines depend on it.">
          <FieldGrid>
            <TextField
              label="Full name"
              required
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
            />
            <TextField
              label="Phone"
              inputMode="tel"
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
              placeholder="9876543210"
            />
            <TextField
              label="City"
              value={form.city}
              onChange={(v) => setForm({ ...form, city: v })}
              placeholder="e.g. Bengaluru"
            />
          </FieldGrid>
        </FormSection>
        <FormSection title="About" description="A short line about you (optional).">
          <TextareaField
            label="About"
            value={form.about}
            onChange={(v) => setForm({ ...form, about: v })}
            rows={3}
            placeholder="Tell the team a little about yourself"
          />
        </FormSection>
      </FormSheet>
    </div>
  );
}

export default UserProfileView;
