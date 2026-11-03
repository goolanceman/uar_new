import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireRole, ApiError, json, handleError, logActivity } from "@/lib/session";

export const dynamic = "force-dynamic";

const SECRET_PATTERN = /(secret|password|apikey|api_key|token|credential)/i;

/** Non-secret default values — merged into GET responses for keys that the
 * admin has not customised yet, so every consumer sees a complete map. */
const DEFAULT_SETTINGS: Record<string, string> = {
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

function isSecretKey(key: string): boolean {
  return SECRET_PATTERN.test(key);
}

function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `${value.slice(0, 2)}${"•".repeat(Math.min(12, value.length - 4))}${value.slice(-2)}`;
}

function project(rows: { key: string; value: string; isSecret: boolean }[]): Record<string, string> {
  const out: Record<string, string> = {};
  // Start from defaults, then overlay stored rows (DB always wins).
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    out[key] = isSecretKey(key) ? maskValue(value) : value;
  }
  for (const r of rows) {
    out[r.key] = r.isSecret || isSecretKey(r.key) ? maskValue(r.value) : r.value;
  }
  return out;
}

// GET /api/settings — flat {key: value} merged with defaults (ADMIN only);
// secrets are masked and never echoed in plaintext.
export async function GET() {
  try {
    await requireRole("ADMIN");
    const rows = await db.setting.findMany({ orderBy: { key: "asc" } });
    return json(project(rows));
  } catch (e) {
    return handleError(e);
  }
}

// PATCH /api/settings — flat {key: value, …} → upsert each (secrets stored as-is)
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole("ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const entries = Object.entries(body ?? {}).filter(
      ([key]) => key && typeof key === "string"
    );
    if (entries.length === 0) throw new ApiError("Nothing to update", 400);

    for (const [key, raw] of entries) {
      const value = raw === null || raw === undefined ? "" : String(raw);
      const secret = isSecretKey(key);
      await db.setting.upsert({
        where: { key },
        create: { key, value, isSecret: secret },
        update: { value, isSecret: secret },
      });
    }

    await logActivity(
      session.name,
      "SETTINGS_UPDATE",
      "SETTING",
      entries.map(([k]) => (isSecretKey(k) ? `${k}=***` : k)).join(", ").slice(0, 200),
      session.userId
    );

    const rows = await db.setting.findMany({ orderBy: { key: "asc" } });
    return json(project(rows));
  } catch (e) {
    return handleError(e);
  }
}
