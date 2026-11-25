/**
 * settings-core — SINGLE SOURCE OF TRUTH for the settings subsystem.
 *
 * Server AND client safe (zero side-effects, no imports). Everything that
 * needs the list of setting keys, defaults, secret classification, per-key
 * validation, the currency catalog or feature-flag helpers MUST import from
 * here — duplicating these maps in views/routes/seeds is forbidden.
 *
 * Owned by the settings coordinator; contract changes are co-ordinated.
 */

export type SettingsMap = Record<string, string>;

/* ═════════════════════════════ canonical defaults ═════════════════════════ */

/** Every canonical setting key with its default. DB rows always win. */
export const SETTING_DEFAULTS: SettingsMap = {
  // Organisation identity
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
  // Branding
  "brand.logoUrl": "/logo_uar_final_emerald.svg",
  "brand.faviconUrl": "/logo_uar_final_emerald.svg",
  // Finance & payments
  "finance.fyStartMonth": "4",
  "finance.upiId": "",
  "finance.gatewayProvider": "RAZORPAY",
  "finance.razorpayKeyId": "",
  "finance.stripeKeyId": "",
  "finance.cashfreeAppId": "",
  "finance.gatewayKeySecret": "",
  "finance.gatewayWebhookSecret": "",
  "finance.gatewayTestMode": "true",
  "finance.gatewayEnabled": "false",
  "finance.currency": "INR",
  "payments.gst": "",
  // Email (SMTP)
  "notify.email.enabled": "false",
  "notify.email.host": "",
  "notify.email.port": "587",
  "notify.email.from": "",
  "notify.email.fromName": "United Angel Reach",
  "notify.email.secure": "false",
  "notify.email.username": "",
  "notify.email.password": "",
  "notify.email.replyTo": "",
  // SMS
  "notify.sms.enabled": "false",
  "notify.sms.provider": "TWILIO",
  "notify.sms.senderId": "",
  "notify.sms.accountId": "",
  "notify.sms.endpoint": "",
  "notify.sms.apiKey": "",
  "notify.sms.templateId": "",
  // WhatsApp
  "notify.whatsapp.enabled": "false",
  "notify.whatsapp.provider": "CLOUD",
  "notify.whatsapp.number": "",
  "notify.whatsapp.phoneId": "",
  "notify.whatsapp.apiKey": "",
  // Storage
  "storage.provider": "S3",
  "storage.bucket": "",
  "storage.region": "",
  "storage.accessKey": "",
  "storage.cdnBase": "",
  // Webhooks
  "webhooks.url": "",
  "webhooks.events": "",
  "webhooks.secret": "",
  // Analytics
  "analytics.ga4Id": "",
  "analytics.metaPixel": "",
  // Captcha & maps
  "captcha.provider": "NONE",
  "captcha.siteKey": "",
  "captcha.secretKey": "",
  "maps.provider": "GOOGLE",
  "maps.apiKey": "",
  // Kits
  "kits.qrBaseUrl": "",
  // Logs & audit
  "logs.enabled": "true",
  "logs.level": "INFO",
  "logs.retentionDays": "90",
  "logs.track.logins": "true",
  "logs.track.donations": "true",
  "logs.track.distributions": "true",
  "logs.track.adminEdits": "true",
  // Region & system
  "app.language": "en",
  "app.timezone": "Asia/Kolkata",
  "app.maintenance": "false",
  // Receipts
  "receipts.signatoryName": "",
  "receipts.signatoryRole": "Trustee",
  "receipts.prefix": "UAR-RCPT",
  "receipts.footer": "",
  // Assistant & matching
  "assist.enabled": "true",
  "assist.model": "glm-4.6",
  "matching.enabled": "true",
  "matching.donorCategory": "MONTHLY",
  "matching.minMonthlyAmount": "500",
  "matching.maxActivePerDonor": "3",
  // Food Security & Community Nutrition (docs/food.md round 3)
  "food.applications.rateLimitPerHour": "5",
  "food.statusCheck.rateLimitPerHour": "20",
  "food.pledges.rateLimitPerHour": "5",
  "food.expiryAlertDays": "14",
  "food.aiRiskWindowDays": "21",
  // Public feature flags (donate page / public site)
  "features.currencySwitcher": "true",
  "features.recurringDonations": "true",
  "features.anonymousDonations": "true",
  "features.liveDonationFeed": "false",
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;

/* ═════════════════════════════ secret handling ════════════════════════════ */

/** Explicit secret keys — always masked in API responses, never echoed. */
export const SECRET_KEYS: ReadonlySet<string> = new Set([
  "finance.gatewayKeySecret",
  "finance.gatewayWebhookSecret",
  "notify.email.password",
  "notify.sms.apiKey",
  "notify.whatsapp.apiKey",
  "captcha.secretKey",
  "maps.apiKey",
  "webhooks.secret",
  "storage.accessKey",
]);

/** Fallback heuristic for keys not in the explicit list. */
const SECRET_PATTERN = /(secret|password|apikey|api_key|token|credential)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key) || SECRET_PATTERN.test(key);
}

export function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `${value.slice(0, 2)}${"•".repeat(Math.min(12, value.length - 4))}${value.slice(-2)}`;
}

/** Keys that must ALSO be published on /api/settings/public when enabled. */
export const PUBLIC_EXTRA_KEYS: ReadonlySet<string> = new Set([
  "finance.currency",
  "finance.gatewayEnabled",
  "finance.gatewayProvider",
  "finance.razorpayKeyId",
  "finance.stripeKeyId",
]);

/* ═══════════════════════════ per-key validation ═══════════════════════════ */

const ENUMS: Record<string, string[]> = {
  "finance.gatewayProvider": ["RAZORPAY", "STRIPE", "CASHFREE", "PAYU"],
  "storage.provider": ["S3", "GCS", "AZURE", "LOCAL"],
  "captcha.provider": ["NONE", "RECAPTCHA", "TURNSTILE", "HCAPTCHA"],
  "maps.provider": ["GOOGLE", "OSM", "MAPBOX"],
  "notify.sms.provider": ["TWILIO", "MSG91", "GENERIC"],
  "notify.whatsapp.provider": ["CLOUD", "TWILIO"],
  "logs.level": ["DEBUG", "INFO", "WARN", "ERROR"],
};

const BOOLEANS = new Set(
  Object.entries(SETTING_DEFAULTS)
    .filter(([, v]) => v === "true" || v === "false")
    .map(([k]) => k)
);

const NUMBER_RANGES: Record<string, [number, number]> = {
  "finance.fyStartMonth": [1, 12],
  "logs.retentionDays": [1, 3650],
  "matching.minMonthlyAmount": [0, 10_000_000],
  "matching.maxActivePerDonor": [1, 50],
  "notify.email.port": [1, 65535],
  "food.applications.rateLimitPerHour": [1, 1000],
  "food.statusCheck.rateLimitPerHour": [1, 5000],
  "food.pledges.rateLimitPerHour": [1, 1000],
  "food.expiryAlertDays": [1, 365],
  "food.aiRiskWindowDays": [1, 365],
};

const URL_KEYS = new Set(["brand.logoUrl", "brand.faviconUrl", "org.website", "storage.cdnBase", "webhooks.url", "kits.qrBaseUrl"]);

export const SUPPORTED_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी (Hindi)" },
  { code: "kn", label: "ಕನ್ನಡ (Kannada)" },
];

/**
 * Validates one setting value. Returns a human-readable error or null.
 * Used by the PATCH endpoint (server) and the settings view (client) —
 * one implementation, zero drift.
 */
export function validateSettingValue(key: string, value: string): string | null {
  const v = (value ?? "").trim();
  if (BOOLEANS.has(key) && v !== "" && v !== "true" && v !== "false")
    return `${key} must be "true" or "false".`;
  if (v === "") return null; // empty is always allowed (clears the key)

  if (ENUMS[key] && !ENUMS[key].includes(v))
    return `${key} must be one of: ${ENUMS[key].join(", ")}.`;

  if (NUMBER_RANGES[key]) {
    const [min, max] = NUMBER_RANGES[key];
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max || !Number.isInteger(n))
      return `${key} must be a whole number between ${min} and ${max}.`;
  }

  if (URL_KEYS.has(key) && !/^(https?:\/\/|\/)\S+$/.test(v))
    return `${key} must start with http://, https:// or / (for local assets).`;

  if (key === "org.email" && !/^\S+@\S+\.\S+$/.test(v)) return "Enter a valid email address.";
  if (key === "notify.email.from" && !/^\S+@\S+\.\S+$/.test(v)) return "From address must be a valid email.";
  if (key === "notify.email.replyTo" && !/^\S+@\S+\.\S+$/.test(v)) return "Reply-To must be a valid email.";
  if (key === "finance.upiId" && !/^[\w.\-]{2,}@[a-zA-Z]{2,}[\w.\-]*$/.test(v))
    return "UPI ID must look like name@bank (e.g. unitedangelreach@okhdfcbank).";
  if (key === "finance.currency" && !CURRENCY_CODES.includes(v))
    return "Currency must be one of the supported ISO 4217 codes.";
  if (key === "receipts.prefix" && !/^[A-Z0-9-]{2,12}$/.test(v))
    return "Receipt prefix must be 2-12 characters: A-Z, 0-9 and dashes only.";
  if (key === "analytics.ga4Id" && !/^G-[A-Z0-9]+$/i.test(v))
    return "GA4 measurement ID must look like G-XXXXXXXXXX.";
  if (key === "app.language" && !SUPPORTED_LANGUAGES.some((l) => l.code === v))
    return "Language must be one of: en, hi, kn.";
  return null;
}

/* ═════════════════════════ section → keys mapping ═════════════════════════ */

/** Which settings card owns which keys (prefix rules). Shared client/server. */
export const SECTION_PREFIXES: Record<string, string[]> = {
  org: ["org.", "brand.", "finance.fyStartMonth"],
  payments: ["finance.upiId", "finance.currency", "finance.gateway", "finance.razorpayKeyId", "finance.stripeKeyId", "finance.cashfreeAppId", "payments.gst"],
  email: ["notify.email."],
  sms: ["notify.sms.", "notify.whatsapp."],
  storage: ["storage."],
  webhooks: ["webhooks."],
  analytics: ["analytics.", "captcha.", "maps."],
  system: ["kits.", "app.maintenance"],
  logs: ["logs."],
  region: ["app.language", "app.timezone"],
  receipts: ["receipts."],
  assistant: ["assist."],
  matching: ["matching."],
  food: ["food."],
  flags: ["features.", "finance.gatewayEnabled", "notify.email.enabled", "notify.sms.enabled", "notify.whatsapp.enabled", "assist.enabled", "matching.enabled", "logs.enabled", "app.maintenance"],
};

export function keysForSection(section: string, keys: string[]): string[] {
  const rules = SECTION_PREFIXES[section];
  if (!rules) return [];
  return keys.filter((k) => rules.some((r) => (r.endsWith(".") ? k.startsWith(r) : k === r)));
}

/* ═════════════════════════════ feature flags ══════════════════════════════ */

export interface FlagDoc {
  key: string;
  label: string;
  description: string;
  /** Where the flag takes effect, so admins know what toggling changes. */
  effect: string;
}

/** Catalog of every boolean flag + what it gates (rendered by the flags tab). */
export const FLAG_CATALOG: FlagDoc[] = [
  { key: "finance.gatewayEnabled", label: "Online payment gateway", description: "Accept card / net-banking / wallet payments through the configured gateway.", effect: "Adds the card/net-banking option to the Donate page; UPI stays available." },
  { key: "notify.email.enabled", label: "Email notifications", description: "Send transactional email (donation thank-yous, volunteer updates) via SMTP.", effect: "Requires SMTP host + credentials; use the Test button to verify." },
  { key: "notify.sms.enabled", label: "SMS notifications", description: "Send SMS alerts through the configured provider.", effect: "Donor acknowledgements and volunteer alerts go out by SMS." },
  { key: "notify.whatsapp.enabled", label: "WhatsApp notifications", description: "Send WhatsApp updates through WhatsApp Cloud API or Twilio.", effect: "Donor acknowledgements go out on WhatsApp where a number is captured." },
  { key: "features.currencySwitcher", label: "Currency switcher", description: "Let donors choose their currency on the Donate page.", effect: "Shows the currency dropdown; UPI remains INR-only as required by the rails." },
  { key: "features.recurringDonations", label: "Recurring donations", description: "Offer monthly giving on the Donate page and enable the matching engine.", effect: "Monthly option in the donate wizard; recurring-needs matching runs." },
  { key: "features.anonymousDonations", label: "Anonymous donations", description: "Allow donors to hide their name on public campaign pages.", effect: "Anonymity toggle appears in the donate wizard." },
  { key: "features.liveDonationFeed", label: "Live donation broadcast", description: "Broadcast a real-time toast (bottom-left) to every connected visitor when someone donates.", effect: "Visitors see live thank-you cards as donations come in; stream is disabled when off." },
  { key: "assist.enabled", label: "AI assistant", description: "The Seva Sahayak assistant widget on public and portal pages.", effect: "Hides/shows the floating assistant everywhere." },
  { key: "matching.enabled", label: "Recurring matching engine", description: "Auto-match recurring donors to recurring needs.", effect: "The Recurring Matching tab's engine runs when enabled." },
  { key: "logs.enabled", label: "Activity logging", description: "Record an audit trail of admin and system actions.", effect: "Activity log rows are written; per-event toggles below still apply." },
  { key: "app.maintenance", label: "Maintenance banner", description: "Show a maintenance notice on the public site.", effect: "Displays a dismissible banner on all public pages." },
];

export function isFlagOn(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

/** Extract the public feature-flag subset from a settings map. */
export function publicFeatures(map: SettingsMap): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const doc of FLAG_CATALOG) {
    if (doc.key.startsWith("features.") || doc.key === "finance.gatewayEnabled" || doc.key === "assist.enabled" || doc.key === "app.maintenance") {
      out[doc.key] = isFlagOn(map[doc.key] ?? SETTING_DEFAULTS[doc.key]);
    }
  }
  return out;
}

/* ═════════════════════════════ currency catalog ═══════════════════════════ */

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  locale: string;
}

/** Supported display currencies (donation amounts are stored in the chosen currency). */
export const CURRENCIES: readonly Currency[] = [
  { code: "INR", name: "Indian Rupee", symbol: "₹", decimals: 2, locale: "en-IN" },
  { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, locale: "en-US" },
  { code: "EUR", name: "Euro", symbol: "€", decimals: 2, locale: "de-DE" },
  { code: "GBP", name: "British Pound", symbol: "£", decimals: 2, locale: "en-GB" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", decimals: 2, locale: "en-AE" },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼", decimals: 2, locale: "en-SA" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", decimals: 2, locale: "en-SG" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", decimals: 2, locale: "en-AU" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", decimals: 2, locale: "en-CA" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", decimals: 2, locale: "de-CH" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", decimals: 0, locale: "ja-JP" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", decimals: 2, locale: "zh-CN" },
  { code: "NPR", name: "Nepalese Rupee", symbol: "रू", decimals: 2, locale: "en-IN" },
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "Rs", decimals: 2, locale: "en-IN" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", decimals: 2, locale: "ms-MY" },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", decimals: 2, locale: "en-HK" },
  { code: "ZAR", name: "South African Rand", symbol: "R", decimals: 2, locale: "en-ZA" },
  { code: "KWD", name: "Kuwaiti Dinar", symbol: "KD", decimals: 3, locale: "en-KW" },
  { code: "QAR", name: "Qatari Riyal", symbol: "QR", decimals: 2, locale: "en-QA" },
  { code: "OMR", name: "Omani Rial", symbol: "﷼", decimals: 3, locale: "en-OM" },
  { code: "BHD", name: "Bahraini Dinar", symbol: "BD", decimals: 3, locale: "en-BH" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$", decimals: 2, locale: "en-NZ" },
];

export const CURRENCY_CODES: readonly string[] = CURRENCIES.map((c) => c.code);
export const DEFAULT_CURRENCY = "INR";

export function getCurrency(code: string | undefined | null): Currency {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

/** Intl-based money formatting for any catalog currency. */
export function formatMoney(amount: number | string | null | undefined, code: string = DEFAULT_CURRENCY): string {
  const n = Number(amount ?? 0);
  const cur = getCurrency(code);
  if (Number.isNaN(n)) return `${cur.symbol}0`;
  return new Intl.NumberFormat(cur.locale, {
    style: "currency",
    currency: cur.code,
    maximumFractionDigits: cur.decimals,
  }).format(n);
}

/** Currency words for receipts, e.g. { name: "Rupees", sub: "Paise" }. */
export function currencyUnitName(code: string = DEFAULT_CURRENCY): { name: string; sub: string } {
  const map: Record<string, { name: string; sub: string }> = {
    INR: { name: "Rupees", sub: "Paise" },
    USD: { name: "US Dollars", sub: "Cents" },
    EUR: { name: "Euros", sub: "Cents" },
    GBP: { name: "Pounds Sterling", sub: "Pence" },
    AUD: { name: "Australian Dollars", sub: "Cents" },
    CAD: { name: "Canadian Dollars", sub: "Cents" },
    SGD: { name: "Singapore Dollars", sub: "Cents" },
    NZD: { name: "New Zealand Dollars", sub: "Cents" },
    HKD: { name: "Hong Kong Dollars", sub: "Cents" },
    ZAR: { name: "Rand", sub: "Cents" },
    AED: { name: "UAE Dirhams", sub: "Fils" },
    SAR: { name: "Saudi Riyals", sub: "Halalas" },
    QAR: { name: "Qatari Riyals", sub: "Dirhams" },
    KWD: { name: "Kuwaiti Dinars", sub: "Fils" },
    BHD: { name: "Bahraini Dinars", sub: "Fils" },
    OMR: { name: "Omani Rials", sub: "Baisa" },
    CHF: { name: "Swiss Francs", sub: "Rappen" },
    JPY: { name: "Japanese Yen", sub: "Sen" },
    CNY: { name: "Chinese Yuan", sub: "Fen" },
    NPR: { name: "Nepalese Rupees", sub: "Paise" },
    LKR: { name: "Sri Lankan Rupees", sub: "Cents" },
    MYR: { name: "Malaysian Ringgit", sub: "Sen" },
  };
  return map[code] ?? { name: code, sub: "Cents" };
}
