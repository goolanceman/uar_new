"use client";

import { useEffect, useState } from "react";
import { KeyRound, MapPin, Save, UserRound, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { useAuth, type SessionUser } from "@/hooks/use-auth";
import { get, patch } from "@/lib/api-client";
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
import { Skeleton } from "@/components/ui/skeleton";

export default function DonorProfile({ user }: { user: SessionUser }) {
  const { refresh } = useAuth();

  const [pan, setPan] = useState<string | null>(null);
  const [loadingPan, setLoadingPan] = useState(true);

  // Profile form
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [city, setCity] = useState(user.city ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // PAN form
  const [panInput, setPanInput] = useState("");
  const [savingPan, setSavingPan] = useState(false);

  useEffect(() => {
    let alive = true;
    get<unknown>("/api/auth/me")
      .then((data) => {
        if (!alive) return;
        const u =
          data && typeof data === "object" && "user" in (data as Record<string, unknown>)
            ? (data as { user?: { pan?: string | null } | null }).user
            : null;
        setPan(u?.pan ?? null);
        setPanInput(u?.pan ?? "");
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoadingPan(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const initials = user.name
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

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
      toast.success("Password changed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setSavingPassword(false);
    }
  };

  const savePan = async () => {
    const v = panInput.trim().toUpperCase();
    if (v && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v)) {
      toast.error("PAN looks invalid — format: ABCDE1234F");
      return;
    }
    setSavingPan(true);
    try {
      await patch("/api/auth/profile", { pan: v || null });
      setPan(v || null);
      toast.success(v ? "PAN saved — it will appear on 80G receipts" : "PAN removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save PAN");
    } finally {
      setSavingPan(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Manage your donor account details.
        </p>
      </div>

      {/* Identity card */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
            {initials || "U"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            <div className="mt-1.5 flex gap-1.5">
              <Badge variant="secondary" className="rounded-full text-[10px]">
                {user.role}
              </Badge>
              <Badge
                variant="outline"
                className="rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700"
              >
                {user.status}
              </Badge>
            </div>
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
            <CardDescription>Keep your contact info current.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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

        <div className="space-y-4">
          {/* Change password */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="size-4 text-primary" aria-hidden="true" />
                Change password
              </CardTitle>
              <CardDescription>
                Use at least 8 characters.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="p-curpass">Current password</Label>
                <Input
                  id="p-curpass"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-nextpass">New password</Label>
                <Input
                  id="p-nextpass"
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

          {/* PAN */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <WalletCards className="size-4 text-primary" aria-hidden="true" />
                PAN (for 80G receipts)
              </CardTitle>
              <CardDescription>
                Add your PAN so it prints on your donation receipts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingPan ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="p-pan">PAN number</Label>
                    <Input
                      id="p-pan"
                      className="font-mono uppercase"
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      value={panInput}
                      onChange={(e) => setPanInput(e.target.value.toUpperCase())}
                    />
                    {pan && (
                      <p className="flex items-center gap-1 text-xs text-emerald-700">
                        <MapPin className="size-3" aria-hidden="true" />
                        Saved — appears on receipts as {pan}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="min-h-11 gap-1.5"
                    onClick={savePan}
                    disabled={savingPan}
                  >
                    {savingPan ? "Saving…" : "Save PAN"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
