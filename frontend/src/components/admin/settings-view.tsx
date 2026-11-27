"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Apple,
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  CalendarRange,
  CheckCircle2,
  Coins,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  Image as ImageIcon,
  Info,
  Languages,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  QrCode,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Send,
  ShieldCheck,
  Smartphone,
  ToggleLeft,
  TriangleAlert,
  Webhook,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { get, patch, post } from "@/lib/api-client";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  FLAG_CATALOG,
  SETTING_DEFAULTS,
  SUPPORTED_LANGUAGES,
  isSecretKey,
  keysForSection,
  validateSettingValue,
} from "@/lib/settings-core";
import { downloadCsv } from "@/components/shared/csv";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/* --------------------------------- types ---------------------------------- */

type SettingsMap = Record<string, string>;
type TestChannel = "email" | "sms" | "whatsapp" | "gateway";
type Rec = Record<string, unknown>;

interface TestResult {
  state: "running" | "ok" | "error" | "skipped";
  latencyMs?: number;
  message?: string;
}

/* -------------------------------- defaults -------------------------------- */

/** Canonical defaults (SETTING_DEFAULTS), per-key validation, secret
 *  classification, section→card mapping, the currency catalog and feature-flag
 *  metadata all come from @/lib/settings-core — the single source of truth. */

function normalize(raw: unknown): SettingsMap {
  if (Array.isArray(raw)) {
    const out: SettingsMap = {};
    for (const item of raw as Rec[]) {
      if (item && typeof item.key === "string") out[item.key] = String(item.value ?? "");
    }
    return out;
  }
  if (raw && typeof raw === "object") {
    const out: SettingsMap = {};
    for (const [k, v] of Object.entries(raw as Rec)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    }
    return out;
  }
  return {};
}

/* ------------------------------ secret handling ----------------------------- */

/** Secret classification is shared: isSecretKey() from @/lib/settings-core.
 *  Gateway key IDs (Razorpay/Stripe) are public identifiers there and are
 *  edited as plain fields below. */

/* ------------------------- per-section save mapping ------------------------ */

/** The section→keys mapping (including the "flags" section and the enabled-key
 *  entries) lives in @/lib/settings-core; keysForSection(section, keys) filters
 *  the dirty keys that belong to a card. */

/** Webhook event chips (stored comma-separated in webhooks.events). */
const WEBHOOK_EVENTS = [
  "payment.captured",
  "payment.failed",
  "refund.processed",
  "receipt.issued",
];

const TIMEZONES = [
  { value: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
  { value: "Asia/Dubai", label: "Asia/Dubai" },
  { value: "Asia/Singapore", label: "Asia/Singapore" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "UTC", label: "UTC" },
];

/** Languages come from SUPPORTED_LANGUAGES in @/lib/settings-core (en / hi / kn). */

const FY_MONTH_OPTIONS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April — standard for Indian trusts" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

/** Provider enums mirror validateSettingValue() in @/lib/settings-core. */
const SMS_PROVIDERS = [
  { value: "TWILIO", label: "Twilio" },
  { value: "MSG91", label: "MSG91" },
  { value: "GENERIC", label: "Generic (HTTP endpoint)" },
];

/** Standard trustee-board designations for the receipts/certificates signatory. */
const SIGNATORY_LEVELS = [
  "Managing Trustee",
  "Trustee",
  "Chairperson",
  "Secretary",
  "Treasurer",
  "President",
];

/** Per-tab summaries for the "Settings guide" dialog. */
const GUIDE_TABS: { title: string; bullets: string[] }[] = [
  {
    title: "Organisation",
    bullets: [
      "Trust identity, registration numbers (PAN, 80G, 12A, Darpan) and branding shown site-wide.",
      "Fiscal-year start month drives FY labels on reports, dashboards and receipts.",
    ],
  },
  {
    title: "Feature flags",
    bullets: [
      "Public-site switches: gateway, notifications, donate-page options, assistant, maintenance banner.",
      "Saved with the card's own Save button; effective immediately — no restart.",
    ],
  },
  {
    title: "Payments & Finance",
    bullets: [
      "UPI ID, gateway credentials, receipt prefix, GSTIN and the currency donations are stored in.",
      "Test mode keeps payments on sandbox keys; switch it off only with live keys saved.",
    ],
  },
  {
    title: "Email (SMTP)",
    bullets: [
      "Credentials for all outbound mail — receipts, invitations and notifications.",
      "Test connection opens a real TCP check to the host without sending mail.",
    ],
  },
  {
    title: "SMS & WhatsApp",
    bullets: [
      "Provider selection and credentials for donor and volunteer alerts.",
      "WhatsApp Cloud API needs a phone number ID + token; Twilio reuses the SMS credentials.",
    ],
  },
  {
    title: "Integrations",
    bullets: [
      "Storage, webhooks, analytics, captcha, maps and kit-QR settings.",
      "Maintenance mode here shows a dismissible notice on public pages.",
    ],
  },
  {
    title: "Logs & Audit",
    bullets: [
      "Verbosity, retention and which actions get recorded in the activity trail.",
      "Export the trail as CSV for reviews and compliance.",
    ],
  },
  {
    title: "Language & Region",
    bullets: ["Default public language and the timezone used for reports and schedules."],
  },
  {
    title: "Receipts & Certificates",
    bullets: ["Signatory block, numbering prefix and footer printed on 80G receipts."],
  },
  {
    title: "AI Assistant",
    bullets: ["Angel widget availability across the site and its underlying model."],
  },
  {
    title: "Recurring Matching",
    bullets: ["Auto-match engine that pairs monthly donors with recurring beneficiary needs."],
  },
  {
    title: "Mobile app",
    bullets: [
      "Every setting the Flutter app reads from GET /api/settings/app: content limits, feed ordering, audio spaces, maintenance mode, force-update links, AdMob and SightEngine credentials.",
      "Saving a card pushes the change to the app on its next settings load — no app release needed.",
    ],
  },
];

const GATEWAY_PROVIDERS = [
  { value: "RAZORPAY", label: "Razorpay" },
  { value: "CASHFREE", label: "Cashfree" },
  { value: "PAYU", label: "PayU" },
  { value: "STRIPE", label: "Stripe" },
];

const STORAGE_PROVIDERS = [
  { value: "S3", label: "S3 — Amazon S3" },
  { value: "GCS", label: "GCS — Google Cloud Storage" },
  { value: "AZURE", label: "Azure — Blob Storage" },
  { value: "LOCAL", label: "Local disk" },
];

const CAPTCHA_PROVIDERS = [
  { value: "NONE", label: "None" },
  { value: "RECAPTCHA", label: "reCAPTCHA" },
  { value: "HCAPTCHA", label: "hCaptcha" },
  { value: "TURNSTILE", label: "Cloudflare Turnstile" },
];

const MAP_PROVIDERS = [
  { value: "GOOGLE", label: "Google Maps" },
  { value: "OSM", label: "OpenStreetMap" },
  { value: "MAPBOX", label: "Mapbox" },
];

/* ------------------------------ small helpers ------------------------------ */

function pickStr(o: Rec | null | undefined, keys: string[], fb = ""): string {
  if (!o) return fb;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v) return v;
  }
  return fb;
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      {id ? <Label htmlFor={id}>{label}</Label> : <Label>{label}</Label>}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

/** Compact "how to use" note for integration cards — a short numbered guide. */
function Guide({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-xs">
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-foreground">
        <Info className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {title}
      </p>
      <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

/** Presence pill for credential-style settings ("configured" vs "not set"). */
function PresenceBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1",
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-muted text-muted-foreground"
      )}
    >
      {ok ? <CheckCircle2 className="size-3" aria-hidden="true" /> : <XCircle className="size-3" aria-hidden="true" />}
      {label} {ok ? "configured" : "not set"}
    </Badge>
  );
}

/**
 * Password-style field for secret settings. Shows a masked input with a
 * "configured" tick when a value is already saved; the input itself stays
 * empty until the admin types a replacement (PATCH only sends typed values).
 */
function SecretField({
  id,
  label,
  hint,
  configured,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  configured: boolean;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field
      id={id}
      label={label}
      hint={configured ? "•••• saved — leave blank to keep the saved value." : hint}
    >
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={configured ? "••••••••" : placeholder ?? "Not set"}
            className="pr-9 font-mono"
            autoComplete="new-password"
            aria-label={`${label}${configured ? " (configured)" : ""}`}
          />
          {configured && (
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 dark:text-emerald-400"
              title="Configured"
              aria-hidden="true"
            >
              <CheckCircle2 className="size-4" />
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? `Hide ${label}` : `Show ${label}`}
        >
          {show ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </Button>
      </div>
    </Field>
  );
}

function TestChip({ result }: { result: TestResult | undefined }) {
  if (!result) return null;
  if (result.state === "running") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Testing…
      </Badge>
    );
  }
  if (result.state === "ok") {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-3" aria-hidden="true" />
        OK · {result.latencyMs ?? 0}ms
      </Badge>
    );
  }
  if (result.state === "skipped") {
    return (
      <Badge
        variant="outline"
        className="gap-1 bg-muted text-muted-foreground"
        title={result.message ?? "Not configured"}
      >
        <Info className="size-3" aria-hidden="true" /> Not configured
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400">
      <XCircle className="size-3" aria-hidden="true" /> Failed
    </Badge>
  );
}

/* ---------------------------------- view ----------------------------------- */

export default function SettingsView() {
  const [saved, setSaved] = useState<SettingsMap>({ ...SETTING_DEFAULTS });
  const [values, setValues] = useState<SettingsMap>({ ...SETTING_DEFAULTS });
  const [secretEdits, setSecretEdits] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [exportingLogs, setExportingLogs] = useState(false);
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await get<unknown>("/api/settings");
      const merged = { ...SETTING_DEFAULTS, ...normalize(raw) };
      setSaved(merged);
      setValues(merged);
      setSecretEdits({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const setSecret = (key: string, value: string) =>
    setSecretEdits((prev) => ({ ...prev, [key]: value }));

  const bool = (key: string) => (values[key] ?? "false") === "true";

  const configured = useCallback(
    (key: string) => (saved[key] ?? "").trim().length > 0,
    [saved]
  );

  /* dirty tracking — only changed keys are patched; secrets only when typed */
  const dirtyMap = useMemo(() => {
    const keys = new Set([...Object.keys(saved), ...Object.keys(values)]);
    const out: SettingsMap = {};
    for (const k of keys) {
      if (isSecretKey(k)) {
        const typed = secretEdits[k] ?? "";
        if (typed.length > 0 && typed !== (saved[k] ?? "")) out[k] = typed;
      } else if ((values[k] ?? "") !== (saved[k] ?? "")) {
        out[k] = values[k] ?? "";
      }
    }
    return out;
  }, [saved, values, secretEdits]);

  const dirtyCount = Object.keys(dirtyMap).length;

  const dirtyInSection = useCallback(
    (section: string) => keysForSection(section, Object.keys(dirtyMap)).length,
    [dirtyMap]
  );

  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCount]);

  const validate = (): string | null => {
    // Per-key pattern/enum/range rules live in the shared validator
    // (validateSettingValue in @/lib/settings-core) — one implementation for
    // client and server.
    for (const key of Object.keys(dirtyMap)) {
      const problem = validateSettingValue(key, dirtyMap[key] ?? "");
      if (problem) return problem;
    }
    // Cross-field rule kept local: the webhook event list is edited via chips
    // and stored as a comma-separated set of event names.
    const events = (values["webhooks.events"] ?? "").trim();
    if (events) {
      const parts = events
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 0 || parts.some((s) => !/^[a-z]+(\.[a-z_-]+)+$/.test(s)))
        return "Webhook events must be comma-separated event names (e.g. payment.captured).";
    }
    return null;
  };

  /** Merge a fresh settings payload into state after any successful save. */
  const applySaved = (raw: unknown, keys: string[]) => {
    const merged = { ...SETTING_DEFAULTS, ...normalize(raw) };
    setSaved(merged);
    setValues(merged);
    setSecretEdits((prev) => {
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    if (dirtyCount === 0) {
      toast.info("No changes to save");
      return;
    }
    setSaving(true);
    try {
      const raw = await patch<unknown>("/api/settings", dirtyMap);
      applySaved(raw, Object.keys(dirtyMap));
      toast.success(`Saved ${dirtyCount} setting${dirtyCount === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const saveSection = async (section: string) => {
    const keys = keysForSection(section, Object.keys(dirtyMap));
    if (keys.length === 0) return;
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    const payload: SettingsMap = {};
    for (const k of keys) payload[k] = dirtyMap[k];
    setSavingSection(section);
    try {
      const raw = await patch<unknown>("/api/settings", payload);
      applySaved(raw, keys);
      toast.success(`Saved ${keys.length} setting${keys.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSavingSection(null);
    }
  };

  const reset = () => {
    setValues(saved);
    setSecretEdits({});
    toast.info("Changes reverted");
  };

  /** Per-card save button — only rendered when that card has unsaved keys.
   *  Plain render-function (not a component) so the button never remounts. */
  const renderSectionSave = (section: string, label: string) => {
    const dirty = dirtyInSection(section);
    if (dirty === 0) return null;
    const isSaving = savingSection === section;
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => saveSection(section)}
        disabled={isSaving}
        aria-label={`Save ${label} settings`}
      >
        {isSaving ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="size-4" aria-hidden="true" />
        )}
        Save{dirty > 1 ? ` (${dirty})` : ""}
      </Button>
    );
  };

  const runTest = async (channel: TestChannel) => {
    setTests((prev) => ({ ...prev, [channel]: { state: "running" } }));
    try {
      const res = await post<{
        ok?: boolean;
        latencyMs?: number;
        message?: string;
        skipped?: boolean;
      }>("/api/settings/test", { channel });
      const result: TestResult = {
        state: res?.ok === false ? (res?.skipped ? "skipped" : "error") : "ok",
        latencyMs: res?.latencyMs,
        message: res?.message,
      };
      setTests((prev) => ({ ...prev, [channel]: result }));
      if (result.state === "ok") {
        toast.success(`${channel.toUpperCase()} test OK · ${res?.latencyMs ?? 0}ms`, {
          description: res?.message,
        });
      } else if (result.state === "skipped") {
        toast.info(`${channel.toUpperCase()} not configured`, { description: res?.message });
      } else {
        toast.error(`${channel.toUpperCase()} test failed`, { description: res?.message });
      }
    } catch (e) {
      const result: TestResult = {
        state: "error",
        message: e instanceof Error ? e.message : "Test failed",
      };
      setTests((prev) => ({ ...prev, [channel]: result }));
      toast.error(e instanceof Error ? e.message : `${channel.toUpperCase()} test failed`);
    }
  };

  /** Export the audit trail as CSV (respects the admin activity-logs API). */
  const exportLogs = async () => {
    setExportingLogs(true);
    try {
      const rows = await get<unknown>("/api/activity-logs?limit=2000");
      const list = Array.isArray(rows) ? (rows as Rec[]) : [];
      downloadCsv(`uar-activity-logs-${new Date().toISOString().slice(0, 10)}`, [
        { header: "ID", value: (r) => pickStr(r, ["id"]) },
        { header: "Timestamp", value: (r) => formatDateTime(pickStr(r, ["createdAt"])) },
        { header: "Actor", value: (r) => pickStr(r, ["actorName"]) },
        { header: "Action", value: (r) => pickStr(r, ["action"]) },
        { header: "Entity", value: (r) => pickStr(r, ["entityType"]) },
        { header: "Entity ID", value: (r) => pickStr(r, ["entityId"]) },
        { header: "Details", value: (r) => pickStr(r, ["details"]) },
      ], list);
      toast.success(`Exported ${list.length} log ${list.length === 1 ? "entry" : "entries"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export logs");
    } finally {
      setExportingLogs(false);
    }
  };

  /* webhook event chips state derived from the comma-separated value */
  const selectedEvents = useMemo(
    () =>
      (values["webhooks.events"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    [values]
  );

  const toggleEvent = (ev: string) => {
    const next = selectedEvents.includes(ev)
      ? selectedEvents.filter((x) => x !== ev)
      : [...selectedEvents, ev];
    set("webhooks.events", next.join(","));
  };

  /* test-button readiness guards — tests disable gracefully when unconfigured */
  const emailHostSet = (values["notify.email.host"] ?? "").trim().length > 0;
  const smsProvider = (values["notify.sms.provider"] || "TWILIO").trim();
  const smsAccountSet = (values["notify.sms.accountId"] ?? "").trim().length > 0;
  const smsEndpointSet = (values["notify.sms.endpoint"] ?? "").trim().length > 0;
  const smsKeySet =
    configured("notify.sms.apiKey") ||
    (secretEdits["notify.sms.apiKey"] ?? "").trim().length > 0;
  const smsReady =
    smsProvider === "TWILIO" ? smsAccountSet && smsKeySet : smsEndpointSet && smsKeySet;
  const waProvider = (values["notify.whatsapp.provider"] || "CLOUD").trim();
  const waPhoneIdSet = (values["notify.whatsapp.phoneId"] ?? "").trim().length > 0;
  const waKeySet =
    configured("notify.whatsapp.apiKey") ||
    (secretEdits["notify.whatsapp.apiKey"] ?? "").trim().length > 0;
  const whatsappReady =
    waProvider === "CLOUD" ? waPhoneIdSet && waKeySet : smsAccountSet && smsKeySet;
  const gatewayKeysSet = (values["finance.razorpayKeyId"] ?? "").trim().length > 0;

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-10 w-full max-w-md rounded-full" />
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Organisation identity, payments, notifications, integrations, audit and regional preferences."
        icon={<Building2 className="size-5" aria-hidden="true" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" aria-label="Open settings guide">
                  <BookOpen className="size-4" aria-hidden="true" /> Settings guide
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Settings guide</DialogTitle>
                  <DialogDescription>What lives on each tab and what it affects.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 text-sm">
                  {GUIDE_TABS.map((t) => (
                    <div key={t.title}>
                      <p className="font-semibold text-foreground">{t.title}</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                        {t.bullets.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="outline" onClick={load} aria-label="Reload settings">
              <RefreshCw className="size-4" aria-hidden="true" /> Reload
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="org">
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="org">Organisation</TabsTrigger>
          <TabsTrigger value="flags" className="gap-1.5">
            <ToggleLeft className="size-4" aria-hidden="true" /> Feature flags
          </TabsTrigger>
          <TabsTrigger value="finance">Payments &amp; Finance</TabsTrigger>
          <TabsTrigger value="email">Email (SMTP)</TabsTrigger>
          <TabsTrigger value="sms">SMS &amp; WhatsApp</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="logs">Logs &amp; Audit</TabsTrigger>
          <TabsTrigger value="region">Language &amp; Region</TabsTrigger>
          <TabsTrigger value="receipts">Receipts &amp; Certificates</TabsTrigger>
          <TabsTrigger value="assistant">AI Assistant</TabsTrigger>
          <TabsTrigger value="matching">Recurring Matching</TabsTrigger>
          <TabsTrigger value="food">Food Security</TabsTrigger>
          <TabsTrigger value="mobile" className="gap-1.5">
            <Smartphone className="size-4" aria-hidden="true" /> Mobile app
          </TabsTrigger>
        </TabsList>

        {/* ============================ ORGANISATION ============================ */}
        <TabsContent value="org" className="mt-4">
          <SectionCard
            title="Organisation profile"
            description="Public identity of the trust shown across the site, receipts and certificates."
            icon={<Building2 className="size-4" aria-hidden="true" />}
            actions={renderSectionSave("org", "organisation")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="s-org-name" label="Organisation name">
                <Input
                  id="s-org-name"
                  value={values["org.name"] ?? ""}
                  onChange={(e) => set("org.name", e.target.value)}
                  placeholder="United Angel Reach"
                />
              </Field>
              <Field id="s-org-hq" label="Headquarters" hint="City / state shown in the site footer.">
                <Input
                  id="s-org-hq"
                  value={values["org.hq"] ?? ""}
                  onChange={(e) => set("org.hq", e.target.value)}
                  placeholder="Bengaluru, Karnataka"
                />
              </Field>
              <Field id="s-org-email" label="Contact email">
                <Input
                  id="s-org-email"
                  type="email"
                  value={values["org.email"] ?? ""}
                  onChange={(e) => set("org.email", e.target.value)}
                  placeholder="contact@unitedangelreach.org"
                />
              </Field>
              <Field id="s-org-phone" label="Contact phone">
                <Input
                  id="s-org-phone"
                  type="tel"
                  value={values["org.phone"] ?? ""}
                  onChange={(e) => set("org.phone", e.target.value)}
                  placeholder="+91 80 4000 0000"
                />
              </Field>
              <Field id="s-org-address" label="Registered address">
                <Textarea
                  id="s-org-address"
                  rows={2}
                  value={values["org.address"] ?? ""}
                  onChange={(e) => set("org.address", e.target.value)}
                  placeholder="Full registered office address"
                />
              </Field>
              <Field id="s-org-vision" label="Vision statement" hint="Shown on the public About / Home pages.">
                <Textarea
                  id="s-org-vision"
                  rows={2}
                  value={values["org.vision"] ?? ""}
                  onChange={(e) => set("org.vision", e.target.value)}
                />
              </Field>
              <Field
                id="s-org-fy"
                label="Fiscal year start"
                hint="Used for FY labels, reports and dashboards. Indian trusts run April → March."
              >
                <Select
                  value={values["finance.fyStartMonth"] || "4"}
                  onValueChange={(v) => set("finance.fyStartMonth", v)}
                >
                  <SelectTrigger id="s-org-fy" aria-label="Fiscal year start month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FY_MONTH_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="s-org-website" label="Website">
                <Input
                  id="s-org-website"
                  value={values["org.website"] ?? ""}
                  onChange={(e) => set("org.website", e.target.value)}
                  placeholder="https://unitedangelreach.org"
                />
              </Field>
              <Field id="s-org-pan" label="PAN" hint="Trust PAN printed on 80G receipts.">
                <Input
                  id="s-org-pan"
                  value={values["org.pan"] ?? ""}
                  onChange={(e) => set("org.pan", e.target.value.toUpperCase())}
                  placeholder="AABCU9603R1"
                  className="font-mono"
                />
              </Field>
              <Field id="s-org-80g" label="80G registration number" hint="Enables tax-deductible receipts.">
                <Input
                  id="s-org-80g"
                  value={values["org.80g"] ?? ""}
                  onChange={(e) => set("org.80g", e.target.value)}
                  placeholder="80G cert. no."
                />
              </Field>
              <Field id="s-org-12a" label="12A registration number">
                <Input
                  id="s-org-12a"
                  value={values["org.reg12a"] ?? ""}
                  onChange={(e) => set("org.reg12a", e.target.value)}
                  placeholder="12A registration no."
                />
              </Field>
              <Field id="s-org-darpan" label="NGO Darpan ID" hint="NITI Aayog unique ID (e.g. KA/2020/0123456).">
                <Input
                  id="s-org-darpan"
                  value={values["org.darpan"] ?? ""}
                  onChange={(e) => set("org.darpan", e.target.value)}
                  placeholder="KA/2020/0123456"
                />
              </Field>
            </div>
            <p className="mt-4 flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
              <CalendarRange className="size-4 shrink-0" aria-hidden="true" />
              The fiscal year label (e.g. “FY 2025-26”) appears on the dashboard, reports and receipts
              and follows the start month chosen above.
            </p>
          </SectionCard>

          <SectionCard
            title="Branding"
            description="Logo and favicon shown across the header, sidebar and browser tab."
            icon={<ImageIcon className="size-4" aria-hidden="true" />}
            actions={renderSectionSave("org", "branding")}
            className="mt-4"
          >
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field id="s-brand-logo" label="Logo URL" hint="SVG or PNG, served from /public or an external HTTPS URL.">
                <Input
                  id="s-brand-logo"
                  value={values["brand.logoUrl"] ?? ""}
                  onChange={(e) => set("brand.logoUrl", e.target.value)}
                  placeholder="/brand/logo.svg"
                />
              </Field>
              <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted/40">
                {values["brand.logoUrl"] ? (
                  <img
                    src={values["brand.logoUrl"]}
                    alt="Logo preview"
                    className="size-12 object-contain"
                  />
                ) : (
                  <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
                )}
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field id="s-brand-favicon" label="Favicon URL" hint="Square SVG or PNG shown in the browser tab.">
                <Input
                  id="s-brand-favicon"
                  value={values["brand.faviconUrl"] ?? ""}
                  onChange={(e) => set("brand.faviconUrl", e.target.value)}
                  placeholder="/brand/logo.svg"
                />
              </Field>
              <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted/40">
                {values["brand.faviconUrl"] ? (
                  <img
                    src={values["brand.faviconUrl"]}
                    alt="Favicon preview"
                    className="size-10 object-contain"
                  />
                ) : (
                  <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
                )}
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ========================== FEATURE FLAGS ============================= */}
        <TabsContent value="flags" className="mt-4">
          <SectionCard
            title="Feature flags"
            description="Public-site switches — donate-page options, notifications, assistant and the maintenance banner."
            icon={<ToggleLeft className="size-4" aria-hidden="true" />}
            actions={renderSectionSave("flags", "feature flags")}
          >
            <div className="grid gap-4">
              <div
                role="note"
                className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
              >
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  Flags are saved with the <strong className="text-foreground">Save</strong> button
                  on this card. They take effect immediately after saving — no restart needed.
                </span>
              </div>
              <div className="grid gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <SwitchRow
                  id="s-flag-app-testingMode"
                  label="Testing mode"
                  hint="Serves the seeded demo-account credentials to the web and mobile login screens."
                  checked={bool("app.testingMode")}
                  onCheckedChange={(v) => set("app.testingMode", v ? "true" : "false")}
                />
                <p
                  role="note"
                  className="flex items-start gap-2 px-1 pt-1 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    Warning: while testing mode is ON, the demo emails and passwords are visible
                    to <strong>everyone</strong> on the login screens of the website and the mobile
                    app. Keep it OFF in production and only turn it on for demos, training and
                    staging environments.
                  </span>
                </p>
              </div>
              {FLAG_CATALOG.map((flag) => (
                <div key={flag.key} className="grid gap-1">
                  <SwitchRow
                    id={`s-flag-${flag.key}`}
                    label={flag.label}
                    hint={flag.description}
                    checked={bool(flag.key)}
                    onCheckedChange={(v) => set(flag.key, v ? "true" : "false")}
                  />
                  <p className="px-1 text-xs text-muted-foreground">Takes effect: {flag.effect}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ========================= PAYMENTS & FINANCE ========================= */}
        <TabsContent value="finance" className="mt-4">
          <SectionCard
            title="Payments &amp; finance"
            description="UPI collections, gateway credentials, receipt prefix and currency preferences."
            icon={<Coins className="size-4" aria-hidden="true" />}
            actions={renderSectionSave("payments", "payments")}
          >
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2" aria-label="Gateway credential status">
                <PresenceBadge label="Gateway key ID" ok={configured("finance.razorpayKeyId")} />
                <PresenceBadge label="Stripe key ID" ok={configured("finance.stripeKeyId")} />
                <PresenceBadge label="Key secret" ok={configured("finance.gatewayKeySecret")} />
                <PresenceBadge label="Webhook secret" ok={configured("finance.gatewayWebhookSecret")} />
                <Badge
                  variant="outline"
                  className={cn(
                    bool("finance.gatewayTestMode")
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  )}
                >
                  Mode: {bool("finance.gatewayTestMode") ? "test" : "live"}
                </Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="s-fin-upi"
                  label="UPI ID"
                  hint="Format: name@bank — e.g. unitedangelreach@okhdfcbank. Shown on donate pages."
                >
                  <Input
                    id="s-fin-upi"
                    value={values["finance.upiId"] ?? ""}
                    onChange={(e) => set("finance.upiId", e.target.value)}
                    placeholder="unitedangelreach@okhdfcbank"
                    className="font-mono"
                  />
                </Field>
                <Field
                  id="s-fin-currency"
                  label="Currency"
                  hint="Donations store amounts in this currency; donors can switch (see Feature flags)."
                >
                  <Select
                    value={values["finance.currency"] || DEFAULT_CURRENCY}
                    onValueChange={(v) => set("finance.currency", v)}
                  >
                    <SelectTrigger id="s-fin-currency" aria-label="Currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="s-fin-prefix" label="Receipt prefix" hint="Receipt numbers are generated as {prefix}-{year}-{00001}.">
                  <Input
                    id="s-fin-prefix"
                    value={values["receipts.prefix"] ?? ""}
                    onChange={(e) => set("receipts.prefix", e.target.value.toUpperCase())}
                    placeholder="UAR-RCPT"
                    className="font-mono"
                  />
                </Field>
                <Field id="s-fin-gst" label="GSTIN" hint="Optional — printed on invoices only if provided.">
                  <Input
                    id="s-fin-gst"
                    value={values["payments.gst"] ?? ""}
                    onChange={(e) => set("payments.gst", e.target.value.toUpperCase())}
                    placeholder="29AABCU9603R1Z…"
                    className="font-mono"
                  />
                </Field>
                <Field id="s-fin-provider" label="Gateway provider">
                  <Select
                    value={values["finance.gatewayProvider"] || "RAZORPAY"}
                    onValueChange={(v) => set("finance.gatewayProvider", v)}
                  >
                    <SelectTrigger id="s-fin-provider" aria-label="Gateway provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GATEWAY_PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  id="s-fin-rzp"
                  label="Razorpay key ID"
                  hint="Public identifier from the Razorpay dashboard (Dashboard → Settings → API keys)."
                >
                  <Input
                    id="s-fin-rzp"
                    value={values["finance.razorpayKeyId"] ?? ""}
                    onChange={(e) => set("finance.razorpayKeyId", e.target.value)}
                    placeholder="rzp_live_xxxxxxxx"
                    className="font-mono"
                    autoComplete="off"
                  />
                </Field>
                <Field
                  id="s-fin-stripe"
                  label="Stripe key ID"
                  hint="Publishable key (pk_live_…) used when the Stripe gateway is selected."
                >
                  <Input
                    id="s-fin-stripe"
                    value={values["finance.stripeKeyId"] ?? ""}
                    onChange={(e) => set("finance.stripeKeyId", e.target.value)}
                    placeholder="pk_live_xxxxxxxx"
                    className="font-mono"
                    autoComplete="off"
                  />
                </Field>
                <SecretField
                  id="s-fin-keysecret"
                  label="Gateway key secret"
                  hint="Never displayed after saving; used server-side only."
                  configured={configured("finance.gatewayKeySecret")}
                  placeholder="Paste key secret"
                  value={secretEdits["finance.gatewayKeySecret"] ?? ""}
                  onChange={(v) => setSecret("finance.gatewayKeySecret", v)}
                />
                <SecretField
                  id="s-fin-webhooksecret"
                  label="Gateway webhook secret"
                  hint="Verifies gateway → UAR webhook signatures."
                  configured={configured("finance.gatewayWebhookSecret")}
                  placeholder="Paste webhook secret"
                  value={secretEdits["finance.gatewayWebhookSecret"] ?? ""}
                  onChange={(v) => setSecret("finance.gatewayWebhookSecret", v)}
                />
              </div>
              <SwitchRow
                id="s-fin-gateway"
                label="Enable payment gateway"
                hint="Turn off to collect only via UPI / bank transfer."
                checked={bool("finance.gatewayEnabled")}
                onCheckedChange={(v) => set("finance.gatewayEnabled", v ? "true" : "false")}
              />
              <SwitchRow
                id="s-fin-testmode"
                label="Gateway mode: test / live"
                hint="ON = test (sandbox keys while wiring up). Turn OFF before going live."
                checked={bool("finance.gatewayTestMode")}
                onCheckedChange={(v) => set("finance.gatewayTestMode", v ? "true" : "false")}
              />
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  onClick={() => runTest("gateway")}
                  disabled={!gatewayKeysSet}
                  aria-label="Test payment gateway configuration"
                >
                  <Send className="size-4" aria-hidden="true" /> Test gateway
                </Button>
                <TestChip result={tests.gateway} />
                <p className="text-xs text-muted-foreground">
                  {gatewayKeysSet
                    ? "Checks the saved gateway credentials are present — no order or payment is created."
                    : "Save a gateway key ID first to enable this check."}
                </p>
              </div>
              <Guide
                title="How to use"
                steps={[
                  "Create a Razorpay (Dashboard → Settings → API keys) or Stripe (Developers → API keys) account and copy the key ID and key secret.",
                  "Test mode runs on sandbox keys — no real money moves. Turn the mode toggle off and swap in live keys before launch.",
                  "The webhook secret verifies that payment notifications genuinely come from the gateway; paste the same value you set in the gateway dashboard.",
                  "Secrets are masked once saved — type a value again only to replace it.",
                ]}
              />
            </div>
          </SectionCard>
        </TabsContent>

        {/* ============================ EMAIL (SMTP) ============================ */}
        <TabsContent value="email" className="mt-4">
          <SectionCard
            title="Email (SMTP)"
            description="Outbound transactional email — receipts, welcome and notification mail."
            icon={<Mail className="size-4" aria-hidden="true" />}
            actions={
              <>
                <TestChip result={tests.email} />
                {renderSectionSave("email", "email")}
              </>
            }
          >
            <div className="grid gap-4">
              <SwitchRow
                id="s-mail-enabled"
                label="Enable email notifications"
                checked={bool("notify.email.enabled")}
                onCheckedChange={(v) => set("notify.email.enabled", v ? "true" : "false")}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-mail-host" label="SMTP host">
                  <Input
                    id="s-mail-host"
                    value={values["notify.email.host"] ?? ""}
                    onChange={(e) => set("notify.email.host", e.target.value)}
                    placeholder="smtp.zoho.in"
                  />
                </Field>
                <Field id="s-mail-port" label="SMTP port" hint="587 for STARTTLS, 465 for implicit TLS.">
                  <Input
                    id="s-mail-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={values["notify.email.port"] ?? ""}
                    onChange={(e) => set("notify.email.port", e.target.value)}
                    placeholder="587"
                  />
                </Field>
                <Field id="s-mail-from" label="From address">
                  <Input
                    id="s-mail-from"
                    type="email"
                    value={values["notify.email.from"] ?? ""}
                    onChange={(e) => set("notify.email.from", e.target.value)}
                    placeholder="receipts@unitedangelreach.org"
                  />
                </Field>
                <Field id="s-mail-fromname" label="From name">
                  <Input
                    id="s-mail-fromname"
                    value={values["notify.email.fromName"] ?? ""}
                    onChange={(e) => set("notify.email.fromName", e.target.value)}
                    placeholder="United Angel Reach"
                  />
                </Field>
                <Field id="s-mail-username" label="SMTP username" hint="Usually the from address or an API username.">
                  <Input
                    id="s-mail-username"
                    value={values["notify.email.username"] ?? ""}
                    onChange={(e) => set("notify.email.username", e.target.value)}
                    placeholder="receipts@unitedangelreach.org"
                    className="font-mono"
                    autoComplete="off"
                  />
                </Field>
                <SecretField
                  id="s-mail-password"
                  label="SMTP password"
                  configured={configured("notify.email.password")}
                  placeholder="Paste SMTP password"
                  value={secretEdits["notify.email.password"] ?? ""}
                  onChange={(v) => setSecret("notify.email.password", v)}
                />
                <Field id="s-mail-replyto" label="Reply-to address" hint="Replies to receipts go here (optional).">
                  <Input
                    id="s-mail-replyto"
                    type="email"
                    value={values["notify.email.replyTo"] ?? ""}
                    onChange={(e) => set("notify.email.replyTo", e.target.value)}
                    placeholder="care@unitedangelreach.org"
                  />
                </Field>
              </div>
              <SwitchRow
                id="s-mail-secure"
                label="Use secure TLS connection"
                hint="Enable for port 465; leave off for STARTTLS on 587."
                checked={bool("notify.email.secure")}
                onCheckedChange={(v) => set("notify.email.secure", v ? "true" : "false")}
              />
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  onClick={() => runTest("email")}
                  disabled={!emailHostSet}
                  aria-label="Test SMTP connection"
                >
                  <Send className="size-4" aria-hidden="true" /> Test connection
                </Button>
                <TestChip result={tests.email} />
                <p className="text-xs text-muted-foreground">
                  {emailHostSet
                    ? "Opens a real TCP connection to the saved host:port (3s timeout) — no mail is sent."
                    : "Save an SMTP host first to enable this check."}
                </p>
              </div>
              <Guide
                title="How to use"
                steps={[
                  "Use the mailbox's own SMTP credentials; for Gmail enable 2-Step Verification and create an App Password (regular passwords are rejected).",
                  "Port 587 (STARTTLS) is the common default; port 465 needs the secure-TLS toggle below.",
                  "Use the Test connection button to verify the credentials before enabling notifications.",
                ]}
              />
              <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                <strong className="text-foreground">Invitation templates:</strong> volunteer onboarding
                and donor welcome invitations reuse this SMTP configuration and the organisation
                identity above. Template copy is managed in code; only credentials and sender details
                are configurable here.
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        {/* =========================== SMS & WHATSAPP =========================== */}
        <TabsContent value="sms" className="mt-4">
          <div className="grid gap-4">
            <SectionCard
              title="SMS"
              description="Alerts for missions, kit scans and donor acknowledgements."
              icon={<MessageSquare className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("sms", "SMS")}
            >
              <div className="grid gap-4">
                <SwitchRow
                  id="s-sms-enabled"
                  label="Enable SMS notifications"
                  checked={bool("notify.sms.enabled")}
                  onCheckedChange={(v) => set("notify.sms.enabled", v ? "true" : "false")}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="s-sms-provider" label="Provider">
                    <Select
                      value={values["notify.sms.provider"] || "TWILIO"}
                      onValueChange={(v) => set("notify.sms.provider", v)}
                    >
                      <SelectTrigger id="s-sms-provider" aria-label="SMS provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SMS_PROVIDERS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {smsProvider === "TWILIO" && (
                    <Field id="s-sms-account" label="Twilio Account SID" hint="From the Twilio console (starts with AC…).">
                      <Input
                        id="s-sms-account"
                        value={values["notify.sms.accountId"] ?? ""}
                        onChange={(e) => set("notify.sms.accountId", e.target.value)}
                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="font-mono"
                        autoComplete="off"
                      />
                    </Field>
                  )}
                  <Field id="s-sms-sender" label="Sender ID" hint="6-character DLT-registered header (India).">
                    <Input
                      id="s-sms-sender"
                      maxLength={6}
                      value={values["notify.sms.senderId"] ?? ""}
                      onChange={(e) => set("notify.sms.senderId", e.target.value.toUpperCase())}
                      placeholder="UARTRU"
                      className="font-mono"
                    />
                  </Field>
                  <Field id="s-sms-endpoint" label="MSG91/Generic endpoint" hint="Provider REST base URL (MSG91 or generic HTTP gateways).">
                    <Input
                      id="s-sms-endpoint"
                      value={values["notify.sms.endpoint"] ?? ""}
                      onChange={(e) => set("notify.sms.endpoint", e.target.value)}
                      placeholder="https://api.provider.com/v1/send"
                    />
                  </Field>
                  <SecretField
                    id="s-sms-apikey"
                    label="SMS API key"
                    configured={configured("notify.sms.apiKey")}
                    placeholder="Paste provider API key"
                    value={secretEdits["notify.sms.apiKey"] ?? ""}
                    onChange={(v) => setSecret("notify.sms.apiKey", v)}
                  />
                  <Field id="s-sms-template" label="DLT template ID" hint="Registered DLT template for transactional SMS (India).">
                    <Input
                      id="s-sms-template"
                      value={values["notify.sms.templateId"] ?? ""}
                      onChange={(e) => set("notify.sms.templateId", e.target.value)}
                      placeholder="e.g. 1207161512345678901"
                      className="font-mono"
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    onClick={() => runTest("sms")}
                    disabled={!smsReady}
                    aria-label="Test SMS configuration"
                  >
                    <Send className="size-4" aria-hidden="true" /> Test SMS
                  </Button>
                  <TestChip result={tests.sms} />
                  <p className="text-xs text-muted-foreground">
                    {smsProvider === "TWILIO"
                      ? smsReady
                        ? "Verifies the Twilio Account SID + API key with a real API check — no SMS is sent."
                        : "Save the Twilio Account SID and API key first to enable this check."
                      : smsReady
                        ? "Pings the saved provider endpoint over HTTP (4s timeout) — no SMS is sent."
                        : "Save the provider endpoint and API key first to enable this check."}
                  </p>
                </div>
                <Guide
                  title="How to use"
                  steps={[
                    "Twilio: copy the Account SID and Auth token from the Twilio console.",
                    "MSG91: India requires a DLT-approved sender ID and template ID — register both before sending.",
                    "Use the Test SMS button to confirm the credentials work.",
                  ]}
                />
              </div>
            </SectionCard>

            <SectionCard
              title="WhatsApp"
              description="WhatsApp Business API channel for donor and volunteer updates."
              icon={<MessageSquare className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("sms", "WhatsApp")}
            >
              <div className="grid gap-4">
                <SwitchRow
                  id="s-wa-enabled"
                  label="Enable WhatsApp notifications"
                  checked={bool("notify.whatsapp.enabled")}
                  onCheckedChange={(v) => set("notify.whatsapp.enabled", v ? "true" : "false")}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="s-wa-provider" label="Provider">
                    <Select
                      value={values["notify.whatsapp.provider"] || "CLOUD"}
                      onValueChange={(v) => set("notify.whatsapp.provider", v)}
                    >
                      <SelectTrigger id="s-wa-provider" aria-label="WhatsApp provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CLOUD">WhatsApp Cloud API (Meta)</SelectItem>
                        <SelectItem value="TWILIO">Twilio WhatsApp</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id="s-wa-number" label="WhatsApp business number" hint="Include country code, digits only.">
                    <Input
                      id="s-wa-number"
                      inputMode="numeric"
                      value={values["notify.whatsapp.number"] ?? ""}
                      onChange={(e) => set("notify.whatsapp.number", e.target.value.replace(/[^\d]/g, ""))}
                      placeholder="918000000000"
                      className="font-mono"
                    />
                  </Field>
                  <Field id="s-wa-phoneid" label="Phone number ID" hint="Meta developer app → WhatsApp → API Setup.">
                    <Input
                      id="s-wa-phoneid"
                      value={values["notify.whatsapp.phoneId"] ?? ""}
                      onChange={(e) => set("notify.whatsapp.phoneId", e.target.value)}
                      placeholder="e.g. 123456789012345"
                      className="font-mono"
                      autoComplete="off"
                    />
                  </Field>
                  <SecretField
                    id="s-wa-apikey"
                    label="Access token / API key"
                    hint="Permanent system-user token with the WhatsApp messages permission."
                    configured={configured("notify.whatsapp.apiKey")}
                    placeholder="Paste permanent token"
                    value={secretEdits["notify.whatsapp.apiKey"] ?? ""}
                    onChange={(v) => setSecret("notify.whatsapp.apiKey", v)}
                  />
                </div>
                <Guide
                  title="How to use"
                  steps={[
                    "In the Meta developer app open WhatsApp → API Setup to find your phone number ID.",
                    "Create a permanent system-user token and paste it as the access token.",
                    "Twilio WhatsApp reuses the Twilio credentials saved on the SMS card.",
                  ]}
                />
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    onClick={() => runTest("whatsapp")}
                    disabled={!whatsappReady}
                    aria-label="Test WhatsApp configuration"
                  >
                    <Send className="size-4" aria-hidden="true" /> Test configuration
                  </Button>
                  <TestChip result={tests.whatsapp} />
                  <p className="text-xs text-muted-foreground">
                    {waProvider === "CLOUD"
                      ? whatsappReady
                        ? "Verifies the Cloud API phone number ID + token with a real API check."
                        : "Save the WhatsApp phone number ID and API key first to enable this check."
                      : whatsappReady
                        ? "Verifies the saved Twilio credentials with a real API check."
                        : "WhatsApp via Twilio uses the SMS Twilio credentials (Account SID + API key) — save them on the SMS card to enable this check."}
                  </p>
                </div>
              </div>
            </SectionCard>
          </div>
        </TabsContent>

        {/* ============================ INTEGRATIONS ============================ */}
        <TabsContent value="integrations" className="mt-4">
          <div className="grid gap-4">
            <SectionCard
              title="Storage"
              description="Object storage for distribution photos, kit labels and exports."
              icon={<HardDrive className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("storage", "storage")}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-store-provider" label="Provider">
                  <Select value={values["storage.provider"] || "S3"} onValueChange={(v) => set("storage.provider", v)}>
                    <SelectTrigger id="s-store-provider" aria-label="Storage provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STORAGE_PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="s-store-bucket" label="Bucket">
                  <Input
                    id="s-store-bucket"
                    value={values["storage.bucket"] ?? ""}
                    onChange={(e) => set("storage.bucket", e.target.value)}
                    placeholder="uar-uploads"
                    className="font-mono"
                  />
                </Field>
                <Field id="s-store-region" label="Region" hint="e.g. ap-south-1 (leave blank for local disk).">
                  <Input
                    id="s-store-region"
                    value={values["storage.region"] ?? ""}
                    onChange={(e) => set("storage.region", e.target.value)}
                    placeholder="ap-south-1"
                    className="font-mono"
                  />
                </Field>
                <SecretField
                  id="s-store-accesskey"
                  label="Storage access key"
                  configured={configured("storage.accessKey")}
                  placeholder="Paste access key / secret"
                  value={secretEdits["storage.accessKey"] ?? ""}
                  onChange={(v) => setSecret("storage.accessKey", v)}
                />
                <Field id="s-store-cdn" label="CDN base URL" hint="Public base for uploaded files (optional).">
                  <Input
                    id="s-store-cdn"
                    value={values["storage.cdnBase"] ?? ""}
                    onChange={(e) => set("storage.cdnBase", e.target.value)}
                    placeholder="https://cdn.unitedangelreach.org"
                  />
                </Field>
              </div>
              <Guide
                title="Quick note"
                steps={[
                  "Create an IAM access key with write access to the bucket (AWS → IAM → Users → Security credentials); leave the region blank for local disk.",
                ]}
              />
            </SectionCard>

            <SectionCard
              title="Webhooks"
              description="Push payment and receipt events to an external system in real time."
              icon={<Webhook className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("webhooks", "webhooks")}
            >
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="s-hook-url" label="Endpoint URL" hint="Must be https:// — events are POSTed as JSON.">
                    <Input
                      id="s-hook-url"
                      type="url"
                      value={values["webhooks.url"] ?? ""}
                      onChange={(e) => set("webhooks.url", e.target.value)}
                      placeholder="https://ops.example.org/uar/webhook"
                      className="font-mono"
                    />
                  </Field>
                  <SecretField
                    id="s-hook-secret"
                    label="Webhook signing secret"
                    hint="Sent as X-UAR-Signature HMAC header."
                    configured={configured("webhooks.secret")}
                    placeholder="Paste signing secret"
                    value={secretEdits["webhooks.secret"] ?? ""}
                    onChange={(v) => setSecret("webhooks.secret", v)}
                  />
                </div>
                <Field label="Events to deliver">
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Webhook events">
                    {WEBHOOK_EVENTS.map((ev) => {
                      const on = selectedEvents.includes(ev);
                      return (
                        <button
                          key={ev}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => toggleEvent(ev)}
                          className={cn(
                            "flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                            on
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "grid size-4 place-items-center rounded-[4px] border",
                              on ? "border-emerald-500 bg-emerald-500 text-white" : "border-input"
                            )}
                          >
                            {on && <CheckCircle2 className="size-3" />}
                          </span>
                          {ev}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>
              <Guide
                title="Quick note"
                steps={[
                  "Set the same signing secret in your receiving system — it verifies the X-UAR-Signature HMAC header on every delivery.",
                ]}
              />
            </SectionCard>

            <SectionCard
              title="Analytics"
              description="Traffic analytics for the public donate flow."
              icon={<BarChart3 className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("analytics", "analytics")}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-ana-ga4" label="GA4 measurement ID" hint="Format G-XXXXXXXXXX, loaded on public pages.">
                  <Input
                    id="s-ana-ga4"
                    value={values["analytics.ga4Id"] ?? ""}
                    onChange={(e) => set("analytics.ga4Id", e.target.value)}
                    placeholder="G-XXXXXXXXXX"
                    className="font-mono"
                  />
                </Field>
                <Field id="s-ana-pixel" label="Meta Pixel ID" hint="Facebook/Meta pixel for campaign tracking (optional).">
                  <Input
                    id="s-ana-pixel"
                    value={values["analytics.metaPixel"] ?? ""}
                    onChange={(e) => set("analytics.metaPixel", e.target.value)}
                    placeholder="e.g. 123456789012345"
                    className="font-mono"
                  />
                </Field>
              </div>
              <Guide
                title="Quick note"
                steps={[
                  "GA4 IDs look like G-XXXXXXXXXX — find them in Google Analytics → Admin → Data streams.",
                ]}
              />
            </SectionCard>

            <SectionCard
              title="Security (captcha)"
              description="Bot protection for the donate form and public contact forms."
              icon={<ShieldCheck className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("analytics", "captcha")}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-cap-provider" label="Provider">
                  <Select value={values["captcha.provider"] || "NONE"} onValueChange={(v) => set("captcha.provider", v)}>
                    <SelectTrigger id="s-cap-provider" aria-label="Captcha provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAPTCHA_PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="s-cap-sitekey" label="Site key" hint="Public key rendered with the widget.">
                  <Input
                    id="s-cap-sitekey"
                    value={values["captcha.siteKey"] ?? ""}
                    onChange={(e) => set("captcha.siteKey", e.target.value)}
                    placeholder="Paste site key"
                    className="font-mono"
                    autoComplete="off"
                  />
                </Field>
                <SecretField
                  id="s-cap-secretkey"
                  label="Secret key"
                  hint="Used server-side to verify captcha responses."
                  configured={configured("captcha.secretKey")}
                  placeholder="Paste secret key"
                  value={secretEdits["captcha.secretKey"] ?? ""}
                  onChange={(v) => setSecret("captcha.secretKey", v)}
                />
              </div>
              <Guide
                title="Quick note"
                steps={[
                  "Turnstile / reCAPTCHA issue a key pair — the site key is public (rendered in forms) and the secret key stays server-side.",
                ]}
              />
            </SectionCard>

            <SectionCard
              title="Maps"
              description="Geocoding and maps used by missions, distributions and campaigns."
              icon={<MapPin className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("analytics", "maps")}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-maps-provider" label="Provider">
                  <Select value={values["maps.provider"] || "GOOGLE"} onValueChange={(v) => set("maps.provider", v)}>
                    <SelectTrigger id="s-maps-provider" aria-label="Maps provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MAP_PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <SecretField
                  id="s-maps-apikey"
                  label="Maps API key"
                  hint="Google Maps / Mapbox key used by mission tracking widgets."
                  configured={configured("maps.apiKey")}
                  placeholder="Paste maps API key"
                  value={secretEdits["maps.apiKey"] ?? ""}
                  onChange={(v) => setSecret("maps.apiKey", v)}
                />
              </div>
              <Guide
                title="Quick note"
                steps={[
                  "Create a Google Maps API key in the Google Cloud console and restrict it to the Maps APIs you use.",
                ]}
              />
            </SectionCard>

            <SectionCard
              title="QR codes &amp; system mode"
              description="Kit QR label targeting and platform-wide maintenance control."
              icon={<QrCode className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("system", "system")}
            >
              <div className="grid gap-4">
                <Field
                  id="s-qr-base"
                  label="QR code base URL"
                  hint="Base URL encoded into ration-kit QR labels — scans resolve to {base}/scan/{code}. Leave blank to use the current origin."
                >
                  <Input
                    id="s-qr-base"
                    type="url"
                    value={values["kits.qrBaseUrl"] ?? ""}
                    onChange={(e) => set("kits.qrBaseUrl", e.target.value)}
                    placeholder="https://unitedangelreach.org"
                    className="font-mono"
                  />
                </Field>
                <SwitchRow
                  id="s-maintenance"
                  label="Maintenance mode"
                  hint="Shows a maintenance notice on public pages. The admin console stays available."
                  checked={bool("app.maintenance")}
                  onCheckedChange={(v) => set("app.maintenance", v ? "true" : "false")}
                />
                {bool("app.maintenance") && (
                  <div
                    role="alert"
                    className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>
                      <strong>Maintenance mode is ON.</strong> Donors and volunteers will see a
                      maintenance notice instead of the public site — remember to turn it off after
                      your changes are live.
                    </span>
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </TabsContent>

        {/* ============================ LOGS & AUDIT ============================ */}
        <TabsContent value="logs" className="mt-4">
          <SectionCard
            title="Logs &amp; audit"
            description="Activity trail verbosity, retention, per-action toggles and CSV export."
            icon={<ScrollText className="size-4" aria-hidden="true" />}
            actions={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportLogs}
                  disabled={exportingLogs}
                  aria-label="Export activity logs as CSV"
                >
                  {exportingLogs ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="size-4" aria-hidden="true" />
                  )}
                  Export logs CSV
                </Button>
                {renderSectionSave("logs", "logs")}
              </>
            }
          >
            <div className="grid gap-4">
              <SwitchRow
                id="s-logs-enabled"
                label="Enable activity logging"
                hint="Master switch — records admin actions, dispatches, settings changes and more."
                checked={bool("logs.enabled")}
                onCheckedChange={(v) => set("logs.enabled", v ? "true" : "false")}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-logs-level" label="Log level">
                  <Select value={values["logs.level"] || "INFO"} onValueChange={(v) => set("logs.level", v)}>
                    <SelectTrigger id="s-logs-level" aria-label="Log level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["DEBUG", "INFO", "WARN", "ERROR"].map((l) => (
                        <SelectItem key={l} value={l}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="s-logs-retention" label="Retention (days)" hint="Older rows can be pruned from the Activity Logs view.">
                  <Input
                    id="s-logs-retention"
                    type="number"
                    min={1}
                    value={values["logs.retentionDays"] ?? ""}
                    onChange={(e) => set("logs.retentionDays", e.target.value)}
                    placeholder="90"
                  />
                </Field>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  What to log
                </legend>
                <SwitchRow
                  id="s-logs-logins"
                  label="Log logins & sign-outs"
                  hint="Authentication events for every role."
                  checked={bool("logs.track.logins")}
                  onCheckedChange={(v) => set("logs.track.logins", v ? "true" : "false")}
                />
                <SwitchRow
                  id="s-logs-donations"
                  label="Log donations & receipts"
                  hint="Gifts recorded, receipt issuance and refunds."
                  checked={bool("logs.track.donations")}
                  onCheckedChange={(v) => set("logs.track.donations", v ? "true" : "false")}
                />
                <SwitchRow
                  id="s-logs-distributions"
                  label="Log distributions & kit scans"
                  hint="Field distributions, pad drives and ration-kit scans."
                  checked={bool("logs.track.distributions")}
                  onCheckedChange={(v) => set("logs.track.distributions", v ? "true" : "false")}
                />
                <SwitchRow
                  id="s-logs-admin"
                  label="Log admin edits"
                  hint="Record, campaign and settings changes made by admins."
                  checked={bool("logs.track.adminEdits")}
                  onCheckedChange={(v) => set("logs.track.adminEdits", v ? "true" : "false")}
                />
              </fieldset>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ========================= LANGUAGE & REGION ========================== */}
        <TabsContent value="region" className="mt-4">
          <SectionCard
            title="Language &amp; region"
            description="Defaults used across public pages and formatted dates."
            icon={<Languages className="size-4" aria-hidden="true" />}
            actions={renderSectionSave("region", "language & region")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="s-app-lang"
                label="Default language"
                hint="English is the UI master; public pages show translated fallbacks where available."
              >
                <Select value={values["app.language"] || "en"} onValueChange={(v) => set("app.language", v)}>
                  <SelectTrigger id="s-app-lang" aria-label="Default language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="s-app-tz" label="Timezone" hint="Used for reports, FY boundaries and scheduled tasks.">
                <Select value={values["app.timezone"] || "Asia/Kolkata"} onValueChange={(v) => set("app.timezone", v)}>
                  <SelectTrigger id="s-app-tz" aria-label="Timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="mt-4 rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
              Admin console strings always render from the <strong className="text-foreground">English master</strong>.
              The selected language is served as the default for public pages, with translated
              fallbacks (hi / kn) applied where translations exist; anything untranslated
              falls back to English automatically.
            </p>
          </SectionCard>
        </TabsContent>

        {/* ===================== RECEIPTS & CERTIFICATES ======================== */}
        <TabsContent value="receipts" className="mt-4">
          <SectionCard
            title="Receipts &amp; certificates"
            description="Numbering, signature block and footer printed on 80G receipts and donor certificates."
            icon={<ReceiptText className="size-4" aria-hidden="true" />}
            actions={renderSectionSave("receipts", "receipts")}
          >
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-rcpt-signatory" label="Signatory name">
                  <Input
                    id="s-rcpt-signatory"
                    value={values["receipts.signatoryName"] ?? ""}
                    onChange={(e) => set("receipts.signatoryName", e.target.value)}
                    placeholder="Mansoor Khan"
                  />
                </Field>
                <Field
                  id="s-rcpt-role"
                  label="Signatory level"
                  hint="The trustee-board designation printed under the signatory's name."
                >
                  <Select
                    value={
                      SIGNATORY_LEVELS.includes(values["receipts.signatoryRole"] ?? "")
                        ? values["receipts.signatoryRole"]
                        : "Other"
                    }
                    onValueChange={(v) =>
                      set("receipts.signatoryRole", v === "Other" ? "" : v)
                    }
                  >
                    <SelectTrigger id="s-rcpt-role" aria-label="Signatory level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SIGNATORY_LEVELS.map((lvl) => (
                        <SelectItem key={lvl} value={lvl}>
                          {lvl}
                        </SelectItem>
                      ))}
                      <SelectItem value="Other">Other (type below)</SelectItem>
                    </SelectContent>
                  </Select>
                  {!SIGNATORY_LEVELS.includes(values["receipts.signatoryRole"] ?? "") && (
                    <Input
                      className="mt-2"
                      value={values["receipts.signatoryRole"] ?? ""}
                      onChange={(e) => set("receipts.signatoryRole", e.target.value)}
                      placeholder="Enter a custom designation"
                      aria-label="Custom signatory level"
                    />
                  )}
                </Field>
                <Field
                  id="s-rcpt-prefix"
                  label="Receipt number prefix"
                  hint="Used when receipts are issued: {prefix}-{year}-{00001}. Default UAR-RCPT."
                >
                  <Input
                    id="s-rcpt-prefix"
                    value={values["receipts.prefix"] ?? ""}
                    onChange={(e) => set("receipts.prefix", e.target.value.toUpperCase())}
                    placeholder="UAR-RCPT"
                    className="font-mono"
                  />
                </Field>
              </div>
              <Field id="s-rcpt-footer" label="Receipt footer note" hint="Printed at the bottom of every 80G receipt.">
                <Textarea
                  id="s-rcpt-footer"
                  rows={3}
                  value={values["receipts.footer"] ?? ""}
                  onChange={(e) => set("receipts.footer", e.target.value)}
                  placeholder="Donations are exempt under Section 80G of the Income Tax Act."
                />
              </Field>
              <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                Preview tip: open any donation from the <strong>Donations</strong> view and use its
                “Receipt” action to render the live 80G receipt (A4, print-ready) with these details.
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ============================ AI ASSISTANT ============================ */}
        <TabsContent value="assistant" className="mt-4">
          <SectionCard
            title="AI assistant — Angel AI"
            description="Assistant widget availability and model for staff, donors and volunteers."
            icon={<Bot className="size-4" aria-hidden="true" />}
            actions={renderSectionSave("assistant", "AI assistant")}
          >
            <div className="grid gap-4">
              <SwitchRow
                id="s-ai-enabled"
                label="Enable Angel AI assistant"
                hint="Turn off to hide the assistant widget across the public site and portals."
                checked={bool("assist.enabled")}
                onCheckedChange={(v) => set("assist.enabled", v ? "true" : "false")}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-ai-model" label="Model" hint="e.g. glm-4.6 — changes apply to new conversations.">
                  <Input
                    id="s-ai-model"
                    value={values["assist.model"] ?? ""}
                    onChange={(e) => set("assist.model", e.target.value)}
                    placeholder="glm-4.6"
                    className="font-mono"
                  />
                </Field>
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="matching" className="mt-4">
          <SectionCard
            title="Donor → beneficiary recurring-support matching"
            description="Controls for the auto-match engine that suggests pairing monthly donors with beneficiaries' standing (recurring) needs."
            icon={<Coins className="size-4" aria-hidden="true" />}
            actions={renderSectionSave("matching", "Recurring matching")}
          >
            <div className="grid gap-4">
              <SwitchRow
                id="s-matching-enabled"
                label="Enable auto-match suggestions"
                hint="Shows suggested donor ↔ beneficiary pairings on the Recurring Matching tab. Assignment is always a manual confirm."
                checked={bool("matching.enabled")}
                onCheckedChange={(v) => set("matching.enabled", v ? "true" : "false")}
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="s-matching-category" label="Donor pool category" hint="Donor.category value treated as a recurring/monthly supporter.">
                  <Input
                    id="s-matching-category"
                    value={values["matching.donorCategory"] ?? ""}
                    onChange={(e) => set("matching.donorCategory", e.target.value.toUpperCase())}
                    placeholder="MONTHLY"
                    className="font-mono"
                  />
                </Field>
                <Field id="s-matching-min" label="Minimum suggested amount (₹/mo)" hint="Used when an item has no unit price on file.">
                  <Input
                    id="s-matching-min"
                    type="number"
                    min={0}
                    value={values["matching.minMonthlyAmount"] ?? ""}
                    onChange={(e) => set("matching.minMonthlyAmount", e.target.value)}
                  />
                </Field>
                <Field id="s-matching-cap" label="Max active sponsorships / donor" hint="Caps how many beneficiaries one donor is suggested for at a time.">
                  <Input
                    id="s-matching-cap"
                    type="number"
                    min={1}
                    value={values["matching.maxActivePerDonor"] ?? ""}
                    onChange={(e) => set("matching.maxActivePerDonor", e.target.value)}
                  />
                </Field>
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ============================ FOOD SECURITY ========================== */}
        <TabsContent value="food" className="mt-4">
          <SectionCard
            title="Food Security & Community Nutrition"
            description="Operational controls for the food programme — public rate limits, expiry alerts and the AI waste-prevention horizon."
            icon={<Apple className="size-4" aria-hidden="true" />}
            actions={renderSectionSave("food", "food security")}
          >
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="s-food-applications-limit" label="Assistance applications / hour / IP" hint="Public apply form (/#/food-assistance/apply). Raise for camps or drives.">
                  <Input
                    id="s-food-applications-limit"
                    type="number"
                    min={1}
                    value={values["food.applications.rateLimitPerHour"] ?? ""}
                    onChange={(e) => set("food.applications.rateLimitPerHour", e.target.value)}
                  />
                </Field>
                <Field id="s-food-status-limit" label="Status checks / hour / IP" hint="Public reference-number status lookups.">
                  <Input
                    id="s-food-status-limit"
                    type="number"
                    min={1}
                    value={values["food.statusCheck.rateLimitPerHour"] ?? ""}
                    onChange={(e) => set("food.statusCheck.rateLimitPerHour", e.target.value)}
                  />
                </Field>
                <Field id="s-food-pledges-limit" label="Donation pledges / hour / IP" hint="Public “Donate groceries” form on the food page.">
                  <Input
                    id="s-food-pledges-limit"
                    type="number"
                    min={1}
                    value={values["food.pledges.rateLimitPerHour"] ?? ""}
                    onChange={(e) => set("food.pledges.rateLimitPerHour", e.target.value)}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-food-expiry-days" label="Expiry alert window (days)" hint="Batches expiring within this window are flagged on the Food Inventory desk and event pages.">
                  <Input
                    id="s-food-expiry-days"
                    type="number"
                    min={1}
                    value={values["food.expiryAlertDays"] ?? ""}
                    onChange={(e) => set("food.expiryAlertDays", e.target.value)}
                  />
                </Field>
                <Field id="s-food-ai-window" label="AI waste-prevention horizon (days)" hint="How far ahead the AI waste assistant looks for at-risk stock. Expired/quarantined stock is always excluded, whatever this value is.">
                  <Input
                    id="s-food-ai-window"
                    type="number"
                    min={1}
                    value={values["food.aiRiskWindowDays"] ?? ""}
                    onChange={(e) => set("food.aiRiskWindowDays", e.target.value)}
                  />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">
                Rate limits are best-effort per-process controls (single Node process). A test-harness restart clears the buckets.
              </p>
            </div>
          </SectionCard>
        </TabsContent>
        {/* ============================ MOBILE APP ============================ */}
        <TabsContent value="mobile" className="mt-4">
          <div className="space-y-4">
            <SectionCard
              title="Mobile app configuration"
              description="Settings the Flutter app reads from GET /api/settings/app — saving a card pushes the change to the app on its next settings load."
              icon={<Smartphone className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("mobile", "mobile settings")}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-mobile-app-name" label="App name">
                  <Input
                    id="s-mobile-app-name"
                    value={values["mobile.app_name"] ?? ""}
                    onChange={(e) => set("mobile.app_name", e.target.value)}
                    placeholder="United Angel Reach"
                  />
                </Field>
                <Field id="s-mobile-support-email" label="Support email">
                  <Input
                    id="s-mobile-support-email"
                    type="email"
                    value={values["mobile.support_email"] ?? ""}
                    onChange={(e) => set("mobile.support_email", e.target.value)}
                    placeholder="support@unitedangelreach.org"
                  />
                </Field>
                <Field id="s-mobile-storage-type" label="Storage type" hint="0 = local disk, 1 = cloud (S3 / RustFS).">
                  <Select value={values["mobile.storage_type"] || "1"} onValueChange={(v) => set("mobile.storage_type", v)}>
                    <SelectTrigger id="s-mobile-storage-type" aria-label="Storage type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 — Cloud storage</SelectItem>
                      <SelectItem value="0">0 — Local disk</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="s-mobile-fetch-post-type" label="Feed ordering" hint="Latest is chronological and stable across refreshes; random reshuffles on every pull-to-refresh.">
                  <Select value={values["mobile.fetch_post_type"] || "1"} onValueChange={(v) => set("mobile.fetch_post_type", v)}>
                    <SelectTrigger id="s-mobile-fetch-post-type" aria-label="Feed ordering">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 — Latest (chronological)</SelectItem>
                      <SelectItem value="0">0 — Random shuffle</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="s-mobile-reel-duration" label="Max reel duration (seconds)">
                  <Input
                    id="s-mobile-reel-duration"
                    type="number"
                    min={1}
                    value={values["mobile.duration_limit_in_reel"] ?? ""}
                    onChange={(e) => set("mobile.duration_limit_in_reel", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-story-minutes" label="Max story recording (minutes)">
                  <Input
                    id="s-mobile-story-minutes"
                    type="number"
                    min={1}
                    value={values["mobile.minute_limit_in_creating_story"] ?? ""}
                    onChange={(e) => set("mobile.minute_limit_in_creating_story", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-audio-minutes" label="Max audio post (minutes)">
                  <Input
                    id="s-mobile-audio-minutes"
                    type="number"
                    min={1}
                    value={values["mobile.minute_limit_in_audio_post"] ?? ""}
                    onChange={(e) => set("mobile.minute_limit_in_audio_post", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-story-video-minutes" label="Max gallery video for story (minutes)">
                  <Input
                    id="s-mobile-story-video-minutes"
                    type="number"
                    min={1}
                    value={values["mobile.minute_limit_in_choosing_video_for_story"] ?? ""}
                    onChange={(e) => set("mobile.minute_limit_in_choosing_video_for_story", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-post-video-minutes" label="Max gallery video for post (minutes)">
                  <Input
                    id="s-mobile-post-video-minutes"
                    type="number"
                    min={1}
                    value={values["mobile.minute_limit_in_choosing_video_for_post"] ?? ""}
                    onChange={(e) => set("mobile.minute_limit_in_choosing_video_for_post", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-max-images" label="Max images per post">
                  <Input
                    id="s-mobile-max-images"
                    type="number"
                    min={1}
                    value={values["mobile.max_images_can_be_uploaded_in_one_post"] ?? ""}
                    onChange={(e) => set("mobile.max_images_can_be_uploaded_in_one_post", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-room-users" label="Max users per room">
                  <Input
                    id="s-mobile-room-users"
                    type="number"
                    min={2}
                    value={values["mobile.set_room_users_limit"] ?? ""}
                    onChange={(e) => set("mobile.set_room_users_limit", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-audio-hosts" label="Audio space — max hosts">
                  <Input
                    id="s-mobile-audio-hosts"
                    type="number"
                    min={1}
                    value={values["mobile.audio_space_hosts_limit"] ?? ""}
                    onChange={(e) => set("mobile.audio_space_hosts_limit", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-audio-listeners" label="Audio space — max listeners">
                  <Input
                    id="s-mobile-audio-listeners"
                    type="number"
                    min={1}
                    value={values["mobile.audio_space_listeners_limit"] ?? ""}
                    onChange={(e) => set("mobile.audio_space_listeners_limit", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-audio-duration" label="Audio space — max duration (minutes)">
                  <Input
                    id="s-mobile-audio-duration"
                    type="number"
                    min={1}
                    value={values["mobile.audio_space_duration_in_minutes"] ?? ""}
                    onChange={(e) => set("mobile.audio_space_duration_in_minutes", e.target.value)}
                  />
                </Field>
              </div>
            </SectionCard>

            <SectionCard
              title="Maintenance & app updates"
              description="Kill-switch banner, force-update gate and store links served to the app."
              icon={<Smartphone className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("mobile", "mobile settings")}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-mobile-maintenance" label="Maintenance mode">
                  <Select value={values["mobile.is_maintenance_mode"] || "0"} onValueChange={(v) => set("mobile.is_maintenance_mode", v)}>
                    <SelectTrigger id="s-mobile-maintenance" aria-label="Maintenance mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 — Off</SelectItem>
                      <SelectItem value="1">1 — Show maintenance screen</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="s-mobile-maintenance-message" label="Maintenance message">
                  <Textarea
                    id="s-mobile-maintenance-message"
                    rows={2}
                    value={values["mobile.maintenance_message"] ?? ""}
                    onChange={(e) => set("mobile.maintenance_message", e.target.value)}
                    placeholder="We're upgrading the app — back shortly."
                  />
                </Field>
                <Field id="s-mobile-force-update" label="Force app update">
                  <Select value={values["mobile.is_force_app_update"] || "0"} onValueChange={(v) => set("mobile.is_force_app_update", v)}>
                    <SelectTrigger id="s-mobile-force-update" aria-label="Force app update">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 — Off</SelectItem>
                      <SelectItem value="1">1 — Block outdated versions</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="s-mobile-android-version" label="Latest Android version code">
                  <Input
                    id="s-mobile-android-version"
                    value={values["mobile.android_app_version"] ?? ""}
                    onChange={(e) => set("mobile.android_app_version", e.target.value)}
                    placeholder="1.2.0"
                  />
                </Field>
                <Field id="s-mobile-ios-version" label="Latest iOS version code">
                  <Input
                    id="s-mobile-ios-version"
                    value={values["mobile.ios_app_version"] ?? ""}
                    onChange={(e) => set("mobile.ios_app_version", e.target.value)}
                    placeholder="1.2.0"
                  />
                </Field>
                <Field id="s-mobile-play-link" label="Play Store download link">
                  <Input
                    id="s-mobile-play-link"
                    value={values["mobile.play_store_download_link"] ?? ""}
                    onChange={(e) => set("mobile.play_store_download_link", e.target.value)}
                    placeholder="https://play.google.com/store/apps/details?id=…"
                  />
                </Field>
                <Field id="s-mobile-appstore-link" label="App Store download link">
                  <Input
                    id="s-mobile-appstore-link"
                    value={values["mobile.app_store_download_link"] ?? ""}
                    onChange={(e) => set("mobile.app_store_download_link", e.target.value)}
                    placeholder="https://apps.apple.com/app/…"
                  />
                </Field>
              </div>
            </SectionCard>

            <SectionCard
              title="Ads & in-app purchases"
              description="AdMob unit IDs and the monetisation switches the app honours."
              icon={<Smartphone className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("mobile", "mobile settings")}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-mobile-admob" label="AdMob">
                  <Select value={values["mobile.is_admob_on"] || "0"} onValueChange={(v) => set("mobile.is_admob_on", v)}>
                    <SelectTrigger id="s-mobile-admob" aria-label="AdMob">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 — Disabled</SelectItem>
                      <SelectItem value="1">1 — Enabled</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="s-mobile-iap" label="In-app purchases">
                  <Select value={values["mobile.is_in_app_purchase_enabled"] || "0"} onValueChange={(v) => set("mobile.is_in_app_purchase_enabled", v)}>
                    <SelectTrigger id="s-mobile-iap" aria-label="In-app purchases">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 — Disabled</SelectItem>
                      <SelectItem value="1">1 — Enabled</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="s-mobile-ad-banner-android" label="AdMob banner unit — Android">
                  <Input
                    id="s-mobile-ad-banner-android"
                    className="font-mono"
                    value={values["mobile.ad_banner_android"] ?? ""}
                    onChange={(e) => set("mobile.ad_banner_android", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-ad-banner-ios" label="AdMob banner unit — iOS">
                  <Input
                    id="s-mobile-ad-banner-ios"
                    className="font-mono"
                    value={values["mobile.ad_banner_iOS"] ?? ""}
                    onChange={(e) => set("mobile.ad_banner_iOS", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-ad-inter-android" label="AdMob interstitial — Android">
                  <Input
                    id="s-mobile-ad-inter-android"
                    className="font-mono"
                    value={values["mobile.ad_interstitial_android"] ?? ""}
                    onChange={(e) => set("mobile.ad_interstitial_android", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-ad-inter-ios" label="AdMob interstitial — iOS">
                  <Input
                    id="s-mobile-ad-inter-ios"
                    className="font-mono"
                    value={values["mobile.ad_interstitial_iOS"] ?? ""}
                    onChange={(e) => set("mobile.ad_interstitial_iOS", e.target.value)}
                  />
                </Field>
              </div>
            </SectionCard>

            <SectionCard
              title="SightEngine moderation"
              description="External content-moderation credentials. The secret is stored server-side and never served to app clients."
              icon={<ShieldCheck className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("mobile", "mobile settings")}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="s-mobile-sightengine" label="SightEngine checks">
                  <Select value={values["mobile.is_sight_engine_enabled"] || "0"} onValueChange={(v) => set("mobile.is_sight_engine_enabled", v)}>
                    <SelectTrigger id="s-mobile-sightengine" aria-label="SightEngine checks">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 — Disabled</SelectItem>
                      <SelectItem value="1">1 — Enabled</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="s-mobile-se-user" label="SightEngine API user">
                  <Input
                    id="s-mobile-se-user"
                    className="font-mono"
                    value={values["mobile.sight_engine_api_user"] ?? ""}
                    onChange={(e) => set("mobile.sight_engine_api_user", e.target.value)}
                  />
                </Field>
                <SecretField
                  id="s-mobile-se-secret"
                  label="SightEngine API secret"
                  configured={configured("mobile.sight_engine_api_secret")}
                  value={secretEdits["mobile.sight_engine_api_secret"] ?? ""}
                  onChange={(v) => setSecretEdits((prev) => ({ ...prev, "mobile.sight_engine_api_secret": v }))}
                />
                <Field id="s-mobile-se-image-workflow" label="Image workflow ID">
                  <Input
                    id="s-mobile-se-image-workflow"
                    className="font-mono"
                    value={values["mobile.sight_engine_image_workflow_id"] ?? ""}
                    onChange={(e) => set("mobile.sight_engine_image_workflow_id", e.target.value)}
                  />
                </Field>
                <Field id="s-mobile-se-video-workflow" label="Video workflow ID">
                  <Input
                    id="s-mobile-se-video-workflow"
                    className="font-mono"
                    value={values["mobile.sight_engine_video_workflow_id"] ?? ""}
                    onChange={(e) => set("mobile.sight_engine_video_workflow_id", e.target.value)}
                  />
                </Field>
              </div>
            </SectionCard>
          </div>
        </TabsContent>
      </Tabs>

      {/* ============================ STICKY SAVE BAR =========================== */}
      {dirtyCount > 0 && (
        <div className="sticky bottom-4 z-10">
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur",
              "dark:bg-card/90"
            )}
          >
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
            </Badge>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Only the changed keys are written. Secrets stay masked. Use “Save” on any card to persist
              just that section.
            </p>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={reset} aria-label="Reset changes">
                <RotateCcw className="size-4" aria-hidden="true" /> Reset
              </Button>
              <Button onClick={save} disabled={saving} aria-label="Save settings">
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                {saving ? "Saving…" : "Save all changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
