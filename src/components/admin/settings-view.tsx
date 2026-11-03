"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bot,
  Building2,
  CalendarRange,
  CheckCircle2,
  Coins,
  Download,
  Eye,
  EyeOff,
  HardDrive,
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
  TriangleAlert,
  Webhook,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { get, patch, post } from "@/lib/api-client";
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
  state: "running" | "ok" | "error";
  latencyMs?: number;
  message?: string;
}

/* -------------------------------- defaults -------------------------------- */

const DEFAULTS: SettingsMap = {
  "org.name": "United Angel Reach",
  "org.hq": "Bengaluru, Karnataka",
  "org.address": "",
  "org.email": "contact@unitedangelreach.org",
  "org.phone": "",
  "org.pan": "",
  "org.80g": "",
  "org.reg12a": "",
  "org.darpan": "",
  "org.website": "",
  "org.vision": "To scale our service model to serve all of India.",
  "finance.fyStartMonth": "4",
  "finance.upiId": "",
  "finance.razorpayKeyId": "",
  "finance.stripeKeyId": "",
  "finance.gatewayProvider": "RAZORPAY",
  "finance.gatewayKeySecret": "",
  "finance.gatewayWebhookSecret": "",
  "finance.gatewayTestMode": "true",
  "finance.gatewayEnabled": "false",
  "finance.currency": "INR",
  "payments.gst": "",
  "notify.email.enabled": "false",
  "notify.email.host": "",
  "notify.email.port": "587",
  "notify.email.from": "",
  "notify.email.fromName": "United Angel Reach",
  "notify.email.secure": "false",
  "notify.email.username": "",
  "notify.email.password": "",
  "notify.email.replyTo": "",
  "notify.sms.enabled": "false",
  "notify.sms.provider": "TWILIO",
  "notify.sms.senderId": "",
  "notify.sms.endpoint": "",
  "notify.sms.apiKey": "",
  "notify.sms.templateId": "",
  "notify.whatsapp.enabled": "false",
  "notify.whatsapp.number": "",
  "storage.provider": "S3",
  "storage.bucket": "",
  "storage.region": "",
  "storage.accessKey": "",
  "storage.cdnBase": "",
  "webhooks.url": "",
  "webhooks.events": "",
  "webhooks.secret": "",
  "analytics.ga4Id": "",
  "analytics.metaPixel": "",
  "captcha.provider": "NONE",
  "captcha.siteKey": "",
  "captcha.secretKey": "",
  "maps.provider": "GOOGLE",
  "maps.apiKey": "",
  "kits.qrBaseUrl": "",
  "logs.enabled": "true",
  "logs.level": "INFO",
  "logs.retentionDays": "90",
  "logs.track.logins": "true",
  "logs.track.donations": "true",
  "logs.track.distributions": "true",
  "logs.track.adminEdits": "true",
  "app.language": "en",
  "app.timezone": "Asia/Kolkata",
  "app.maintenance": "false",
  "receipts.signatoryName": "",
  "receipts.signatoryRole": "Trustee",
  "receipts.prefix": "UAR-RCPT",
  "receipts.footer": "",
  "assist.enabled": "true",
  "assist.model": "glm-4.6",
};

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

/**
 * Keys rendered as password inputs. Rule: a key is secret when its last
 * segment ends with Secret / Password / Key / Token — plus the gateway key
 * IDs which UAR treats as credentials. captcha.siteKey is public by design.
 */
const SECRET_OVERRIDES = new Set<string>(["finance.razorpayKeyId", "finance.stripeKeyId"]);
const PUBLIC_KEY_NAMES = new Set<string>(["captcha.siteKey"]);

function isSecretKey(key: string): boolean {
  if (SECRET_OVERRIDES.has(key)) return true;
  if (PUBLIC_KEY_NAMES.has(key)) return false;
  const last = key.split(".").pop() ?? "";
  return /(secret|password|key|token)$/i.test(last);
}

/* ------------------------- per-section save mapping ------------------------ */

/** Prefix rules that map dirty keys → the card that owns them. */
const SECTION_PREFIXES: Record<string, string[]> = {
  org: ["org.", "finance.fyStartMonth"],
  payments: [
    "finance.upiId",
    "finance.currency",
    "finance.gateway",
    "finance.razorpayKeyId",
    "finance.stripeKeyId",
    "payments.gst",
  ],
  email: ["notify.email."],
  sms: ["notify.sms."],
  whatsapp: ["notify.whatsapp."],
  storage: ["storage."],
  webhooks: ["webhooks."],
  analytics: ["analytics."],
  captcha: ["captcha."],
  maps: ["maps."],
  system: ["kits.", "app.maintenance"],
  logs: ["logs."],
  region: ["app.language", "app.timezone"],
  receipts: ["receipts."],
  assistant: ["assist."],
};

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

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी — Hindi" },
  { value: "kn", label: "ಕನ್ನಡ — Kannada" },
  { value: "ta", label: "தமிழ் — Tamil" },
  { value: "te", label: "తెలుగు — Telugu" },
];

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

const SMS_PROVIDERS = ["Twilio", "MSG91", "Gupshup", "Other"];

const GATEWAY_PROVIDERS = [
  { value: "RAZORPAY", label: "Razorpay" },
  { value: "CASHFREE", label: "Cashfree" },
  { value: "PAYU", label: "PayU" },
  { value: "STRIPE", label: "Stripe" },
];

const STORAGE_PROVIDERS = [
  { value: "S3", label: "S3 — Amazon S3" },
  { value: "R2", label: "R2 — Cloudflare R2" },
  { value: "SPACES", label: "Spaces — DigitalOcean" },
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
  { value: "MAPMYINDIA", label: "MapmyIndia" },
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
  return (
    <Badge variant="outline" className="gap-1 border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400">
      <XCircle className="size-3" aria-hidden="true" /> Failed
    </Badge>
  );
}

/* ---------------------------------- view ----------------------------------- */

export default function SettingsView() {
  const [saved, setSaved] = useState<SettingsMap>({ ...DEFAULTS });
  const [values, setValues] = useState<SettingsMap>({ ...DEFAULTS });
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
      const merged = { ...DEFAULTS, ...normalize(raw) };
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

  const keysForSection = useCallback(
    (section: string): string[] => {
      const prefixes = SECTION_PREFIXES[section] ?? [];
      return Object.keys(dirtyMap).filter(
        (k) => prefixes.some((p) => k === p || k.startsWith(p))
      );
    },
    [dirtyMap]
  );

  const dirtyInSection = (section: string) => keysForSection(section).length;

  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCount]);

  const validate = (): string | null => {
    const email = values["org.email"] ?? "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Organisation email looks invalid.";
    const replyTo = values["notify.email.replyTo"] ?? "";
    if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) return "Reply-to email looks invalid.";
    const upi = values["finance.upiId"] ?? "";
    if (upi && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) return "UPI ID must look like name@bank (e.g. uar@okhdfcbank).";
    const port = Number(values["notify.email.port"]);
    if (values["notify.email.port"] && (!Number.isFinite(port) || port < 1 || port > 65535))
      return "SMTP port must be between 1 and 65535.";
    const retention = Number(values["logs.retentionDays"]);
    if (values["logs.retentionDays"] && (!Number.isFinite(retention) || retention < 1))
      return "Log retention must be at least 1 day.";
    const fyMonth = Number(values["finance.fyStartMonth"]);
    if (values["finance.fyStartMonth"] && (!Number.isInteger(fyMonth) || fyMonth < 1 || fyMonth > 12))
      return "Fiscal year start must be a month between 1 and 12.";
    const prefix = values["receipts.prefix"] ?? "";
    if (prefix && !/^[A-Za-z0-9\-]{2,12}$/.test(prefix))
      return "Receipt prefix must be 2–12 letters, digits or dashes (e.g. UAR-RCPT).";
    const qrBase = values["kits.qrBaseUrl"] ?? "";
    if (qrBase && !/^https?:\/\/\S+$/.test(qrBase))
      return "QR base URL must start with http:// or https://.";
    const webhookUrl = values["webhooks.url"] ?? "";
    if (webhookUrl && !/^https:\/\/\S+/.test(webhookUrl))
      return "Webhook URL must be a secure https:// address.";
    const cdn = values["storage.cdnBase"] ?? "";
    if (cdn && !/^https?:\/\/\S+/.test(cdn))
      return "CDN base URL must start with http:// or https://.";
    const ga4 = values["analytics.ga4Id"] ?? "";
    if (ga4 && !/^G-[A-Z0-9]+$/i.test(ga4))
      return "GA4 measurement ID must look like G-XXXXXXXXXX.";
    return null;
  };

  /** Merge a fresh settings payload into state after any successful save. */
  const applySaved = (raw: unknown, keys: string[]) => {
    const merged = { ...DEFAULTS, ...normalize(raw) };
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
    const keys = keysForSection(section);
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
      const res = await post<{ ok?: boolean; latencyMs?: number; message?: string }>(
        "/api/settings/test",
        { channel }
      );
      const result: TestResult = {
        state: res?.ok === false ? "error" : "ok",
        latencyMs: res?.latencyMs,
        message: res?.message,
      };
      setTests((prev) => ({ ...prev, [channel]: result }));
      if (result.state === "ok") {
        toast.success(`${channel.toUpperCase()} test OK · ${res?.latencyMs ?? 0}ms`, {
          description: res?.message,
        });
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
  const smsEndpointSet = (values["notify.sms.endpoint"] ?? "").trim().length > 0;
  const whatsappNumberSet = (values["notify.whatsapp.number"] ?? "").trim().length > 0;
  const gatewayKeysSet =
    configured("finance.razorpayKeyId") ||
    (secretEdits["finance.razorpayKeyId"] ?? "").trim().length > 0;

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
          <Button variant="outline" onClick={load} aria-label="Reload settings">
            <RefreshCw className="size-4" aria-hidden="true" /> Reload
          </Button>
        }
      />

      <Tabs defaultValue="org">
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="org">Organisation</TabsTrigger>
          <TabsTrigger value="finance">Payments &amp; Finance</TabsTrigger>
          <TabsTrigger value="email">Email (SMTP)</TabsTrigger>
          <TabsTrigger value="sms">SMS &amp; WhatsApp</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="logs">Logs &amp; Audit</TabsTrigger>
          <TabsTrigger value="region">Language &amp; Region</TabsTrigger>
          <TabsTrigger value="receipts">Receipts &amp; Certificates</TabsTrigger>
          <TabsTrigger value="assistant">AI Assistant</TabsTrigger>
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
                <Field id="s-fin-currency" label="Currency" hint="All amounts are stored in this currency.">
                  <Select value={values["finance.currency"] || "INR"} onValueChange={(v) => set("finance.currency", v)}>
                    <SelectTrigger id="s-fin-currency" aria-label="Currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INR">INR — Indian Rupee</SelectItem>
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
                <SecretField
                  id="s-fin-rzp"
                  label="Razorpay key ID"
                  hint="Public identifier (rzp_test_… / rzp_live_…). Never echoed after saving."
                  configured={configured("finance.razorpayKeyId")}
                  placeholder="rzp_live_xxxxxxxx"
                  value={secretEdits["finance.razorpayKeyId"] ?? ""}
                  onChange={(v) => setSecret("finance.razorpayKeyId", v)}
                />
                <SecretField
                  id="s-fin-stripe"
                  label="Stripe key ID"
                  hint="Publishable key (pk_live_…) used when the Stripe gateway is selected."
                  configured={configured("finance.stripeKeyId")}
                  placeholder="pk_live_xxxxxxxx"
                  value={secretEdits["finance.stripeKeyId"] ?? ""}
                  onChange={(v) => setSecret("finance.stripeKeyId", v)}
                />
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
                    <Select value={values["notify.sms.provider"] || "Twilio"} onValueChange={(v) => set("notify.sms.provider", v)}>
                      <SelectTrigger id="s-sms-provider" aria-label="SMS provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SMS_PROVIDERS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
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
                  <Field id="s-sms-endpoint" label="API endpoint" hint="Provider REST base URL (for 'Other' gateways).">
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
                    disabled={!smsEndpointSet}
                    aria-label="Test SMS endpoint"
                  >
                    <Send className="size-4" aria-hidden="true" /> Test endpoint
                  </Button>
                  <TestChip result={tests.sms} />
                  <p className="text-xs text-muted-foreground">
                    {smsEndpointSet
                      ? "Pings the saved provider endpoint over HTTP (4s timeout) — no SMS is sent."
                      : "Save the provider API endpoint first to enable this check."}
                  </p>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="WhatsApp"
              description="WhatsApp Business API channel for donor and volunteer updates."
              icon={<MessageSquare className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("whatsapp", "WhatsApp")}
            >
              <div className="grid gap-4">
                <SwitchRow
                  id="s-wa-enabled"
                  label="Enable WhatsApp notifications"
                  checked={bool("notify.whatsapp.enabled")}
                  onCheckedChange={(v) => set("notify.whatsapp.enabled", v ? "true" : "false")}
                />
                <div className="grid gap-4 sm:grid-cols-2">
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
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    onClick={() => runTest("whatsapp")}
                    disabled={!whatsappNumberSet}
                    aria-label="Test WhatsApp configuration"
                  >
                    <Send className="size-4" aria-hidden="true" /> Test configuration
                  </Button>
                  <TestChip result={tests.whatsapp} />
                  <p className="text-xs text-muted-foreground">
                    {whatsappNumberSet
                      ? "Verifies the saved business number format and channel settings."
                      : "Save the WhatsApp business number first to enable this check."}
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
            </SectionCard>

            <SectionCard
              title="Security (captcha)"
              description="Bot protection for the donate form and public contact forms."
              icon={<ShieldCheck className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("captcha", "captcha")}
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
            </SectionCard>

            <SectionCard
              title="Maps"
              description="Geocoding and maps used by missions, distributions and campaigns."
              icon={<MapPin className="size-4" aria-hidden="true" />}
              actions={renderSectionSave("maps", "maps")}
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
                  hint="Google Maps / MapmyIndia key used by mission tracking widgets."
                  configured={configured("maps.apiKey")}
                  placeholder="Paste maps API key"
                  value={secretEdits["maps.apiKey"] ?? ""}
                  onChange={(v) => setSecret("maps.apiKey", v)}
                />
              </div>
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
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
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
              fallbacks (hi / kn / ta / te) applied where translations exist; anything untranslated
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
                    placeholder="Ananya Sharma"
                  />
                </Field>
                <Field id="s-rcpt-role" label="Signatory role">
                  <Input
                    id="s-rcpt-role"
                    value={values["receipts.signatoryRole"] ?? ""}
                    onChange={(e) => set("receipts.signatoryRole", e.target.value)}
                    placeholder="Trustee / Secretary"
                  />
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
