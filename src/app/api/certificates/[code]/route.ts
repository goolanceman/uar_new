import { db } from "@/lib/db";
import { ApiError, json, handleError } from "@/lib/session";
import { CERT_TYPE_TITLES, parseMeta } from "../../_lib/certificates";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

// GET /api/certificates/:code — certificate detail. Public by capability:
// the certificate code is the shared verification link.
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { code } = await ctx.params;

    const certificate = await db.certificate.findUnique({
      where: { code: decodeURIComponent(code) },
    });
    if (!certificate) throw new ApiError("Certificate not found", 404);

    return json({
      ...certificate,
      typeTitle:
        CERT_TYPE_TITLES[certificate.type as keyof typeof CERT_TYPE_TITLES] ??
        certificate.title,
      metaParsed: parseMeta(certificate.meta),
    });
  } catch (e) {
    return handleError(e);
  }
}
