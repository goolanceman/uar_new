"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Building2,
  CheckCircle2,
  Coins,
  Eye,
  EyeOff,
  Languages,
  Loader2,
  Mail,
  MessageSquare,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Send,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { get, patch, post } from "@/lib/api-client";
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
  "finance.upiId": "",
  "finance.razorpayKeyId": "",
  "finance.gatewayEnabled": "false",
  "finance.currency": "INR",
  "notify.email.enabled": "false",
  "notify.email.host": "",
  "notify.email.port": "587",
  "notify.email.from": "",
  "notify.email.fromName": "United Angel Reach",
  "notify.email.secure": "false",
  "notify.sms.enabled": "false",
  "notify.sms.provider": "TWILIO",
  "notify.sms.senderId": "",
  "notify.sms.endpoint": "",
  "notify.whatsapp.enabled": "false",
  "notify.whatsapp.number": "",
  "logs.enabled": "true",
  "logs.level": "INFO",
  "logs.retentionDays": "90",
  "app.language": "en",
  "app.timezone": "Asia/Kolkata",
  "receipts.signatoryName": "",
  "receipts.signatoryRole": "Trustee",
  "receipts.footer": "",
  "assist.model": "glm-4.6",
};

function normalize(raw: unknown): SettingsMap {
  if (Array.isArray(raw)) {
    const out: SettingsMap = {};
    for (const item of raw as Record<string, unknown>[]) {
      if (item && typeof item.key === "string") out[item.key] = String(item.value ?? "");
    }
    return out;
  }
  if (raw && typeof raw === "object") {
    const out: SettingsMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    }
    return out;
  }
  return {};
}

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
  { value: "hi", label: "हिंदी" },
  { value: "kn", label: "ಕನ್ನಡ" },
];

const SMS_PROVIDERS = ["Twilio", "MSG91", "Gupshup", "Other"];

/* ------------------------------ small helpers ------------------------------ */

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [showSecret, setShowSecret] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await get<unknown>("/api/settings");
      const merged = { ...DEFAULTS, ...normalize(raw) };
      setSaved(merged);
      setValues(merged);
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

  const bool = (key: string) => (values[key] ?? "false") === "true";

  /* dirty tracking — only changed keys are patched */
  const dirtyMap = useMemo(() => {
    const keys = new Set([...Object.keys(saved), ...Object.keys(values)]);
    const out: SettingsMap = {};
    for (const k of keys) {
      if ((values[k] ?? "") !== (saved[k] ?? "")) out[k] = values[k] ?? "";
    }
    return out;
  }, [saved, values]);

  const dirtyCount = Object.keys(dirtyMap).length;

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
    const upi = values["finance.upiId"] ?? "";
    if (upi && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) return "UPI ID must look like name@bank (e.g. uar@okhdfcbank).";
    const port = Number(values["notify.email.port"]);
    if (values["notify.email.port"] && (!Number.isFinite(port) || port < 1 || port > 65535))
      return "SMTP port must be between 1 and 65535.";
    const retention = Number(values["logs.retentionDays"]);
    if (values["logs.retentionDays"] && (!Number.isFinite(retention) || retention < 1))
      return "Log retention must be at least 1 day.";
    return null;
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
      const merged = { ...DEFAULTS, ...normalize(raw) };
      setSaved(merged);
      setValues(merged);
      toast.success(`Saved ${dirtyCount} setting${dirtyCount === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setValues(saved);
    toast.info("Changes reverted");
  };

  const runTest = async (channel: "email" | "sms" | "whatsapp") => {
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

  const secret = values["finance.razorpayKeyId"] ?? "";
  const secretHint = secret.length > 4 ? `••••${secret.slice(-4)}` : secret ? "••••" : "Not configured";

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
        description="Organisation identity, payments, notifications, audit and regional preferences."
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
              <Field id="s-org-website" label="Website">
                <Input
                  id="s-org-website"
                  value={values["org.website"] ?? ""}
                  onChange={(e) => set("org.website", e.target.value)}
                  placeholder="https://unitedangelreach.org"
                />
              </Field>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ========================= PAYMENTS & FINANCE ========================= */}
        <TabsContent value="finance" className="mt-4">
          <SectionCard
            title="Payments &amp; finance"
            description="UPI collections, Razorpay gateway and currency preferences."
            icon={<Coins className="size-4" aria-hidden="true" />}
          >
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
              <Field
                id="s-fin-rzp"
                label="Razorpay key ID"
                hint={`Stored securely. Current: ${secretHint}`}
              >
                <div className="flex gap-2">
                  <Input
                    id="s-fin-rzp"
                    type={showSecret ? "text" : "password"}
                    value={values["finance.razorpayKeyId"] ?? ""}
                    onChange={(e) => set("finance.razorpayKeyId", e.target.value)}
                    placeholder="rzp_live_xxxxxxxx"
                    className="font-mono"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowSecret((s) => !s)}
                    aria-label={showSecret ? "Hide key" : "Show key"}
                  >
                    {showSecret ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                  </Button>
                </div>
              </Field>
              <SwitchRow
                id="s-fin-gateway"
                label="Enable Razorpay gateway"
                hint="Turn off to collect only via UPI / bank transfer."
                checked={bool("finance.gatewayEnabled")}
                onCheckedChange={(v) => set("finance.gatewayEnabled", v ? "true" : "false")}
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
            actions={<TestChip result={tests.email} />}
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
              </div>
              <SwitchRow
                id="s-mail-secure"
                label="Use secure TLS connection"
                hint="Enable for port 465; leave off for STARTTLS on 587."
                checked={bool("notify.email.secure")}
                onCheckedChange={(v) => set("notify.email.secure", v ? "true" : "false")}
              />
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button variant="outline" onClick={() => runTest("email")} aria-label="Send SMTP test">
                  <Send className="size-4" aria-hidden="true" /> Send test
                </Button>
                <TestChip result={tests.email} />
                <p className="text-xs text-muted-foreground">Runs a simulated connectivity check against the saved host.</p>
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
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <Button variant="outline" onClick={() => runTest("sms")} aria-label="Send SMS test">
                    <Send className="size-4" aria-hidden="true" /> Send test
                  </Button>
                  <TestChip result={tests.sms} />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="WhatsApp"
              description="WhatsApp Business API channel for donor and volunteer updates."
              icon={<MessageSquare className="size-4" aria-hidden="true" />}
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
                  <Button variant="outline" onClick={() => runTest("whatsapp")} aria-label="Send WhatsApp test">
                    <Send className="size-4" aria-hidden="true" /> Send test
                  </Button>
                  <TestChip result={tests.whatsapp} />
                </div>
              </div>
            </SectionCard>
          </div>
        </TabsContent>

        {/* ============================ LOGS & AUDIT ============================ */}
        <TabsContent value="logs" className="mt-4">
          <SectionCard
            title="Logs &amp; audit"
            description="Activity trail verbosity and retention for the audit view."
            icon={<ScrollText className="size-4" aria-hidden="true" />}
          >
            <div className="grid gap-4">
              <SwitchRow
                id="s-logs-enabled"
                label="Enable activity logging"
                hint="Records admin actions, dispatches, settings changes and more."
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
            </div>
          </SectionCard>
        </TabsContent>

        {/* ========================= LANGUAGE & REGION ========================== */}
        <TabsContent value="region" className="mt-4">
          <SectionCard
            title="Language &amp; region"
            description="Defaults used across public pages and formatted dates."
            icon={<Languages className="size-4" aria-hidden="true" />}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="s-app-lang" label="Default language" hint="Default language for public pages. Volunteers can still switch.">
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
          </SectionCard>
        </TabsContent>

        {/* ===================== RECEIPTS & CERTIFICATES ======================== */}
        <TabsContent value="receipts" className="mt-4">
          <SectionCard
            title="Receipts &amp; certificates"
            description="Signature block printed on 80G receipts and donor certificates."
            icon={<ReceiptText className="size-4" aria-hidden="true" />}
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
            title="AI assistant"
            description="Model powering the in-app assistant widget for staff and donors."
            icon={<Bot className="size-4" aria-hidden="true" />}
          >
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
              Only the changed keys are written. Secrets stay masked.
            </p>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={reset} aria-label="Reset changes">
                <RotateCcw className="size-4" aria-hidden="true" /> Reset
              </Button>
              <Button onClick={save} disabled={saving} aria-label="Save settings">
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
