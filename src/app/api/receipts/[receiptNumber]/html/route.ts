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
// 80G donation receipt (inline CSS only, auto window.print). Public with
// the receipt number acting as the capability.
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
      : '<span style="color:#6b7280;">— (UPI reference / bank statement)</span>';

    const body = `
<style>
  .sheet { width: 210mm; min-height: 297mm; padding: 13mm 15mm 11mm; position: relative; }
  .rule-double { border: 0; border-top: 3px double #047857; margin: 10px 0 0; }
  .lh { display: flex; align-items: center; gap: 14px; }
  .lh-mono { width: 62px; height: 62px; border-radius: 50%; border: 2.5px solid #047857; background: radial-gradient(circle at 30% 25%, #d1fae5, #ffffff 70%); color: #065f46; display: flex; align-items: center; justify-content: center; font: 700 20px Georgia, serif; letter-spacing: 1px; flex-shrink: 0; }
  .lh-name { font: 700 25px Georgia, 'Times New Roman', serif; color: #064e3b; letter-spacing: 0.5px; }
  .lh-tag { font: italic 12px Georgia, serif; color: #047857; margin-top: 1px; }
  .lh-addr { font-size: 11px; color: #4b5563; margin-top: 4px; line-height: 1.5; }
  .doc-head { text-align: center; margin: 18px 0 6px; }
  .doc-title { font: 700 21px Georgia, 'Times New Roman', serif; letter-spacing: 3.5px; color: #065f46; }
  .doc-sub { font: italic 12.5px Georgia, serif; color: #4b5563; margin-top: 3px; }
  .meta-strip { display: flex; justify-content: space-between; gap: 10px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 9px 16px; margin: 14px 0 0; }
  .meta-cell { font-size: 11.5px; color: #065f46; }
  .meta-cell b { display: block; font: 700 13.5px Georgia, serif; color: #064e3b; margin-top: 2px; }
  .sec-label { font: 700 10.5px 'Segoe UI', Arial, sans-serif; letter-spacing: 2px; color: #047857; text-transform: uppercase; margin: 18px 0 7px; }
  .donor-card { border: 1px solid #d1fae5; border-left: 4px solid #059669; border-radius: 8px; padding: 12px 16px; background: #f8fdfb; }
  .donor-name { font: 700 16.5px Georgia, serif; color: #111827; }
  .donor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 22px; margin-top: 7px; font-size: 12px; color: #374151; }
  .donor-grid span { color: #6b7280; }
  .amount-box { text-align: center; border: 1.5px solid #047857; border-radius: 10px; background: linear-gradient(180deg, #f0fdf6, #ffffff); padding: 15px 16px 13px; margin-top: 4px; }
  .amount-fig { font: 700 30px Georgia, 'Times New Roman', serif; color: #064e3b; letter-spacing: 0.5px; }
  .amount-words { font: italic 13px Georgia, serif; color: #047857; margin-top: 5px; padding-top: 7px; border-top: 1px dashed #a7f3d0; }
  table.details { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.details th { text-align: left; font: 700 10px 'Segoe UI', Arial, sans-serif; letter-spacing: 1.5px; text-transform: uppercase; color: #065f46; background: #ecfdf5; padding: 7px 10px; border: 1px solid #d1fae5; }
  table.details td { padding: 7px 10px; border: 1px solid #e5e7eb; color: #1f2937; }
  .badge { display: inline-block; background: #d1fae5; color: #065f46; font-weight: 700; font-size: 10.5px; border-radius: 999px; padding: 2px 10px; letter-spacing: 0.5px; }
  .decl { border: 1px solid #e5e7eb; border-radius: 8px; padding: 11px 15px; background: #fafcfa; }
  .decl p { font-size: 11px; color: #374151; line-height: 1.65; display: flex; gap: 7px; }
  .decl p + p { margin-top: 4px; }
  .decl .dot { color: #059669; font-weight: 700; }
  .sign-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 26px; gap: 20px; }
  .sign-for { font-size: 12px; color: #374151; }
  .sig-name { font: 700 14.5px Georgia, serif; color: #111827; border-top: 1.5px solid #374151; padding-top: 6px; margin-top: 46px; }
  .sig-role { font-size: 11px; color: #6b7280; margin-top: 1px; }
  .seal { width: 108px; height: 108px; border-radius: 50%; border: 3px solid #b08d2f; outline: 1.5px solid #047857; outline-offset: -9px; background: radial-gradient(circle at 32% 28%, #fef3c7, #fde68a 55%, #d1fae5); display: flex; flex-direction: column; align-items: center; justify-content: center; color: #065f46; text-align: center; transform: rotate(-6deg); }
  .seal b { font: 700 17px Georgia, serif; letter-spacing: 1px; }
  .seal i { font: italic 8px Georgia, serif; letter-spacing: 1.5px; }
  .seal span { font-size: 8.5px; letter-spacing: 2px; color: #92650d; }
  .foot { border-top: 1px solid #e5e7eb; margin-top: 22px; padding-top: 8px; text-align: center; font-size: 9.5px; color: #6b7280; line-height: 1.6; }
  @media print { .sheet { box-shadow: none; } }
</style>
<div class="sheet">
  <div class="lh">
    <div class="lh-mono">UAR</div>
    <div>
      <div class="lh-name">${esc(org.name)}</div>
      <div class="lh-tag">Service · Dignity · Transparency · Technology-for-Good</div>
      <div class="lh-addr">${esc(org.address)}<br/>${esc(org.email)} &nbsp;·&nbsp; ${esc(org.phone)} &nbsp;·&nbsp; ${esc(org.hq)}</div>
    </div>
  </div>
  <hr class="rule-double" />

  <div class="doc-head">
    <div class="doc-title">DONATION RECEIPT</div>
    <div class="doc-sub">(under Section 80G of the Income-tax Act, 1961)</div>
  </div>

  <div class="meta-strip">
    <div class="meta-cell">Receipt No.<b>${esc(d.receiptNumber)}</b></div>
    <div class="meta-cell">Date<b>${esc(formatDateLong(d.createdAt))}</b></div>
    <div class="meta-cell">Financial Year<b>${esc(financialYear(d.createdAt))}</b></div>
    <div class="meta-cell">Receipt Type<b>80G — Tax Deduction</b></div>
  </div>

  <div class="sec-label">Donor</div>
  <div class="donor-card">
    <div class="donor-name">Received with sincere gratitude from ${esc(d.isAnonymous ? "Anonymous Donor" : d.donorName)}</div>
    <div class="donor-grid">
      <div><span>Name:</span> ${esc(d.isAnonymous ? "Anonymous" : d.donorName)}</div>
      <div><span>PAN:</span> ${donorPan ? esc(donorPan) : '<span style="color:#9ca3af;">not provided</span>'}</div>
      <div><span>Email:</span> ${esc(d.donorEmail)}</div>
      <div><span>Phone:</span> ${esc(d.donorPhone ?? "—")}</div>
    </div>
  </div>

  <div class="sec-label">Donation</div>
  <div class="amount-box">
    <div class="amount-fig">${esc(formatINR(d.amount))} <span style="font-size:14px;color:#6b7280;">(${esc(d.currency)})</span></div>
    <div class="amount-words">${esc(amountInWords(d.amount))}</div>
  </div>
  <table class="details" style="margin-top:10px;">
    <tr>
      <th style="width:34%;">Purpose</th>
      <th style="width:22%;">Category</th>
      <th style="width:22%;">Payment Method</th>
      <th style="width:22%;">Status</th>
    </tr>
    <tr>
      <td>${esc(d.campaign?.title ?? "General Fund — wherever the need is greatest")}</td>
      <td>${esc(category)}</td>
      <td>${esc(titleCase(d.paymentMethod))}${d.type === "RECURRING" ? " · Monthly" : ""}</td>
      <td><span class="badge">${esc(d.paymentStatus)}</span></td>
    </tr>
    <tr>
      <th>Donation Type</th>
      <th>Transaction ID</th>
      <th>Donor Type</th>
      <th>Receipt Generated</th>
    </tr>
    <tr>
      <td>${esc(titleCase(d.type))}</td>
      <td>${txn}</td>
      <td>${d.donorId ? "Registered Donor" : "Guest Donor"}</td>
      <td>${esc(formatDateLong(new Date()))}</td>
    </tr>
  </table>

  <div class="sec-label">Declaration</div>
  <div class="decl">
    <p><span class="dot">1.</span><span>This donation is eligible for deduction under Section 80G of the Income-tax Act, 1961, to the extent permitted by law. Please retain this receipt for your income-tax records.</span></p>
    <p><span class="dot">2.</span><span>${esc(org.name)} is a registered charitable trust — 80G Registration No. <b>${esc(org.reg80g)}</b> · Trust PAN <b>${esc(org.pan)}</b>. Donor PAN above is mandatory for claiming the deduction.</span></p>
    <p><span class="dot">3.</span><span>No goods, services or other benefit have been provided to the donor in consideration of this donation; the entire amount is applied towards the trust's charitable objects.</span></p>
    <p><span class="dot">4.</span><span>This is a computer-generated receipt issued by the trust's donor-management system and is valid without a physical signature when it carries the trust seal and registration numbers above.</span></p>
  </div>

  <div class="sign-row">
    <div class="sign-for">
      For <b>${esc(org.name)}</b>
      <div class="sig-name">${esc(org.signatoryName)}</div>
      <div class="sig-role">${esc(org.signatoryRole)}</div>
    </div>
    <div class="seal">
      <b>★ UAR ★</b>
      <i>SEVA · DIGNITY · SEVA</i>
      <span>TRUST SEAL</span>
    </div>
  </div>

  <div class="foot">${esc(org.footer)}</div>
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
