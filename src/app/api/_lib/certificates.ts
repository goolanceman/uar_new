/**
 * Certificate domain helpers shared by the certificates API routes:
 * canonical types, type-aware titles, default citation wording and the
 * print-ready A4 award-certificate HTML builder.
 */
import { esc, printDocument, type OrgProfile } from "./org";
import { formatDateLong, titleCase } from "@/lib/format";

export const CERTIFICATE_TYPES = [
  "DONOR_APPRECIATION",
  "VOLUNTEER_SERVICE",
  "ANIMAL_ADOPTION",
  "MEDICINE_SPONSOR",
  "PAD_DRIVE_CHAMPION",
] as const;
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

export const CERT_TYPE_TITLES: Record<CertificateType, string> = {
  DONOR_APPRECIATION: "Certificate of Appreciation",
  VOLUNTEER_SERVICE: "Certificate of Volunteer Service",
  ANIMAL_ADOPTION: "Animal Adoption Certificate",
  MEDICINE_SPONSOR: "Medicine Sponsorship Certificate",
  PAD_DRIVE_CHAMPION: "Menstrual Health Champion",
};

export function isCertificateType(t: string): t is CertificateType {
  return (CERTIFICATE_TYPES as readonly string[]).includes(t);
}

/** Type-aware default citation shown when no description is stored. */
export function certCitation(
  type: string,
  recipientName: string,
  orgName: string,
  meta?: Record<string, string> | null
): string {
  const animal = meta?.animal ? ` ${meta.animal}` : "";
  const species = meta?.species ? titleCase(meta.species) : "";
  switch (type) {
    case "DONOR_APPRECIATION":
      return `In grateful recognition of ${recipientName}'s generous contribution to the humanitarian programmes of ${orgName}. Every rupee given has moved directly into ration kits for families, monthly medicines for patients, care for street animals and safer communities — given freely, recorded transparently, and acknowledged with the trust's deepest thanks.`;
    case "VOLUNTEER_SERVICE":
      return `Awarded to ${recipientName} in recognition of outstanding volunteer service to ${orgName} — for time given without expectation, compassion shown in the field, and the quiet reliability that turns our mission into measurable change for families and communities across Karnataka.`;
    case "ANIMAL_ADOPTION":
      return `Proudly awarded to ${recipientName} for opening their heart and home to${animal || " a rescued animal"}${species ? ` (${species})` : ""}, giving a once-stray soul a lifetime of safety, warmth and belonging. Adopt, don't shop — thank you for choosing compassion.`;
    case "MEDICINE_SPONSOR":
      return `Awarded to ${recipientName} for sponsoring life-saving monthly medicines for under-privileged patients of ${orgName}'s Adopt-a-Medicine programme. Your steady kindness keeps blood pressure, diabetes and cardiac treatment within reach for families who could never afford it alone.`;
    case "PAD_DRIVE_CHAMPION":
      return `Honoured as a Menstrual Health Champion for exceptional leadership in pad-bank drives, awareness sessions and dignity work across schools and communities — helping girls stay in school, breaking stigma, and standing up for the health of every woman and girl.`;
    default:
      return `Presented to ${recipientName} in recognition of exceptional service and kindness in support of the mission of ${orgName}.`;
  }
}

/** Parse the certificate meta JSON into chip-friendly entries. */
export function parseMeta(meta: string | null | undefined): [string, string][] {
  if (!meta) return [];
  try {
    const o: unknown = JSON.parse(meta);
    if (o && typeof o === "object" && !Array.isArray(o)) {
      return Object.entries(o as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
        .map(([k, v]) => [titleCase(k), String(v)]);
    }
  } catch {
    // non-JSON meta — ignore
  }
  return [];
}

interface CertRecord {
  code: string;
  type: string;
  recipientName: string;
  title: string;
  description: string | null;
  issuedBy: string | null;
  meta: string | null;
  issuedAt: Date;
}

/**
 * Self-contained, print-ready A4 (landscape) award certificate.
 * Decorative double border, letterhead, type-aware title, recipient
 * citation, meta chips, gold/emerald seal and signatory block.
 */
export function certificateHtml(cert: CertRecord, org: OrgProfile): string {
  const title =
    cert.title?.trim() ||
    CERT_TYPE_TITLES[cert.type as CertificateType] ||
    "Certificate";
  const chips = parseMeta(cert.meta);
  const citation =
    cert.description?.trim() ||
    certCitation(cert.type, cert.recipientName, org.name, Object.fromEntries(parseMeta(cert.meta)));

  const chipHtml = chips.length
    ? `<div class="chips">${chips
        .map(
          ([k, v]) =>
            `<span class="chip"><b>${esc(k)}:</b> ${esc(v)}</span>`
        )
        .join("")}</div>`
    : "";

  const body = `
<style>
  .sheet { width: 297mm; height: 209.5mm; padding: 9mm; display: flex; }
  .frame { position: relative; width: 100%; height: 100%; border: 3px solid #047857; padding: 4.5mm; background:
    linear-gradient(135deg, rgba(212,175,55,0.10), rgba(255,255,255,0) 30%),
    linear-gradient(315deg, rgba(16,185,129,0.10), rgba(255,255,255,0) 30%); }
  .frame-inner { width: 100%; height: 100%; border: 1.5px solid #b08d2f; padding: 10mm 14mm 8mm; display: flex; flex-direction: column; align-items: center; text-align: center; position: relative; }
  .corner { position: absolute; width: 26px; height: 26px; border-color: #b08d2f; border-style: solid; }
  .c-tl { top: 3mm; left: 3mm; border-width: 3px 0 0 3px; }
  .c-tr { top: 3mm; right: 3mm; border-width: 3px 3px 0 0; }
  .c-bl { bottom: 3mm; left: 3mm; border-width: 0 0 3px 3px; }
  .c-br { bottom: 3mm; right: 3mm; border-width: 0 3px 3px 0; }
  .lh { display: flex; align-items: center; gap: 12px; }
  .lh-mono { width: 46px; height: 46px; border-radius: 50%; border: 2px solid #047857; background: radial-gradient(circle at 30% 25%, #d1fae5, #ffffff 70%); color: #065f46; display: flex; align-items: center; justify-content: center; font: 700 15px Georgia, serif; }
  .lh-name { font: 700 20px Georgia, 'Times New Roman', serif; color: #064e3b; letter-spacing: 1px; }
  .lh-tag { font: italic 10.5px Georgia, serif; color: #047857; }
  .lh-addr { font-size: 9.5px; color: #6b7280; margin-top: 2px; }
  .ct-title { font: 700 34px Georgia, 'Times New Roman', serif; letter-spacing: 8px; text-transform: uppercase; color: #065f46; margin-top: 13mm; }
  .ct-rule { width: 88mm; height: 1px; background: linear-gradient(90deg, rgba(4,120,87,0), #047857, rgba(4,120,87,0)); margin: 6px auto 0; }
  .presented { font: italic 15px Georgia, serif; color: #4b5563; margin-top: 11mm; }
  .recipient { font: 700 44px Georgia, 'Times New Roman', serif; color: #0c3a2d; margin-top: 5mm; }
  .recipient-rule { width: 120mm; height: 2.5px; margin-top: 4mm; background: linear-gradient(90deg, rgba(176,141,47,0), #b08d2f 25%, #047857 75%, rgba(4,120,87,0)); border-radius: 2px; }
  .citation { max-width: 200mm; font: 13px/1.75 'Segoe UI', Arial, sans-serif; color: #374151; margin-top: 7mm; }
  .chips { margin-top: 6mm; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .chip { border: 1px solid #a7f3d0; background: #ecfdf5; color: #065f46; border-radius: 999px; font-size: 11px; padding: 4px 13px; }
  .chip b { color: #047857; }
  .foot-row { margin-top: auto; width: 100%; display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; }
  .meta-block { text-align: left; font-size: 11px; color: #4b5563; min-width: 60mm; }
  .meta-block b { display: block; font: 700 13px Georgia, serif; color: #111827; margin-top: 2px; }
  .seal { width: 112px; height: 112px; border-radius: 50%; border: 3px solid #b08d2f; outline: 2px solid #047857; outline-offset: -10px; background: radial-gradient(circle at 32% 28%, #fef3c7, #fde68a 55%, #d1fae5); display: flex; flex-direction: column; align-items: center; justify-content: center; color: #065f46; transform: rotate(-7deg); box-shadow: 0 3px 10px rgba(176,141,47,.35); }
  .seal b { font: 700 18px Georgia, serif; letter-spacing: 1px; }
  .seal i { font: italic 8px Georgia, serif; letter-spacing: 1.5px; }
  .seal span { font-size: 8px; letter-spacing: 2px; color: #92650d; }
  .sig-block { text-align: right; min-width: 60mm; }
  .sig-name { font: 700 15px Georgia, serif; color: #111827; border-top: 1.5px solid #374151; padding-top: 6px; margin-top: 34px; }
  .sig-role { font-size: 10.5px; color: #6b7280; }
  .verify { width: 100%; text-align: center; font-size: 9px; color: #9ca3af; margin-top: 4mm; letter-spacing: 0.4px; }
  @media print { .sheet { box-shadow: none; } }
</style>
<div class="sheet">
  <div class="frame">
    <div class="frame-inner">
      <i class="corner c-tl"></i><i class="corner c-tr"></i><i class="corner c-bl"></i><i class="corner c-br"></i>
      <div class="lh">
        <div class="lh-mono">UAR</div>
        <div>
          <div class="lh-name">${esc(org.name)}</div>
          <div class="lh-tag">Service · Dignity · Transparency · Technology-for-Good</div>
          <div class="lh-addr">${esc(org.hq)} &nbsp;·&nbsp; ${esc(org.email)}</div>
        </div>
      </div>

      <div class="ct-title">${esc(title)}</div>
      <div class="ct-rule"></div>

      <div class="presented">This certificate is proudly presented to</div>
      <div class="recipient serif">${esc(cert.recipientName)}</div>
      <div class="recipient-rule"></div>

      <div class="citation">${esc(citation)}</div>
      ${chipHtml}

      <div class="foot-row">
        <div class="meta-block">
          Issued on<b>${esc(formatDateLong(cert.issuedAt))}</b>
          <div style="margin-top:5px;">Certificate No.<br/><b style="font-size:12px;">${esc(cert.code)}</b></div>
        </div>
        <div class="seal">
          <b>★ UAR ★</b>
          <i>SEVA · DIGNITY · SEVA</i>
          <span>TRUST SEAL</span>
        </div>
        <div class="sig-block">
          For <b>${esc(org.name)}</b>
          <div class="sig-name">${esc(cert.issuedBy || org.signatoryName)}</div>
          <div class="sig-role">${esc(org.signatoryRole)}</div>
        </div>
      </div>
      <div class="verify">Verify this certificate at ${esc(org.website)} · Certificate No. ${esc(cert.code)} · Registered charitable trust — ${esc(org.hq)}</div>
    </div>
  </div>
</div>
<script>window.onload=function(){window.print()}</script>`;

  return printDocument(`${title} — ${cert.recipientName}`, body, true);
}
