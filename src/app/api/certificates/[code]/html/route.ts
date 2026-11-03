import { db } from "@/lib/db";
import { ApiError, handleError } from "@/lib/session";
import { orgProfile } from "../../../_lib/org";
import { certificateHtml } from "../../../_lib/certificates";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

// GET /api/certificates/:code/html — self-contained, print-ready A4 award
// certificate (inline CSS only, auto window.print). Public with the
// certificate code acting as the capability.
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { code } = await ctx.params;

    const certificate = await db.certificate.findUnique({
      where: { code: decodeURIComponent(code) },
    });
    if (!certificate) throw new ApiError("Certificate not found", 404);

    const org = await orgProfile();

    return new Response(certificateHtml(certificate, org), {
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
