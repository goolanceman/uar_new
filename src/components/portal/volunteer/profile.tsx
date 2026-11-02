"use client";

import { useEffect, useState } from "react";
import {
  BadgeCheck,
  KeyRound,
  MapPin,
  Save,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth, type SessionUser } from "@/hooks/use-auth";
import { useMasters, labelOf } from "@/hooks/use-masters";
import type { VolunteerProfile } from "../portal-router";
import { patch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const { refresh } = useAuth();
  const { options: skillOptions } = useMasters("SKILL");
  const { options: availabilityOptions } = useMasters("AVAILABILITY");

  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [city, setCity] = useState(user.city ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setName(user.name);
    setPhone(user.phone ?? "");
    setCity(user.city ?? "");
  }, [user.name, user.phone, user.city]);

  const initials = user.name
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

  const skills = parseJsonList(volunteer?.skills);
  const availability = parseJsonList(volunteer?.availability);

  const saveProfile = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
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

  const savePassword = async () => {
    if (!currentPassword || !nextPassword) {
      toast.error("Enter both current and new password");
      return;
    }
    if (nextPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    setSavingPassword(true);
    try {
      await patch("/api/auth/profile", {
        password: { current: currentPassword, next: nextPassword },
      });
      setCurrentPassword("");
      setNextPassword("");
      toast.success(
        "Password changed — this is now your permanent login"
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and check your volunteer status.
        </p>
      </div>

      {/* Volunteer status card */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
            {initials || "U"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold">{user.name}</p>
              <Badge
                variant="outline"
                className={volunteer?.status === "ACTIVE"
                  ? "gap-1 rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700"
                  : "gap-1 rounded-full border-amber-200 bg-amber-50 text-[10px] text-amber-700"}
              >
                <BadgeCheck className="size-3" aria-hidden="true" />
                {volunteer ? `Volunteer · ${volunteer.status}` : `Account · ${user.status}`}
              </Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>

            {volunteer ? (
              <div className="mt-3 space-y-2 text-sm">
                {volunteer.assignedArea && (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="size-4 text-primary" aria-hidden="true" />
                    Assigned area:{" "}
                    <span className="font-medium text-foreground">
                      {volunteer.assignedArea}
                    </span>
                  </p>
                )}
                {availability.length > 0 && (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <Sparkles className="size-4 text-primary" aria-hidden="true" />
                    Availability:{" "}
                    <span className="font-medium text-foreground">
                      {availability
                        .map((a) => labelOf(availabilityOptions, a))
                        .join(", ")}
                    </span>
                  </p>
                )}
                {skills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {skills.map((s) => (
                      <span
                        key={s}
                        className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
                      >
                        {labelOf(skillOptions, s)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No volunteer profile yet — submit your application to get on the
                field roster.
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Edit profile */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="size-4 text-primary" aria-hidden="true" />
              Personal details
            </CardTitle>
            <CardDescription>
              Keep your contact info current — the coordinator uses it for drive
              day calls.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
              />
            </div>
            <Button
              className="min-h-11 gap-1.5"
              onClick={saveProfile}
              disabled={savingProfile}
            >
              <Save className="size-4" aria-hidden="true" />
              {savingProfile ? "Saving…" : "Save changes"}
            </Button>
          </CardContent>
        </Card>

        {/* Change password */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-primary" aria-hidden="true" />
              Change password
            </CardTitle>
            <CardDescription>
              {user.status === "PENDING"
                ? "Your temporary credentials become permanent on approval — change them anytime."
                : "Use at least 8 characters."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="v-curpass">Current password</Label>
              <Input
                id="v-curpass"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-nextpass">New password</Label>
              <Input
                id="v-nextpass"
                type="password"
                value={nextPassword}
                onChange={(e) => setNextPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <Button
              variant="outline"
              className="min-h-11 gap-1.5"
              onClick={savePassword}
              disabled={savingPassword}
            >
              {savingPassword ? "Updating…" : "Update password"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
