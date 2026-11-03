import { db } from "@/lib/db";
import { ApiError, handleError } from "@/lib/session";
import { orgProfile, esc, printDocument } from "../../../_lib/org";
import {
  formatINR,
  amountInWords,
  formatDateLong,
  financialYear,
  titleCase,
} from "@/lib/format";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ receiptNumber: string }> };

// GET /api/receipts/:receiptNumber/html — self-contained, print-ready A4
// 80G donation receipt. Modern certificate design: neutral ink palette with
// a single restrained accent, diagonal "80G" watermark, hairline structure.
// Public with the receipt number acting as the capability.
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { receiptNumber } = await ctx.params;

    const d = await db.donation.findUnique({
      where: { receiptNumber: decodeURIComponent(receiptNumber) },
      include: {
        campaign: { select: { title: true } },
        donor: { select: { pan: true, phone: true } },
      },
    });
    if (!d) throw new ApiError("Receipt not found", 404);

    const org = await orgProfile();
    const donorPan = (d.pan ?? d.donor?.pan ?? "").toUpperCase();
    const category = titleCase(d.category);
    const txn = d.transactionId
      ? esc(d.transactionId)
      : '<span class="dim">— (UPI reference / bank statement)</span>';

    const body = `
<style>
  :root {
    --ink: #0f1f1a; --ink-2: #334155; --ink-3: #64748b; --ink-4: #94a3b8;
    --line: #e2e8f0; --line-soft: #eef2f6; --paper: #ffffff; --wash: #f8fafc;
    --accent: #059669; --accent-deep: #064e3b; --accent-wash: #ecfdf5;
    --gold: #b08d2f;
  }
  .sheet {
    width: 210mm; min-height: 297mm; padding: 14mm 15mm 12mm;
    position: relative; overflow: hidden; background: var(--paper);
    font-family: 'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif;
    color: var(--ink);
  }
  /* ── watermark ─────────────────────────────────────────────── */
  .wm {
    position: absolute; inset: 0; z-index: 0; pointer-events: none;
    display: flex; align-items: center; justify-content: center;
  }
  .wm .giant {
    transform: rotate(-28deg);
    font: 800 190px Georgia, 'Times New Roman', serif;
    letter-spacing: 26px; color: rgba(15, 31, 26, 0.035);
    white-space: nowrap; user-select: none;
  }
  .wm .giant2 {
    position: absolute; transform: rotate(-28deg) translate(40px, 150px);
    font: italic 600 44px Georgia, serif; letter-spacing: 14px;
    color: rgba(5, 150, 105, 0.045); white-space: nowrap;
  }
  .wm .ring {
    position: absolute; width: 165mm; height: 165mm; border-radius: 50%;
    border: 1.2px solid rgba(15, 31, 26, 0.05);
  }
  .content { position: relative; z-index: 1; }

  /* ── header ────────────────────────────────────────────────── */
  .accent-bar { height: 7px; border-radius: 99px;
    background: linear-gradient(90deg, var(--accent-deep), var(--accent) 55%, #34d399); }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-top: 16px; }
  .brand { display: flex; gap: 13px; align-items: center; }
  .mono {
    width: 54px; height: 54px; border-radius: 14px; flex-shrink: 0;
    background: linear-gradient(150deg, #064e3b, #059669);
    color: #fff; display: flex; align-items: center; justify-content: center;
    font: 800 17px Georgia, serif; letter-spacing: 1px;
    box-shadow: 0 2px 8px rgba(6, 78, 59, .28);
  }
  .brand-name { font: 700 20px Georgia, serif; color: var(--ink); letter-spacing: .2px; }
  .brand-tag { font-size: 10.5px; color: var(--ink-3); margin-top: 2px; letter-spacing: .4px; }
  .brand-addr { font-size: 10.5px; color: var(--ink-4); margin-top: 3px; line-height: 1.5; }
  .doc-chip { text-align: right; }
  .chip {
    display: inline-block; font-size: 9.5px; font-weight: 700; letter-spacing: 1.8px;
    text-transform: uppercase; color: var(--accent-deep);
    border: 1px solid #a7f3d0; background: var(--accent-wash);
    border-radius: 999px; padding: 4px 12px;
  }
  .chip-sub { font-size: 9.5px; color: var(--ink-4); margin-top: 5px; letter-spacing: .3px; }

  /* ── title ─────────────────────────────────────────────────── */
  .title-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px;
    margin: 20px 0 0; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
  .doc-title { font: 800 30px Georgia, 'Times New Roman', serif; letter-spacing: 2.5px; color: var(--ink); }
  .doc-sub { font-size: 11.5px; color: var(--ink-3); margin-top: 5px; }
  .receipt-no { text-align: right; }
  .receipt-no .lbl { font-size: 9px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; color: var(--ink-4); }
  .receipt-no .val { font: 700 16.5px ui-monospace, 'Cascadia Mono', 'Courier New', monospace;
    color: var(--accent-deep); letter-spacing: 1px; margin-top: 2px; }

  /* ── meta strip ────────────────────────────────────────────── */
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--line);
    border-radius: 12px; overflow: hidden; margin-top: 14px; background: var(--paper); }
  .meta > div { padding: 10px 14px; border-left: 1px solid var(--line-soft); }
  .meta > div:first-child { border-left: 0; }
  .meta .k { font-size: 8.5px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: var(--ink-4); }
  .meta .v { font-size: 12.5px; font-weight: 600; color: var(--ink); margin-top: 3px; }

  /* ── two-col body ──────────────────────────────────────────── */
  .cols { display: grid; grid-template-columns: 1.02fr .98fr; gap: 14px; margin-top: 14px; }
  .panel { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--paper); }
  .panel.tinted { background: var(--wash); }
  .sec-label { font-size: 9.5px; font-weight: 700; letter-spacing: 1.8px; text-transform: uppercase;
    color: var(--accent-deep); margin-bottom: 9px; display: flex; align-items: center; gap: 7px; }
  .sec-label::after { content: ""; flex: 1; height: 1px; background: var(--line-soft); }
  .donor-name { font: 700 15.5px Georgia, serif; color: var(--ink); }
  .kv { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; margin-top: 8px; font-size: 11.5px; }
  .kv .k { color: var(--ink-4); }
  .kv .v { color: var(--ink-2); font-weight: 500; }
  .amount-fig { font: 800 27px Georgia, 'Times New Roman', serif; color: var(--ink); letter-spacing: .3px; }
  .amount-cur { font-size: 12px; color: var(--ink-4); font-weight: 600; }
  .amount-words { font-style: italic; font-size: 11px; color: var(--ink-3); margin-top: 6px;
    padding-top: 7px; border-top: 1px dashed var(--line); line-height: 1.5; }
  .elig { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px;
    font-size: 10px; font-weight: 700; letter-spacing: .6px; color: var(--accent-deep);
    background: var(--accent-wash); border: 1px solid #a7f3d0; border-radius: 8px; padding: 5px 10px; }

  /* ── details table ─────────────────────────────────────────── */
  table.details { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 14px;
    border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  table.details th { text-align: left; font-size: 8.5px; font-weight: 700; letter-spacing: 1.4px;
    text-transform: uppercase; color: var(--ink-3); background: var(--wash);
    padding: 8px 12px; border-bottom: 1px solid var(--line); }
  table.details td { padding: 8px 12px; color: var(--ink-2); border-bottom: 1px solid var(--line-soft); }
  table.details tr:last-child td { border-bottom: 0; }
  .badge { display: inline-block; background: var(--accent-wash); color: var(--accent-deep);
    font-weight: 700; font-size: 9.5px; border: 1px solid #a7f3d0; border-radius: 999px; padding: 2px 9px; letter-spacing: .4px; }
  .dim { color: var(--ink-4); }

  /* ── declaration ───────────────────────────────────────────── */
  .decl { border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; margin-top: 14px; background: var(--wash); }
  .decl p { font-size: 10.5px; color: var(--ink-2); line-height: 1.65; display: flex; gap: 8px; }
  .decl p + p { margin-top: 4px; }
  .decl .n { font-weight: 800; color: var(--accent); font-size: 10px; }

  /* ── signature ─────────────────────────────────────────────── */
  .sign-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 24px; gap: 20px; }
  .sig-for { font-size: 11.5px; color: var(--ink-3); }
  .sig-for b { color: var(--ink); }
  .sig-line { width: 210px; border-top: 1.5px solid var(--ink-2); margin-top: 44px; padding-top: 6px; }
  .sig-name { font: 700 14px Georgia, serif; color: var(--ink); }
  .sig-role { font-size: 10px; color: var(--ink-4); margin-top: 1px; }
  .seal { width: 104px; height: 104px; border-radius: 50%; position: relative;
    border: 1.5px solid var(--line); background: radial-gradient(circle at 32% 28%, #ffffff, var(--wash));
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; color: var(--ink-2); transform: rotate(-6deg); flex-shrink: 0; }
  .seal::before { content: ""; position: absolute; inset: 7px; border-radius: 50%;
    border: 1.5px solid var(--gold); opacity: .8; }
  .seal b { font: 800 15px Georgia, serif; letter-spacing: 1.5px; color: var(--ink); }
  .seal i { font: italic 7.5px Georgia, serif; letter-spacing: 1.6px; color: var(--ink-3); margin-top: 2px; }
  .seal span { font-size: 7px; letter-spacing: 2.2px; color: var(--gold); font-weight: 700; margin-top: 4px; }

  /* ── footer strip ──────────────────────────────────────────── */
  .regs { display: flex; flex-wrap: wrap; gap: 6px 16px; justify-content: center;
    margin-top: 20px; padding-top: 10px; border-top: 1px solid var(--line);
    font-size: 9px; color: var(--ink-4); letter-spacing: .3px; }
  .regs b { color: var(--ink-3); font-weight: 600; }
  @media print { .sheet { box-shadow: none; } }
</style>
<div class="sheet">
  <div class="wm" aria-hidden="true">
    <div class="ring"></div>
    <div class="giant">80G</div>
    <div class="giant2">TAX EXEMPT</div>
  </div>

  <div class="content">
    <div class="accent-bar"></div>

    <div class="head">
      <div class="brand">
        <div class="mono">UAR</div>
        <div>
          <div class="brand-name">${esc(org.name)}</div>
          <div class="brand-tag">Service · Dignity · Transparency · Technology-for-Good</div>
          <div class="brand-addr">${esc(org.address)}<br/>${esc(org.email)} &nbsp;·&nbsp; ${esc(org.phone)} &nbsp;·&nbsp; ${esc(org.hq)}</div>
        </div>
      </div>
      <div class="doc-chip">
        <span class="chip">System Generated · Original</span>
        <div class="chip-sub">No physical signature required</div>
      </div>
    </div>

    <div class="title-row">
      <div>
        <div class="doc-title">DONATION RECEIPT</div>
        <div class="doc-sub">Eligible for deduction under Section 80G of the Income-tax Act, 1961</div>
      </div>
      <div class="receipt-no">
        <div class="lbl">Receipt No.</div>
        <div class="val">${esc(d.receiptNumber)}</div>
      </div>
    </div>

    <div class="meta">
      <div><div class="k">Donation Date</div><div class="v">${esc(formatDateLong(d.createdAt))}</div></div>
      <div><div class="k">Financial Year</div><div class="v">${esc(financialYear(d.createdAt))}</div></div>
      <div><div class="k">Payment Mode</div><div class="v">${esc(titleCase(d.paymentMethod))}${d.type === "RECURRING" ? " · Monthly" : ""}</div></div>
      <div><div class="k">Payment Status</div><div class="v"><span class="badge">${esc(d.paymentStatus)}</span></div></div>
    </div>

    <div class="cols">
      <div class="panel">
        <div class="sec-label">Donor</div>
        <div class="donor-name">${esc(d.isAnonymous ? "Anonymous Donor" : d.donorName)}</div>
        <div class="kv">
          <div><span class="k">PAN&nbsp;</span><span class="v">${donorPan ? esc(donorPan) : '<span class="dim">not provided</span>'}</span></div>
          <div><span class="k">Type&nbsp;</span><span class="v">${d.donorId ? "Registered Donor" : "Guest Donor"}</span></div>
          <div><span class="k">Email&nbsp;</span><span class="v">${esc(d.donorEmail)}</span></div>
          <div><span class="k">Phone&nbsp;</span><span class="v">${esc(d.donorPhone ?? "—")}</span></div>
        </div>
      </div>
      <div class="panel tinted">
        <div class="sec-label">Donation</div>
        <div class="amount-fig">${esc(formatINR(d.amount))} <span class="amount-cur">${esc(d.currency)}</span></div>
        <div class="amount-words">${esc(amountInWords(d.amount))} only</div>
        <span class="elig">✓&nbsp; 80G deduction eligible</span>
      </div>
    </div>

    <table class="details">
      <tr>
        <th style="width:34%;">Purpose</th>
        <th style="width:22%;">Category</th>
        <th style="width:22%;">Donation Type</th>
        <th style="width:22%;">Transaction ID</th>
      </tr>
      <tr>
        <td>${esc(d.campaign?.title ?? "General Fund — wherever the need is greatest")}</td>
        <td>${esc(category)}</td>
        <td>${esc(titleCase(d.type))}</td>
        <td>${txn}</td>
      </tr>
    </table>

    <div class="decl">
      <p><span class="n">1.</span><span>This donation is eligible for deduction under Section 80G of the Income-tax Act, 1961, to the extent permitted by law. Please retain this receipt for your income-tax records; donor PAN above is mandatory for claiming the deduction.</span></p>
      <p><span class="n">2.</span><span>${esc(org.name)} is a registered charitable trust — 80G Registration No. <b>${esc(org.reg80g)}</b> · Trust PAN <b>${esc(org.pan)}</b>. The entire amount is applied towards the trust's charitable objects; no goods, services or benefit have been provided in consideration of this donation.</span></p>
      <p><span class="n">3.</span><span>This is a computer-generated receipt issued by the trust's donor-management system and is valid without a physical signature when it carries the trust seal and registration numbers.</span></p>
    </div>

    <div class="sign-row">
      <div class="sig-for">
        For <b>${esc(org.name)}</b>
        <div class="sig-line">
          <div class="sig-name">${esc(org.signatoryName)}</div>
          <div class="sig-role">${esc(org.signatoryRole)}</div>
        </div>
      </div>
      <div class="seal">
        <b>UAR</b>
        <i>SEVA · DIGNITY</i>
        <span>TRUST SEAL</span>
      </div>
    </div>

    <div class="regs">
      <span>PAN <b>${esc(org.pan)}</b></span>
      <span>80G <b>${esc(org.reg80g)}</b></span>
      <span>12A <b>${esc(org.reg12a)}</b></span>
      <span>NGO Darpan <b>${esc(org.darpan)}</b></span>
      <span>Generated ${esc(formatDateLong(new Date()))}</span>
    </div>
  </div>
</div>
<script>window.onload=function(){window.print()}</script>`;

    return new Response(printDocument(`80G Receipt ${d.receiptNumber}`, body), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
