"use client";

import * as React from "react";
import { useMemo, useState } from "react";
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
import { Progress } from "@/components/ui/progress";
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
  Check,
  Copy,
  Eye,
  EyeOff,
  Heart,
  Info,
  KeyRound,
  Loader2,
  LogIn,
  QrCode,
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
  { label: "Applicant", email: "applicant@demo.org", password: "Temp@12345" },
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

/** 0–4 password strength score. */
function pwScore(pw: string): number {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

const PW_LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];
const PW_COLORS = [
  "bg-red-500",
  "bg-red-500",
  "bg-amber-500",
  "bg-teal-500",
  "bg-emerald-500",
];

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "••••••••"}
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Split-panel shell                                                   */
/* ------------------------------------------------------------------ */

const BRAND_BULLETS = [
  { icon: ShieldCheck, text: "80G receipts in seconds — PAN-ready and archived forever" },
  { icon: QrCode, text: "QR-traced kits: watch your money land at a real doorstep" },
  { icon: Heart, text: "Monthly public reports reconcile money against scans" },
];

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
      <div className="mx-auto grid w-full max-w-4xl overflow-hidden rounded-2xl border shadow-sm lg:grid-cols-[1fr_1.15fr]">
        {/* Brand panel */}
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-700 to-emerald-950 p-8 text-white lg:flex">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-emerald-400/20 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-10 -left-10 size-48 rounded-full bg-teal-400/15 blur-3xl"
          />
          <div className="relative">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
              <ShieldCheck className="size-7" aria-hidden />
            </span>
            <h2 className="mt-6 text-2xl font-extrabold tracking-tight">
              One account.
              <br />
              Every door at UAR.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-emerald-50/85">
              Donors, volunteers, beneficiaries and admins share one sign-in — and one
              proof-first standard.
            </p>
            <ul className="mt-8 space-y-4">
              {BRAND_BULLETS.map((b) => (
                <li key={b.text} className="flex items-start gap-3 text-sm leading-relaxed">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                    <b.icon className="size-4" aria-hidden />
                  </span>
                  {b.text}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative mt-8 text-xs font-semibold uppercase tracking-wider text-emerald-200/80">
            United Angel Reach · Bengaluru → India
          </p>
        </div>

        {/* Form panel */}
        <Card className="rounded-none border-0 p-6 sm:p-8">
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
            <KeyRound className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Your temporary login — shown once
          </DialogTitle>
          <DialogDescription>
            The server issues every new account a secure temporary password. Save these now —
            after signing in you can change it from your Profile.
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
            <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
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
          <PasswordInput
            id="l-password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
        </div>
        <Button
          type="submit"
          className="h-11 w-full bg-emerald-600 hover:bg-emerald-700"
          disabled={busy}
        >
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : "Sign in"}
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          Forgot password?{" "}
          <a
            href="mailto:care@unitedangelreach.org?subject=Password%20reset%20request"
            className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
          >
            Email the care desk
          </a>
        </p>
        <Link href="/register" className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
          Create an account
        </Link>
      </div>

      <Separator className="my-5" />

      <div className="rounded-lg border bg-muted/40 p-4">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <Info className="size-3.5" aria-hidden /> Demo accounts — click to fill
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Demo account quick fill">
          {DEMO_ACCOUNTS.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => {
                setEmail(d.email);
                setPassword(d.password);
              }}
              title={`${d.email} · ${d.password}`}
              className="min-h-[36px] rounded-full border bg-background px-3 py-1.5 text-xs font-semibold transition hover:bg-accent"
            >
              {d.label}
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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState("DONOR");
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<TempCreds | null>(null);

  const score = useMemo(() => pwScore(password), [password]);

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
    if (phone.replace(/\D/g, "").length !== 10) {
      toast.error("Please enter a valid 10-digit phone");
      return;
    }
    if (score < 2 || password.length < 8) {
      toast.error("Choose a password of at least 8 characters with mixed case and a number");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
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
            <Input id="r-phone" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-city">City</Label>
          <Input id="r-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Bengaluru" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="r-password">Password</Label>
            <PasswordInput
              id="r-password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              placeholder="min 8 characters"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-confirm">Confirm password</Label>
            <PasswordInput
              id="r-confirm"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
            />
            {confirm.length > 0 && confirm !== password && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                Passwords don&rsquo;t match yet
              </p>
            )}
          </div>
        </div>

        {/* Strength meter */}
        {password.length > 0 && (
          <div>
            <Progress
              value={(score / 4) * 100}
              className={cn("h-1.5", score === 0 && "opacity-60")}
              aria-label={`Password strength: ${PW_LABELS[score]}`}
            />
            <p
              className={cn(
                "mt-1 text-xs font-semibold",
                score <= 1 ? "text-red-600 dark:text-red-400" : score === 2 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
              )}
            >
              {PW_LABELS[score]}
              <span className="ml-1.5 font-normal text-muted-foreground">
                · mix upper &amp; lower case, a number and a symbol for best strength
              </span>
            </p>
          </div>
        )}

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
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
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
        <Heart className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
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
    ADMIN: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    DONOR: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
    VOLUNTEER: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    BENEFICIARY: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
  };
  return (
    <Badge className={cn("border-0 text-[10px] uppercase hover:opacity-90", map[role] ?? "bg-muted text-muted-foreground")}>
      <ShieldCheck className="mr-1 size-3" aria-hidden />
      {role}
    </Badge>
  );
}

/* Keep tree-shakers honest about the check glyph used in brand bullets */
void Check;
