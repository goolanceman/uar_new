/**
 * notify — REAL outbound transports for settings-driven integrations.
 *
 * Everything here reads its credentials from the Setting table (see
 * settings-core for canonical keys) and respects the matching feature flags:
 * when a channel is disabled or unconfigured the senders are silent no-ops
 * that return a skipped result instead of throwing — outbound messaging must
 * never break the main flow.
 *
 * Channel contracts:
 *  - Email   : SMTP via nodemailer (notify.email.*)
 *  - SMS     : Twilio REST · MSG91 flow API · generic webhook (notify.sms.*)
 *  - WhatsApp: Meta Cloud API · Twilio (notify.whatsapp.*)
 *  - Gateway : Razorpay · Stripe · Cashfree REST (finance.gateway*)
 */
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { isFlagOn, type SettingsMap } from "@/lib/settings-core";

export interface ChannelResult {
  ok: boolean;
  skipped?: boolean;
  latencyMs: number;
  message: string;
}

const HTTP_TIMEOUT_MS = 10_000;

/* ─────────────────────────── settings loading ──────────────────────────── */

/** Reads the whole Setting table once into a flat map (raw values incl. secrets). */
export async function loadSettings(): Promise<SettingsMap> {
  const rows = await db.setting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/* ──────────────────────────────── email ────────────────────────────────── */

export interface EmailConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  fromName: string;
  username: string;
  password: string;
  replyTo: string;
}

export function emailConfig(map: SettingsMap): EmailConfig {
  return {
    enabled: isFlagOn(map["notify.email.enabled"]),
    host: (map["notify.email.host"] ?? "").trim(),
    port: Number(map["notify.email.port"] ?? "587") || 587,
    secure: isFlagOn(map["notify.email.secure"]),
    from: (map["notify.email.from"] ?? "").trim(),
    fromName: (map["notify.email.fromName"] ?? "").trim() || "United Angel Reach",
    username: (map["notify.email.username"] ?? "").trim(),
    password: (map["notify.email.password"] ?? "").trim(),
    replyTo: (map["notify.email.replyTo"] ?? "").trim(),
  };
}

export function emailConfigured(cfg: EmailConfig): boolean {
  return Boolean(cfg.host && cfg.from);
}

/** Sends one email through the configured SMTP server. Returns skipped when disabled/unconfigured. */
export async function sendEmail(
  map: SettingsMap,
  opts: { to: string; subject: string; html: string; text?: string }
): Promise<ChannelResult> {
  const t0 = Date.now();
  const cfg = emailConfig(map);
  if (!cfg.enabled)
    return { ok: false, skipped: true, latencyMs: 0, message: "Email notifications are disabled in Settings." };
  if (!emailConfigured(cfg))
    return { ok: false, skipped: true, latencyMs: 0, message: "SMTP host or From address is not configured." };

  try {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
      connectionTimeout: HTTP_TIMEOUT_MS,
      greetingTimeout: HTTP_TIMEOUT_MS,
    });
    const info = await transport.sendMail({
      from: `"${cfg.fromName}" <${cfg.from}>`,
      replyTo: cfg.replyTo || undefined,
      to: opts.to,
      subject: opts.subject,
      text: opts.text ?? opts.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      html: opts.html,
    });
    return { ok: true, latencyMs: Date.now() - t0, message: `Accepted by SMTP (${info.messageId})` };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      message: e instanceof Error ? e.message : "SMTP send failed",
    };
  }
}

/** Real SMTP connectivity + auth check used by /api/settings/test. */
export async function verifyEmail(map: SettingsMap): Promise<ChannelResult> {
  const t0 = Date.now();
  const cfg = emailConfig(map);
  if (!cfg.host) return { ok: false, latencyMs: 0, message: "Set an SMTP host first (Settings → Email)." };
  try {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
      connectionTimeout: HTTP_TIMEOUT_MS,
      greetingTimeout: HTTP_TIMEOUT_MS,
    });
    await transport.verify();
    return { ok: true, latencyMs: Date.now() - t0, message: `SMTP ${cfg.host}:${cfg.port} connected and authenticated.` };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      message: e instanceof Error ? e.message : "SMTP connection failed",
    };
  }
}

/* ──────────────────────────────── SMS ──────────────────────────────────── */

export interface SmsConfig {
  enabled: boolean;
  provider: string;
  senderId: string;
  accountId: string;
  endpoint: string;
  apiKey: string;
  templateId: string;
}

export function smsConfig(map: SettingsMap): SmsConfig {
  return {
    enabled: isFlagOn(map["notify.sms.enabled"]),
    provider: (map["notify.sms.provider"] ?? "TWILIO").toUpperCase(),
    senderId: (map["notify.sms.senderId"] ?? "").trim(),
    accountId: (map["notify.sms.accountId"] ?? "").trim(),
    endpoint: (map["notify.sms.endpoint"] ?? "").trim(),
    apiKey: (map["notify.sms.apiKey"] ?? "").trim(),
    templateId: (map["notify.sms.templateId"] ?? "").trim(),
  };
}

export function smsConfigured(cfg: SmsConfig): boolean {
  if (cfg.provider === "TWILIO") return Boolean(cfg.accountId && cfg.apiKey);
  return Boolean(cfg.endpoint && cfg.apiKey);
}

/** Normalises an Indian/international number to E.164 for provider APIs. */
function e164(phone: string, fallbackCountry = "+91"): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `${fallbackCountry}${digits}`;
  return `+${digits}`;
}

export async function sendSms(
  map: SettingsMap,
  opts: { to: string; text: string }
): Promise<ChannelResult> {
  const t0 = Date.now();
  const cfg = smsConfig(map);
  if (!cfg.enabled)
    return { ok: false, skipped: true, latencyMs: 0, message: "SMS notifications are disabled in Settings." };
  if (!smsConfigured(cfg))
    return { ok: false, skipped: true, latencyMs: 0, message: `SMS provider ${cfg.provider} is missing credentials.` };

  const to = e164(opts.to);
  try {
    if (cfg.provider === "TWILIO") {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountId)}/Messages.json`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${cfg.accountId}:${cfg.apiKey}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: cfg.senderId || to, Body: opts.text }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      if (!res.ok) throw new Error(body.message ?? `Twilio HTTP ${res.status}`);
      return { ok: true, latencyMs: Date.now() - t0, message: `SMS sent (sid ${body.sid ?? "ok"})` };
    }

    if (cfg.provider === "MSG91") {
      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { authkey: cfg.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: cfg.senderId,
          template_id: cfg.templateId || undefined,
          mobiles: to,
          MESSAGE: opts.text,
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`MSG91 HTTP ${res.status}`);
      return { ok: true, latencyMs: Date.now() - t0, message: "SMS accepted by MSG91" };
    }

    // GENERIC — POST JSON { to, text, sender } to the configured endpoint.
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, text: opts.text, sender: cfg.senderId }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`SMS gateway HTTP ${res.status}`);
    return { ok: true, latencyMs: Date.now() - t0, message: "SMS accepted by gateway" };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, message: e instanceof Error ? e.message : "SMS send failed" };
  }
}

/** Provider connectivity check used by /api/settings/test. */
export async function verifySms(map: SettingsMap): Promise<ChannelResult> {
  const t0 = Date.now();
  const cfg = smsConfig(map);
  if (cfg.provider === "TWILIO") {
    if (!cfg.accountId || !cfg.apiKey)
      return { ok: false, latencyMs: 0, message: "Set the Twilio Account SID and auth token first." };
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountId)}.json`, {
        headers: { Authorization: `Basic ${Buffer.from(`${cfg.accountId}:${cfg.apiKey}`).toString("base64")}` },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 404) throw new Error("Twilio rejected the credentials (check SID/auth token).");
      if (!res.ok) throw new Error(`Twilio HTTP ${res.status}`);
      return { ok: true, latencyMs: Date.now() - t0, message: "Twilio credentials verified." };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, message: e instanceof Error ? e.message : "Twilio check failed" };
    }
  }
  if (!cfg.endpoint || !cfg.apiKey)
    return { ok: false, latencyMs: 0, message: "Set the SMS endpoint and API key first." };
  try {
    const res = await fetch(cfg.endpoint, {
      method: "HEAD",
      headers: { authkey: cfg.apiKey, Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return {
      ok: true,
      latencyMs: Date.now() - t0,
      message: `Endpoint reachable (HTTP ${res.status}).`,
    };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, message: e instanceof Error ? e.message : "Endpoint unreachable" };
  }
}

/* ────────────────────────────── WhatsApp ───────────────────────────────── */

export interface WhatsAppConfig {
  enabled: boolean;
  provider: string;
  number: string;
  phoneId: string;
  apiKey: string;
}

export function whatsappConfig(map: SettingsMap): WhatsAppConfig {
  return {
    enabled: isFlagOn(map["notify.whatsapp.enabled"]),
    provider: (map["notify.whatsapp.provider"] ?? "CLOUD").toUpperCase(),
    number: (map["notify.whatsapp.number"] ?? "").trim(),
    phoneId: (map["notify.whatsapp.phoneId"] ?? "").trim(),
    apiKey: (map["notify.whatsapp.apiKey"] ?? "").trim(),
  };
}

export async function sendWhatsApp(
  map: SettingsMap,
  opts: { to: string; text: string }
): Promise<ChannelResult> {
  const t0 = Date.now();
  const cfg = whatsappConfig(map);
  if (!cfg.enabled)
    return { ok: false, skipped: true, latencyMs: 0, message: "WhatsApp notifications are disabled in Settings." };
  if (!cfg.apiKey || (cfg.provider === "CLOUD" && !cfg.phoneId))
    return { ok: false, skipped: true, latencyMs: 0, message: "WhatsApp is missing the API token or phone number ID." };

  const to = e164(opts.to);
  try {
    if (cfg.provider === "CLOUD") {
      const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(cfg.phoneId)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: opts.text },
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `WhatsApp Cloud API HTTP ${res.status}`);
      return { ok: true, latencyMs: Date.now() - t0, message: "WhatsApp message accepted" };
    }
    // TWILIO — sends a WhatsApp message using the SMS credentials + whatsapp: prefix.
    const sms = smsConfig(map);
    const from = cfg.number || sms.senderId;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sms.accountId)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sms.accountId}:${sms.apiKey || cfg.apiKey}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: `whatsapp:${to}`,
        From: `whatsapp:${from}`,
        Body: opts.text,
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Twilio WhatsApp HTTP ${res.status}`);
    return { ok: true, latencyMs: Date.now() - t0, message: "WhatsApp message accepted (Twilio)" };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, message: e instanceof Error ? e.message : "WhatsApp send failed" };
  }
}

export async function verifyWhatsApp(map: SettingsMap): Promise<ChannelResult> {
  const t0 = Date.now();
  const cfg = whatsappConfig(map);
  if (cfg.provider === "CLOUD") {
    if (!cfg.phoneId || !cfg.apiKey)
      return { ok: false, latencyMs: 0, message: "Set the WhatsApp Business phone number ID and access token first." };
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(cfg.phoneId)}`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (res.status === 401) throw new Error("WhatsApp access token rejected.");
      if (!res.ok) throw new Error(`WhatsApp Cloud API HTTP ${res.status}`);
      const body = (await res.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string };
      return {
        ok: true,
        latencyMs: Date.now() - t0,
        message: `Cloud API verified${body.display_phone_number ? ` for ${body.display_phone_number}` : ""}.`,
      };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, message: e instanceof Error ? e.message : "WhatsApp check failed" };
    }
  }
  // TWILIO — reuse the SMS account ping.
  return verifySms(map);
}

/* ─────────────────────────── payment gateway ───────────────────────────── */

export interface GatewayConfig {
  enabled: boolean;
  provider: string;
  testMode: boolean;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  cashfreeAppId: string;
}

export function gatewayConfig(map: SettingsMap): GatewayConfig {
  return {
    enabled: isFlagOn(map["finance.gatewayEnabled"]),
    provider: (map["finance.gatewayProvider"] ?? "RAZORPAY").toUpperCase(),
    testMode: isFlagOn(map["finance.gatewayTestMode"]),
    keyId: (map["finance.razorpayKeyId"] ?? "").trim(),
    keySecret: (map["finance.gatewayKeySecret"] ?? "").trim(),
    webhookSecret: (map["finance.gatewayWebhookSecret"] ?? "").trim(),
    cashfreeAppId: (map["finance.cashfreeAppId"] ?? "").trim(),
  };
}

/** Gateway credential check used by /api/settings/test (read-only API call). */
export async function verifyGateway(map: SettingsMap): Promise<ChannelResult> {
  const t0 = Date.now();
  const cfg = gatewayConfig(map);
  if (!cfg.enabled)
    return { ok: false, latencyMs: 0, message: "The gateway is disabled — enable it in Settings → Feature flags." };

  try {
    if (cfg.provider === "RAZORPAY") {
      if (!cfg.keyId || !cfg.keySecret) throw new Error("Set the Razorpay key ID and key secret first.");
      const res = await fetch("https://api.razorpay.com/v1/payments?count=1", {
        headers: { Authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}` },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (res.status === 401) throw new Error("Razorpay rejected the key id/secret.");
      if (!res.ok) throw new Error(`Razorpay HTTP ${res.status}`);
      return { ok: true, latencyMs: Date.now() - t0, message: `Razorpay credentials verified (${cfg.testMode ? "test" : "live"} mode).` };
    }
    if (cfg.provider === "STRIPE") {
      if (!cfg.keySecret) throw new Error("Set the Stripe secret key first.");
      const res = await fetch("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${cfg.keySecret}` },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (res.status === 401) throw new Error("Stripe rejected the secret key.");
      if (!res.ok) throw new Error(`Stripe HTTP ${res.status}`);
      return { ok: true, latencyMs: Date.now() - t0, message: `Stripe credentials verified (${cfg.testMode ? "test" : "live"} mode).` };
    }
    if (cfg.provider === "CASHFREE") {
      if (!cfg.cashfreeAppId || !cfg.keySecret) throw new Error("Set the Cashfree app ID and secret key first.");
      const base = cfg.testMode ? "https://sandbox.cashfree.com" : "https://api.cashfree.com";
      const res = await fetch(`${base}/pg/orders`, {
        method: "POST",
        headers: {
          "x-client-id": cfg.cashfreeAppId,
          "x-client-secret": cfg.keySecret,
          "x-api-version": "2023-08-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) throw new Error("Cashfree rejected the app credentials.");
      return { ok: true, latencyMs: Date.now() - t0, message: `Cashfree endpoint reachable (${cfg.testMode ? "sandbox" : "production"}).` };
    }
    return { ok: false, latencyMs: 0, message: `${cfg.provider} online checkout is not configured — use Razorpay, Stripe or Cashfree.` };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, message: e instanceof Error ? e.message : "Gateway check failed" };
  }
}

/* ────────────────────── high-level notification helpers ────────────────── */

/** Branded HTML shell for transactional email. */
export function emailShell(title: string, bodyHtml: string, org: { name: string; logoUrl?: string; footer?: string }): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f4f6f5;font-family:Segoe UI,Arial,sans-serif;color:#101a16;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8e6;">
    <div style="padding:20px 24px;background:#064e3b;color:#fff;">
      <strong style="font-size:16px;">${org.name}</strong>
      <div style="font-size:12px;opacity:.8;">${title}</div>
    </div>
    <div style="padding:24px;">${bodyHtml}</div>
    <div style="padding:16px 24px;background:#f0f4f2;font-size:11px;color:#5b6b66;border-top:1px solid #e2e8e6;">
      ${org.footer ?? "Sent by the United Angel Reach volunteer & donor platform."}
    </div>
  </div></body></html>`;
}

export interface NotifyOutcome {
  email?: ChannelResult;
  sms?: ChannelResult;
  whatsapp?: ChannelResult;
}

/**
 * Fan-out one notification over every enabled channel (email + SMS + WhatsApp).
 * Never throws — failures are logged to console and returned.
 */
async function fanOut(
  map: SettingsMap,
  channels: { email?: { to: string; subject: string; html: string }; sms?: { to: string; text: string }; whatsapp?: { to: string; text: string } }
): Promise<NotifyOutcome> {
  const out: NotifyOutcome = {};
  await Promise.all([
    channels.email ? sendEmail(map, channels.email).then((r) => (out.email = r)) : null,
    channels.sms ? sendSms(map, channels.sms).then((r) => (out.sms = r)) : null,
    channels.whatsapp ? sendWhatsApp(map, channels.whatsapp).then((r) => (out.whatsapp = r)) : null,
  ]);
  for (const r of [out.email, out.sms, out.whatsapp]) {
    if (r && !r.ok && !r.skipped) console.error("[notify] channel failure:", r.message);
  }
  return out;
}

/** Donor acknowledgement for a completed donation (email + SMS + WhatsApp). */
export async function notifyDonation(
  map: SettingsMap,
  org: { name: string; footer?: string },
  d: { donorName: string; donorEmail: string; donorPhone?: string | null; amount: number; currency: string; receiptNumber: string; campaign?: string | null }
): Promise<NotifyOutcome> {
  const { formatMoney, currencyUnitName } = await import("@/lib/settings-core");
  const lines = `<p style="margin:0 0 8px;">Dear ${d.donorName || "friend"},</p>
  <p style="margin:0 0 12px;">Thank you for your generous gift of <strong>${formatMoney(d.amount, d.currency)}</strong>.
  Your 80G receipt number is <strong>${d.receiptNumber}</strong>${d.campaign ? ` for “${d.campaign}”` : ""}.</p>
  <p style="margin:0 0 12px;">Amount in words: ${currencyUnitName(d.currency).name} — receipt available on your donor portal.</p>`;
  const html = emailShell("Donation received", lines, org);
  const text = `Thank you! We received ${formatMoney(d.amount, d.currency)} (receipt ${d.receiptNumber}). — ${org.name}`;
  return fanOut(map, {
    email: d.donorEmail ? { to: d.donorEmail, subject: `Thank you for your donation — ${d.receiptNumber}`, html } : undefined,
    sms: d.donorPhone ? { to: d.donorPhone, text } : undefined,
    whatsapp: d.donorPhone ? { to: d.donorPhone, text } : undefined,
  });
}

/** Acknowledge a public contact query. */
export async function notifyContactQuery(
  map: SettingsMap,
  org: { name: string; footer?: string },
  q: { name: string; email: string }
): Promise<NotifyOutcome> {
  const html = emailShell(
    "We received your message",
    `<p style="margin:0 0 8px;">Dear ${q.name},</p><p style="margin:0;">Thank you for reaching out to ${org.name}. Our team replies within one working day.</p>`,
    org
  );
  return fanOut(map, {
    email: { to: q.email, subject: `We received your message — ${org.name}`, html },
  });
}
