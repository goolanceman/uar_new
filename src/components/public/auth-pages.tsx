"use client";

import * as React from "react";
import { useState } from "react";
import { Link, navigate } from "@/lib/router";
import { useAuth, type SessionUser, type TempCreds } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Section } from "@/components/public/shared";
import {
  Copy,
  Heart,
  Info,
  KeyRound,
  Loader2,
  LogIn,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const DEMO_ACCOUNTS = [
  { label: "Admin", email: "admin@unitedangelreach.org", password: "Admin@123" },
  { label: "Donor", email: "donor@demo.org", password: "Donor@123" },
  { label: "Volunteer", email: "volunteer@demo.org", password: "Volun@123" },
  { label: "Beneficiary", email: "beneficiary@demo.org", password: "Benef@123" },
];

export function routeByRole(role: string | undefined): string {
  switch (role) {
    case "ADMIN":
      return "/admin";
    case "DONOR":
      return "/donor";
    case "VOLUNTEER":
      return "/volunteer";
    case "BENEFICIARY":
      return "/beneficiary";
    default:
      return "/";
  }
}

function copyText(text: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Copied to clipboard"))
    .catch(() => toast.error("Copy failed — select the text manually"));
}

function AuthShell({
  children,
  title,
  subtitle,
  icon,
}: {
  children: React.ReactNode;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <Section className="py-10 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <Card className="p-6 sm:p-8">
          <div className="text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              {icon}
            </span>
            <h1 className="mt-4 text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="mt-6">{children}</div>
        </Card>
      </div>
    </Section>
  );
}

function TempCredsDialog({
  creds,
  onClose,
  onContinue,
}: {
  creds: TempCreds | null;
  onClose: () => void;
  onContinue: () => void;
}) {
  return (
    <Dialog open={!!creds} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-emerald-600" aria-hidden />
            Your temporary login — shown once
          </DialogTitle>
          <DialogDescription>
            Save these now. You&rsquo;ll use them to sign in; volunteers&rsquo; portals unlock after admin
            approval.
          </DialogDescription>
        </DialogHeader>
        {creds && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Email</p>
                <code className="block truncate text-sm font-semibold select-all">{creds.email}</code>
              </div>
              <Button variant="outline" size="icon" className="size-8 shrink-0" aria-label="Copy email" onClick={() => copyText(creds.email)}>
                <Copy className="size-3.5" aria-hidden />
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Password</p>
                <code className="block truncate text-sm font-semibold select-all">{creds.password}</code>
              </div>
              <Button variant="outline" size="icon" className="size-8 shrink-0" aria-label="Copy password" onClick={() => copyText(creds.password)}>
                <Copy className="size-3.5" aria-hidden />
              </Button>
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              This password is never shown again. Copy it to your notes now.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={onContinue}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/* LOGIN                                                               */
/* ================================================================== */

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Enter your email and password");
      return;
    }
    setBusy(true);
    try {
      const user: SessionUser = await login(email.trim(), password);
      toast.success(`Welcome back, ${user.name.split(" ")[0]}!`);
      navigate(routeByRole(user.role));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Donors, volunteers, beneficiaries and admins — one door."
      icon={<LogIn className="size-6" aria-hidden />}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="l-email">Email</Label>
          <Input
            id="l-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="l-password">Password</Label>
          <Input
            id="l-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Button type="submit" className="h-11 w-full bg-emerald-600 hover:bg-emerald-700" disabled={busy}>
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : "Sign in"}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/register" className="font-semibold text-emerald-700 hover:underline">
          Create an account
        </Link>
      </p>

      <Separator className="my-5" />

      <div className="rounded-lg border bg-muted/40 p-4">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <Info className="size-3.5" aria-hidden /> Demo accounts — click to fill
        </p>
        <div className="mt-2 grid gap-1.5">
          {DEMO_ACCOUNTS.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => {
                setEmail(d.email);
                setPassword(d.password);
              }}
              className="flex min-h-[40px] items-center justify-between rounded-md border bg-background px-3 py-2 text-left text-xs transition hover:bg-accent"
            >
              <span className="font-semibold">{d.label}</span>
              <span className="truncate text-muted-foreground">
                {d.email} · {d.password}
              </span>
            </button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}

/* ================================================================== */
/* REGISTER                                                            */
/* ================================================================== */

const ROLE_OPTIONS = [
  {
    value: "DONOR",
    label: "Donor",
    hint: "Give once or monthly — receipts and impact notes included.",
  },
  {
    value: "VOLUNTEER",
    label: "Volunteer",
    hint: "You'll get temporary credentials now; an admin approves your portal access.",
  },
  {
    value: "BENEFICIARY",
    label: "Beneficiary",
    hint: "Request support — a case worker verifies and follows up.",
  },
];

export function RegisterPage() {
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [role, setRole] = useState("DONOR");
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<TempCreds | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (name.trim().length < 3) {
      toast.error("Please enter your full name");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error("Please enter a valid email");
      return;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      toast.error("Please enter a valid 10-digit phone");
      return;
    }
    if (!city.trim()) {
      toast.error("Please enter your city");
      return;
    }
    setBusy(true);
    try {
      const tempCreds = await register({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        city: city.trim(),
        role,
      });
      toast.success("Account created — welcome to United Angel Reach!");
      setCreds(tempCreds);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  const continueByRole = () => {
    setCreds(null);
    navigate(routeByRole(role === "VOLUNTEER" ? "VOLUNTEER" : role));
  };

  const roleHint = ROLE_OPTIONS.find((r) => r.value === role)?.hint;

  return (
    <AuthShell
      title="Create your account"
      subtitle="Join as a donor, volunteer or beneficiary."
      icon={<UserPlus className="size-6" aria-hidden />}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="r-name">Full name</Label>
          <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="r-email">Email</Label>
            <Input id="r-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-phone">Phone</Label>
            <Input id="r-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-city">City</Label>
          <Input id="r-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Bengaluru" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-role">I am joining as</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger id="r-role" className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {roleHint && (
            <p
              className={cn(
                "flex items-start gap-1.5 rounded-md p-2 text-xs leading-relaxed",
                role === "VOLUNTEER"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {role === "VOLUNTEER" && <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
              {roleHint}
            </p>
          )}
        </div>
        <Button type="submit" className="h-11 w-full bg-emerald-600 hover:bg-emerald-700" disabled={busy}>
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : "Create account"}
        </Button>
      </form>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Heart className="size-3.5 text-emerald-600" aria-hidden />
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-emerald-700 hover:underline">
          Sign in
        </Link>
      </p>

      <TempCredsDialog
        creds={creds}
        onClose={() => setCreds(null)}
        onContinue={continueByRole}
      />
    </AuthShell>
  );
}

/* Badge preview kept for profile reuse */
export function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    ADMIN: "bg-emerald-100 text-emerald-700",
    DONOR: "bg-teal-100 text-teal-700",
    VOLUNTEER: "bg-amber-100 text-amber-700",
    BENEFICIARY: "bg-fuchsia-100 text-fuchsia-700",
  };
  return (
    <Badge className={cn("border-0 text-[10px] uppercase hover:opacity-90", map[role] ?? "bg-zinc-100 text-zinc-600")}>
      <ShieldCheck className="mr-1 size-3" aria-hidden />
      {role}
    </Badge>
  );
}
