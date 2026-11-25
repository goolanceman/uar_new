/**
 * Server-side org identity helpers — read the Setting table once and
 * project it into the shapes consumed by /api/settings/public, 80G
 * receipts and certificates. Every value has a hard-coded fallback so
 * public pages and print documents never render blank.
 */
import { db } from "@/lib/db";
import { SETTING_DEFAULTS, isFlagOn, publicFeatures, getCurrency } from "@/lib/settings-core";

export type SettingsMap = Record<string, string>;

export async function settingsMap(): Promise<SettingsMap> {
  const rows = await db.setting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function pick(map: SettingsMap, key: string, fallback: string): string {
  const v = map[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
}

export const DEFAULT_FOOTER =
  "United Angel Reach is a registered charitable trust. Donations to the trust are eligible for deduction u/s 80G of the Income-tax Act, 1961. This document is system-generated and valid without a physical signature when it carries the trust seal and registration numbers.";

export interface OrgProfile {
  name: string;
  hq: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  pan: string;
  reg80g: string;
  reg12a: string;
  darpan: string;
  vision: string;
  upiId: string;
  signatoryName: string;
  signatoryRole: string;
  footer: string;
  defaultLanguage: string;
  logoUrl: string;
  faviconUrl: string;
  /** Payment gateway public key id (Razorpay key id / Stripe publishable key) — safe to expose, empty unless set. */
  gatewayKeyId: string;
}

/** Full org profile from settings, with brand fallbacks. */
export async function orgProfile(): Promise<OrgProfile> {
  const map = await settingsMap();
  return {
    name: pick(map, "org.name", "United Angel Reach"),
    hq: pick(map, "org.hq", "Bengaluru, Karnataka"),
    address: pick(
      map,
      "org.address",
      "Seva Sadana, 42, 7th Cross, Jayanagar 4th Block, Bengaluru — 560070, Karnataka"
    ),
    email: pick(map, "org.email", "care@unitedangelreach.org"),
    phone: pick(map, "org.phone", "+91 80 4712 0000"),
    website: pick(map, "org.website", "https://unitedangelreach.org"),
    pan: pick(map, "org.pan", "AABTU4521K"),
    reg80g: pick(map, "org.80g", "UAR/80G/2019/BLR"),
    reg12a: pick(map, "org.reg12a", "UAR/12A/2019/BLR"),
    darpan: pick(map, "org.darpan", "KA/2019/0245678"),
    vision: pick(
      map,
      "org.vision",
      "To scale our service model to serve all of India"
    ),
    upiId: pick(map, "finance.upiId", "unitedangelreach@upi"),
    signatoryName: pick(map, "receipts.signatoryName", "Mansoor Khan"),
    signatoryRole: pick(map, "receipts.signatoryRole", "Managing Trustee"),
    footer: pick(map, "receipts.footer", DEFAULT_FOOTER),
    defaultLanguage: pick(map, "app.language", "en"),
    logoUrl: pick(map, "brand.logoUrl", "/logo_uar_final_emerald.svg"),
    faviconUrl: pick(map, "brand.faviconUrl", "/logo_uar_final_emerald.svg"),
    // Razorpay key ids / Stripe publishable keys are public identifiers
    // (they appear in checkout.js), so they may be published when enabled.
    gatewayKeyId: isFlagOn(map["finance.gatewayEnabled"])
      ? (map["finance.razorpayKeyId"] ?? map["finance.stripeKeyId"] ?? "").trim()
      : "",
  };
}

/**
 * Exactly the public subset contracted for GET /api/settings/public
 * (safe to expose without authentication). Includes the public feature
 * flags + currency so public pages (Donate, assistant, maintenance banner)
 * react to admin settings without exposing secrets.
 */
export async function publicOrgSettings() {
  const map = await settingsMap();
  const org = await orgProfile();
  const currency = map["finance.currency"] ?? SETTING_DEFAULTS["finance.currency"];
  const gatewayEnabled =
    isFlagOn(map["finance.gatewayEnabled"] ?? SETTING_DEFAULTS["finance.gatewayEnabled"]) &&
    Boolean(org.gatewayKeyId);
  return {
    orgName: org.name,
    orgHq: org.hq,
    orgAddress: org.address,
    orgEmail: org.email,
    orgPhone: org.phone,
    org80g: org.reg80g,
    orgPan: org.pan,
    orgReg12a: org.reg12a,
    orgDarpan: org.darpan,
    upiId: org.upiId,
    signatoryName: org.signatoryName,
    signatoryRole: org.signatoryRole,
    defaultLanguage: org.defaultLanguage,
    vision: org.vision,
    logoUrl: org.logoUrl,
    faviconUrl: org.faviconUrl,
    // Public payment + feature-flag surface:
    currency,
    currencySymbol: getCurrency(currency).symbol,
    gatewayEnabled,
    gatewayProvider: (map["finance.gatewayProvider"] ?? "RAZORPAY").toUpperCase(),
    gatewayKeyId: org.gatewayKeyId || undefined,
    features: publicFeatures(map),
  };
}

/** Escape a value for safe interpolation into print HTML documents. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/** Shared print-document shell (A4, self-contained, auto window.print). */
export function printDocument(
  title: string,
  body: string,
  landscape = false
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  @page { size: A4${landscape ? " landscape" : ""}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #eef1f4; }
  body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #101a16; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .serif { font-family: Georgia, 'Times New Roman', serif; }
  .sheet { background: #ffffff; margin: 24px auto; box-shadow: 0 10px 40px rgba(15, 31, 26, 0.16); }
  .toolbar { position: fixed; top: 14px; right: 14px; z-index: 9; }
  .toolbar button { font: 600 13.5px 'Segoe UI', Arial, sans-serif; padding: 10px 18px; border-radius: 999px; border: 1px solid #0f1f1a; background: #0f1f1a; color: #fff; cursor: pointer; box-shadow: 0 2px 10px rgba(15,31,26,.28); transition: background .15s; }
  .toolbar button:hover { background: #064e3b; border-color: #064e3b; }
  @media print {
    html, body { background: #ffffff; }
    .sheet { margin: 0; box-shadow: none; }
    .toolbar { display: none; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
  ${body}
</body>
</html>`;
}
