import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  requireAuth,
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";
import { CERT_TYPE_TITLES, isCertificateType } from "../_lib/certificates";

export const dynamic = "force-dynamic";

async function nextCertificateCode(): Promise<string> {
  const year = new Date().getFullYear();
  let n = (await db.certificate.count()) + 1;
  let code = `UAR-CERT-${year}-${String(n).padStart(5, "0")}`;
  while (await db.certificate.findUnique({ where: { code } })) {
    n += 1;
    code = `UAR-CERT-${year}-${String(n).padStart(5, "0")}`;
  }
  return code;
}

// GET /api/certificates?limit=50 — newest first.
// ADMIN: all certificates · other signed-in roles: only their own (userId).
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const sp = new URL(req.url).searchParams;
    const limitRaw = parseInt(sp.get("limit") ?? "50", 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 200)
      : 50;

    const rows = await db.certificate.findMany({
      where: session.role === "ADMIN" ? {} : { userId: session.userId },
      orderBy: { issuedAt: "desc" },
      take: limit,
    });

    return json(
      rows.map((c) => ({
        ...c,
        typeTitle: CERT_TYPE_TITLES[c.type as keyof typeof CERT_TYPE_TITLES] ?? c.title,
      }))
    );
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/certificates — ADMIN issues a certificate.
// Body: { type, recipientName, recipientEmail?, userId?, title?,
//         description?, refType?, refId?, meta? }
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("ADMIN");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const type = String(body?.type ?? "").trim();
    if (!isCertificateType(type))
      throw new ApiError(
        `type must be one of: ${Object.keys(CERT_TYPE_TITLES).join(", ")}`,
        400
      );

    const recipientName = String(body?.recipientName ?? "").trim();
    if (!recipientName)
      throw new ApiError("recipientName is required", 400);

    const recipientEmail = body?.recipientEmail
      ? String(body.recipientEmail).trim().toLowerCase()
      : null;
    if (recipientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail))
      throw new ApiError("recipientEmail does not look valid", 400);

    const userId = body?.userId ? String(body.userId) : null;
    if (userId) {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) throw new ApiError("Linked user (userId) was not found", 400);
    }

    const meta = (() => {
      if (body?.meta === undefined || body?.meta === null) return null;
      if (typeof body.meta === "string") {
        const raw = body.meta.trim();
        if (!raw) return null;
        try {
          return JSON.stringify(JSON.parse(raw));
        } catch {
          return JSON.stringify({ note: raw });
        }
      }
      if (typeof body.meta === "object") return JSON.stringify(body.meta);
      return null;
    })();

    const title = body?.title ? String(body.title).trim() : CERT_TYPE_TITLES[type];
    const description = body?.description ? String(body.description).trim() : null;
    const refType = body?.refType ? String(body.refType).trim() : null;
    const refId = body?.refId ? String(body.refId).trim() : null;

    const code = await nextCertificateCode();

    const certificate = await db.certificate.create({
      data: {
        code,
        type,
        recipientName,
        recipientEmail,
        userId,
        title,
        description,
        refType,
        refId,
        issuedBy: session.name,
        meta,
      },
    });

    await logActivity(
      session.name,
      "CERTIFICATE_ISSUE",
      "CERTIFICATE",
      `${code} (${type}) → ${recipientName}`,
      session.userId
    );

    return json({ certificate }, 201);
  } catch (e) {
    return handleError(e);
  }
}
