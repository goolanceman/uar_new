import { db } from "@/lib/db";
import { ApiError, json, handleError } from "@/lib/session";
import { orgProfile } from "../../_lib/org";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ receiptNumber: string }> };

// GET /api/receipts/:receiptNumber — receipt detail + issuing org profile.
// Public by capability: the receipt number itself is the secret link
// (printed on the receipt and shared with the donor).
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { receiptNumber } = await ctx.params;

    const donation = await db.donation.findUnique({
      where: { receiptNumber: decodeURIComponent(receiptNumber) },
      include: {
        campaign: { select: { title: true, slug: true } },
        donor: { select: { pan: true, phone: true, name: true } },
      },
    });
    if (!donation) throw new ApiError("Receipt not found", 404);

    const org = await orgProfile();

    return json({
      donation: {
        ...donation,
        campaignTitle: donation.campaign?.title ?? null,
        // 80G receipts need the donor PAN — fall back to the profile PAN.
        pan: donation.pan ?? donation.donor?.pan ?? null,
      },
      org: {
        name: org.name,
        address: org.address,
        hq: org.hq,
        email: org.email,
        phone: org.phone,
        pan: org.pan,
        reg80g: org.reg80g,
        signatoryName: org.signatoryName,
        signatoryRole: org.signatoryRole,
        footer: org.footer,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
