/**
 * Certificate domain helpers shared by the certificates API routes:
 * canonical types, type-aware titles, default citation wording and the
 * print-ready A4 award-certificate HTML builder.
 */
import { esc, printDocument, type OrgProfile } from "./api-org";
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
  :root {
    --ink: #101a16; --ink-2: #1e293b; --ink-3: #475569; --ink-4: #94a3b8;
    --line: #e2e8f0; --wash: #f8fafc; --paper: #fffdf8;
    --accent: #059669; --accent-deep: #064e3b; --accent-wash: #ecfdf5;
    --gold: #b08d2f; --gold-soft: #d4af37;
  }
  .sheet { width: 297mm; height: 209.5mm; padding: 9mm; display: flex; }
  .frame {
    position: relative; width: 100%; height: 100%; background: var(--paper);
    border: 1px solid var(--line);
    box-shadow: inset 0 0 0 1px #ffffff, inset 0 0 0 4.5mm var(--paper), inset 0 0 0 5.2mm var(--line), inset 0 0 0 6mm var(--paper), inset 0 0 0 6.6mm rgba(176,141,47,.55);
    padding: 16mm 20mm 12mm; display: flex; flex-direction: column; align-items: center;
    text-align: center; overflow: hidden;
  }
  /* ── watermark ─────────────────────────────────────────── */
  .wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    pointer-events: none; z-index: 0; }
  .wm .big {
    transform: rotate(-24deg); white-space: nowrap; user-select: none;
    font: 800 120px Georgia, 'Times New Roman', serif; letter-spacing: 30px;
    color: rgba(16, 26, 22, 0.030);
  }
  .wm .ring { position: absolute; width: 150mm; height: 150mm; border-radius: 50%;
    border: 1.2px solid rgba(176, 141, 47, 0.14); }
  .wm .ring2 { position: absolute; width: 122mm; height: 122mm; border-radius: 50%;
    border: 1px dashed rgba(5, 150, 105, 0.12); }
  .inner { position: relative; z-index: 1; width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; text-align: center; }

  /* ── letterhead ────────────────────────────────────────── */
  .lh { display: flex; align-items: center; gap: 13px; }
  .lh-mono { width: 50px; height: 50px; border-radius: 13px; flex-shrink: 0;
    background: linear-gradient(150deg, #064e3b, #059669); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font: 800 15px Georgia, serif; letter-spacing: 1px;
    box-shadow: 0 2px 8px rgba(6, 78, 59, .25); }
  .lh-name { font: 700 19px Georgia, 'Times New Roman', serif; color: var(--ink); letter-spacing: .5px; }
  .lh-tag { font: italic 10px Georgia, serif; color: var(--ink-3); margin-top: 1px; }
  .lh-addr { font-size: 9px; color: var(--ink-4); margin-top: 2px; letter-spacing: .3px; }

  /* ── title ─────────────────────────────────────────────── */
  .eyebrow { margin-top: 10mm; font-size: 9.5px; font-weight: 700; letter-spacing: 3.5px;
    text-transform: uppercase; color: var(--gold); }
  .ct-title { font: 700 36px Georgia, 'Times New Roman', serif; letter-spacing: 7px;
    text-transform: uppercase; color: var(--ink); margin-top: 2.5mm; }
  .ct-rule { width: 92mm; height: 1px; margin: 4mm auto 0;
    background: linear-gradient(90deg, rgba(16,26,22,0), rgba(16,26,22,.35), rgba(16,26,22,0)); }

  /* ── recipient ─────────────────────────────────────────── */
  .presented { font: italic 13.5px Georgia, serif; color: var(--ink-3); margin-top: 9mm; }
  .recipient { font: 700 42px Georgia, 'Times New Roman', serif; color: var(--accent-deep); margin-top: 4mm; letter-spacing: .5px; }
  .recipient-rule { width: 118mm; height: 2px; margin-top: 3.5mm; border-radius: 2px;
    background: linear-gradient(90deg, rgba(176,141,47,0), var(--gold) 30%, var(--accent) 70%, rgba(5,150,105,0)); }
  .citation { max-width: 205mm; font: 12px/1.75 'Segoe UI', Arial, sans-serif; color: var(--ink-3); margin-top: 6mm; }
  .chips { margin-top: 5mm; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .chip { border: 1px solid var(--line); background: #ffffff; color: var(--ink-2);
    border-radius: 999px; font-size: 10.5px; padding: 4px 13px; letter-spacing: .3px; }
  .chip b { color: var(--accent-deep); font-weight: 700; }

  /* ── footer row ────────────────────────────────────────── */
  .foot-row { margin-top: auto; width: 100%; display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; }
  .meta-block { text-align: left; font-size: 10.5px; color: var(--ink-3); min-width: 58mm; }
  .meta-block b { display: block; font: 700 12.5px ui-monospace, 'Courier New', monospace; color: var(--ink); margin-top: 2px; letter-spacing: .5px; }
  .meta-block .k { font-size: 8.5px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; color: var(--ink-4); }
  .seal { width: 108px; height: 108px; border-radius: 50%; position: relative; flex-shrink: 0;
    background: radial-gradient(circle at 32% 28%, #ffffff, var(--wash)); transform: rotate(-7deg);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: var(--ink-2); border: 1.5px solid var(--line); }
  .seal::before { content: ""; position: absolute; inset: 7px; border-radius: 50%;
    border: 1.5px solid var(--gold); opacity: .85; }
  .seal b { font: 800 16px Georgia, serif; letter-spacing: 1.5px; color: var(--ink); }
  .seal i { font: italic 7.5px Georgia, serif; letter-spacing: 1.6px; color: var(--ink-3); margin-top: 2px; }
  .seal span { font-size: 7px; letter-spacing: 2.2px; color: var(--gold); font-weight: 700; margin-top: 3px; }
  .sig-block { text-align: right; min-width: 58mm; }
  .sig-for { font-size: 10.5px; color: var(--ink-3); }
  .sig-for b { color: var(--ink); }
  .sig-line { width: 200px; margin-left: auto; border-top: 1.5px solid var(--ink-2); margin-top: 34px; padding-top: 6px; }
  .sig-name { font: 700 14px Georgia, serif; color: var(--ink); }
  .sig-role { font-size: 10px; color: var(--ink-4); margin-top: 1px; }
  .verify { width: 100%; text-align: center; font-size: 8.5px; color: var(--ink-4); margin-top: 3.5mm; letter-spacing: .4px; }
  @media print { .sheet { box-shadow: none; } }
</style>
<div class="sheet">
  <div class="frame">
    <div class="wm" aria-hidden="true">
      <div class="ring"></div>
      <div class="ring2"></div>
      <div class="big">UAR</div>
    </div>
    <div class="inner">
      <div class="lh">
        <div class="lh-mono">UAR</div>
        <div>
          <div class="lh-name">${esc(org.name)}</div>
          <div class="lh-tag">Service · Dignity · Transparency · Technology-for-Good</div>
          <div class="lh-addr">${esc(org.hq)} &nbsp;·&nbsp; ${esc(org.email)}</div>
        </div>
      </div>

      <div class="eyebrow">Official Recognition</div>
      <div class="ct-title">${esc(title)}</div>
      <div class="ct-rule"></div>

      <div class="presented">This certificate is proudly presented to</div>
      <div class="recipient serif">${esc(cert.recipientName)}</div>
      <div class="recipient-rule"></div>

      <div class="citation">${esc(citation)}</div>
      ${chipHtml}

      <div class="foot-row">
        <div class="meta-block">
          <div class="k">Issued on</div><b>${esc(formatDateLong(cert.issuedAt))}</b>
          <div style="margin-top:6px;"><div class="k">Certificate No.</div><b>${esc(cert.code)}</b></div>
        </div>
        <div class="seal">
          <b>UAR</b>
          <i>SEVA · DIGNITY</i>
          <span>TRUST SEAL</span>
        </div>
        <div class="sig-block">
          <span class="sig-for">For <b>${esc(org.name)}</b></span>
          <div class="sig-line">
            <div class="sig-name">${esc(cert.issuedBy || org.signatoryName)}</div>
            <div class="sig-role">${esc(org.signatoryRole)}</div>
          </div>
        </div>
      </div>
      <div class="verify">Verify this certificate at ${esc(org.website)} · Certificate No. ${esc(cert.code)} · Registered charitable trust — ${esc(org.hq)}</div>
    </div>
  </div>
</div>
<script>window.onload=function(){window.print()}</script>`;

  return printDocument(`${title} — ${cert.recipientName}`, body, true);
}
