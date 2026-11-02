"use client";

import * as React from "react";
import { useState } from "react";
import { Link, navigate } from "@/lib/router";
import { patch } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Section, EmptyState } from "@/components/public/shared";
import { RoleBadge } from "@/components/public/auth-pages";
import {
  ArrowRight,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Save,
  ShieldCheck,
  UserCog,
} from "lucide-react";

const PORTAL_BY_ROLE: Record<string, { label: string; href: string }> = {
  ADMIN: { label: "Admin console", href: "/admin" },
  DONOR: { label: "Donor Portal", href: "/donor" },
  VOLUNTEER: { label: "Volunteer Portal", href: "/volunteer" },
  BENEFICIARY: { label: "Beneficiary desk", href: "/beneficiary" },
};

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  PENDING: "bg-amber-100 text-amber-700",
  SUSPENDED: "bg-red-100 text-red-700",
};

export function ProfilePage() {
  const { user, loading, refresh, logout } = useAuth();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [nextPw, setNextPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  React.useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setPhone(user.phone ?? "");
      setCity(user.city ?? "");
    }
  }, [user]);

  /* ---------------- Guard ---------------- */
  if (loading) {
    return (
      <Section className="mx-auto max-w-3xl">
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </Section>
    );
  }

  if (!user) {
    return (
      <Section className="mx-auto max-w-xl">
        <EmptyState
          icon={LogIn}
          title="Sign in to view your profile"
          hint="Your profile, donation receipts and volunteer status live behind a sign-in."
          action={
            <Button className="bg-emerald-600 hover:bg-emerald-700" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          }
        />
      </Section>
    );
  }

  /* ---------------- Save profile ---------------- */
  const saveProfile = async () => {
    if (!name.trim()) {
      toast.error("Name cannot be empty");
      return;
    }
    setSavingProfile(true);
    try {
      await patch("/api/auth/profile", {
        name: name.trim(),
        phone: phone.trim() || undefined,
        city: city.trim() || undefined,
      });
      await refresh();
      toast.success("Profile updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  /* ---------------- Change password ---------------- */
  const changePassword = async () => {
    if (nextPw.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    setSavingPw(true);
    try {
      await patch("/api/auth/profile", {
        password: { current: currentPw, next: nextPw },
      });
      setCurrentPw("");
      setNextPw("");
      toast.success("Password changed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setSavingPw(false);
    }
  };

  /* ---------------- Logout ---------------- */
  const doLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore
    }
    toast.success("Signed out");
    navigate("/");
  };

  const portal = PORTAL_BY_ROLE[user.role];
  const initials = user.name
    ?.split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <Section title="Your profile" subtitle="Account details, security and portal access.">
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Identity card */}
        <div className="space-y-4">
          <Card className="p-6 text-center">
            <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-emerald-600 text-2xl font-bold text-white">
              {initials || "?"}
            </span>
            <h2 className="mt-3 truncate text-lg font-bold">{user.name}</h2>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              <RoleBadge role={user.role} />
              <Badge
                className={cn(
                  "border-0 text-[10px] uppercase hover:opacity-90",
                  STATUS_BADGE[user.status] ?? "bg-zinc-100 text-zinc-600"
                )}
              >
                {user.status}
              </Badge>
            </div>
            {(user.city || user.phone) && (
              <>
                <Separator className="my-4" />
                <div className="space-y-1 text-sm text-muted-foreground">
                  {user.phone && <p>Phone: {user.phone}</p>}
                  {user.city && <p>City: {user.city}</p>}
                </div>
              </>
            )}
            {portal && (
              <Button
                className="mt-4 w-full bg-emerald-600 hover:bg-emerald-700"
                asChild
              >
                <Link href={portal.href}>
                  <ShieldCheck className="size-4" aria-hidden />
                  {portal.label}
                </Link>
              </Button>
            )}
            <Button variant="outline" className="mt-2 w-full text-red-600 hover:bg-red-50 hover:text-red-700" onClick={doLogout}>
              <LogOut className="size-4" aria-hidden /> Logout
            </Button>
          </Card>

          {/* Portal quick links */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold">Quick links</h3>
            <ul className="mt-2 space-y-1 text-sm">
              <li>
                <Link href="/donate" className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-muted">
                  Donate <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
              <li>
                <Link href="/volunteer" className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-muted">
                  Volunteer <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
              <li>
                <Link href="/impact" className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-muted">
                  Public impact <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            </ul>
          </Card>
        </div>

        {/* Edit forms */}
        <div className="space-y-4">
          <Card className="p-6">
            <h3 className="flex items-center gap-2 font-semibold">
              <UserCog className="size-5 text-emerald-600" aria-hidden /> Edit details
            </h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="p-name">Name</Label>
                <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-phone">Phone</Label>
                <Input id="p-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-city">City</Label>
                <Input id="p-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Bengaluru" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={user.email} disabled aria-describedby="email-locked" />
                <p id="email-locked" className="text-xs text-muted-foreground">
                  Email can&rsquo;t be changed — contact care@unitedangelreach.org
                </p>
              </div>
            </div>
            <Button
              className="mt-5 bg-emerald-600 hover:bg-emerald-700"
              onClick={saveProfile}
              disabled={savingProfile}
            >
              {savingProfile ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              Save changes
            </Button>
          </Card>

          <Card className="p-6">
            <h3 className="flex items-center gap-2 font-semibold">
              <KeyRound className="size-5 text-emerald-600" aria-hidden /> Change password
            </h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="p-cur">Current password</Label>
                <Input
                  id="p-cur"
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-next">New password</Label>
                <Input
                  id="p-next"
                  type="password"
                  value={nextPw}
                  onChange={(e) => setNextPw(e.target.value)}
                  autoComplete="new-password"
                  placeholder="min 8 characters"
                />
              </div>
            </div>
            <Button
              variant="outline"
              className="mt-5"
              onClick={changePassword}
              disabled={savingPw || !currentPw || !nextPw}
            >
              {savingPw ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <KeyRound className="size-4" aria-hidden />
              )}
              Update password
            </Button>
          </Card>
        </div>
      </div>
    </Section>
  );
}
