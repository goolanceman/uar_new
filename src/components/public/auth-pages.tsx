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
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, TextField } from "@/components/shared/form-fields";
import { Section } from "@/components/public/shared";
import { emailRule, phoneRule, minLen, required, fieldError } from "@/lib/validators";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  HandHeart,
  Heart,
  HeartHandshake,
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
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const errs = {
      email: fieldError(email, [emailRule()]),
      password: fieldError(password, [minLen(6, "Password")]),
    };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
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
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField
          label="Email"
          required
          type="email"
          inputMode="email"
          value={email}
          onChange={(v) => {
            setEmail(v);
            if (errors.email) setErrors((e) => ({ ...e, email: null }));
          }}
          error={errors.email}
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          required
          htmlFor="l-password"
          error={errors.password}
        >
          <PasswordInput
            id="l-password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (errors.password) setErrors((e) => ({ ...e, password: null }));
            }}
            autoComplete="current-password"
          />
        </Field>
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
            <span
              key={d.email}
              className="inline-flex items-stretch overflow-hidden rounded-full border bg-background"
            >
              <button
                type="button"
                onClick={() => {
                  setEmail(d.email);
                  setPassword(d.password);
                  setErrors({});
                }}
                title={`${d.email} · ${d.password}`}
                className="min-h-[36px] px-3 py-1.5 text-xs font-semibold transition hover:bg-accent"
              >
                {d.label}
                <span className="ml-1.5 hidden font-normal text-muted-foreground md:inline">
                  {d.email}
                </span>
              </button>
              <button
                type="button"
                onClick={() => copyText(`${d.email} / ${d.password}`)}
                aria-label={`Copy ${d.label} demo credentials (${d.email})`}
                className="flex w-9 min-h-[36px] items-center justify-center border-l text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <Copy className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Passwords: Admin@123 · Donor@123 · Volun@123 · Temp@12345 · Benef@123 — the copy button
          grabs both email and password.
        </p>
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
    short: "Give once or monthly",
    hint: "Give once or monthly — receipts and impact notes included.",
    icon: Heart,
  },
  {
    value: "VOLUNTEER",
    label: "Volunteer",
    short: "Field shifts & drives",
    hint: "You'll get temporary credentials now; an admin approves your portal access.",
    icon: HandHeart,
  },
  {
    value: "BENEFICIARY",
    label: "Beneficiary",
    short: "Request support",
    hint: "Request support — a case worker verifies and follows up.",
    icon: HeartHandshake,
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
  const [errors, setErrors] = useState<{
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    password?: string | null;
    confirm?: string | null;
  }>({});
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<TempCreds | null>(null);

  const score = useMemo(() => pwScore(password), [password]);

  const clearError = (k: "name" | "email" | "phone" | "password" | "confirm") =>
    setErrors((e) => (e[k] ? { ...e, [k]: null } : e));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const errs: NonNullable<typeof errors> = {
      name: fieldError(name, [required("Full name"), minLen(3, "Full name")]),
      email: fieldError(email, [emailRule()]),
      phone: fieldError(phone, [phoneRule()]),
      password:
        fieldError(password, [minLen(6, "Password")]) ??
        (score < 2 || password.length < 8
          ? "Use 8+ characters with mixed case and a number for a stronger password"
          : null),
      confirm: password !== confirm ? "Passwords don't match" : null,
    };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
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
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField
          label="Full name"
          required
          value={name}
          onChange={(v) => {
            setName(v);
            clearError("name");
          }}
          error={errors.name}
          placeholder="Your name"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Email"
            required
            type="email"
            inputMode="email"
            value={email}
            onChange={(v) => {
              setEmail(v);
              clearError("email");
            }}
            error={errors.email}
            placeholder="you@example.com"
          />
          <TextField
            label="Phone"
            required
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(v) => {
              setPhone(v);
              clearError("phone");
            }}
            error={errors.phone}
            hint="10-digit Indian mobile — case teams call this number"
            placeholder="10-digit mobile"
          />
        </div>
        <TextField
          label="City"
          value={city}
          onChange={setCity}
          placeholder="e.g. Bengaluru"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" required htmlFor="r-password" error={errors.password}>
            <PasswordInput
              id="r-password"
              value={password}
              onChange={(v) => {
                setPassword(v);
                clearError("password");
              }}
              autoComplete="new-password"
              placeholder="min 8 characters"
            />
          </Field>
          <Field
            label="Confirm password"
            required
            htmlFor="r-confirm"
            error={
              errors.confirm ??
              (confirm.length > 0 && confirm !== password
                ? "Passwords don't match yet"
                : null)
            }
          >
            <PasswordInput
              id="r-confirm"
              value={confirm}
              onChange={(v) => {
                setConfirm(v);
                clearError("confirm");
              }}
              autoComplete="new-password"
            />
          </Field>
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

        {/* Role picker — cards */}
        <div>
          <p className="mb-1.5 text-xs font-medium">
            I am joining as
            <span className="ml-0.5 text-destructive" aria-hidden>
              *
            </span>
          </p>
          <div
            role="radiogroup"
            aria-label="I am joining as"
            className="grid gap-2.5 sm:grid-cols-3"
          >
            {ROLE_OPTIONS.map((r) => {
              const selected = role === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setRole(r.value)}
                  className={cn(
                    "relative flex min-h-[44px] flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-emerald-500/50 bg-emerald-500/10"
                      : "bg-card hover:bg-accent"
                  )}
                >
                  {selected && (
                    <span
                      aria-hidden
                      className="absolute right-2.5 top-2.5 flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white"
                    >
                      <Check className="size-3" />
                    </span>
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-9 items-center justify-center rounded-lg",
                      selected ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
                    )}
                  >
                    <r.icon className="size-4" />
                  </span>
                  <span className="text-sm font-semibold">{r.label}</span>
                  <span className="text-[11px] leading-snug text-muted-foreground">{r.short}</span>
                </button>
              );
            })}
          </div>
          {roleHint && (
            <p
              className={cn(
                "mt-2 flex items-start gap-1.5 rounded-md p-2 text-xs leading-relaxed",
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

/* Check glyph is used by the register role picker cards (selected state). */
