/**
 * Certificates routes — /api/certificates, /api/certificates/:code, /api/certificates/:code/html
 * Converted 1:1 from src/app/api/certificates/* (Next.js route handlers) to Express.
 */
import { Router } from "express";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireAuth,
  requireRole,
  ApiError,
  json,
  handleError,
  logActivity,
} from "@/lib/session";
import { CERT_TYPE_TITLES, isCertificateType, parseMeta, certificateHtml } from "@/lib/certificates-pdf";
import { orgProfile } from "@/lib/api-org";

export const router = Router();

const log = logger.child("certificates");

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
router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req);
    const sp = new URL(req.url, "http://localhost").searchParams;
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
      res,
      rows.map((c) => ({
        ...c,
        typeTitle: CERT_TYPE_TITLES[c.type as keyof typeof CERT_TYPE_TITLES] ?? c.title,
      }))
    );
  } catch (e) {
    return handleError(e, res);
  }
});

// POST /api/certificates — ADMIN issues a certificate.
// Body: { type, recipientName, recipientEmail?, userId?, title?,
//         description?, refType?, refId?, meta? }
router.post("/", async (req, res) => {
  try {
    const session = await requireRole(req, "ADMIN");
    const body = (req.body ?? {}) as Record<string, unknown>;

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

    log.info("certificate_issued", {
      code,
      type,
      recipientEmail,
      actor: session.userId,
    });
    await logActivity(
      session.name,
      "CERTIFICATE_ISSUE",
      "CERTIFICATE",
      `${code} (${type}) → ${recipientName}`,
      session.userId
    );

    return json(res, { certificate }, 201);
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/certificates/:code — certificate detail. Public by capability:
// the certificate code is the shared verification link.
router.get("/:code", async (req, res) => {
  try {
    const { code } = req.params;

    const certificate = await db.certificate.findUnique({
      where: { code: decodeURIComponent(code) },
    });
    if (!certificate) throw new ApiError("Certificate not found", 404);

    return json(res, {
      ...certificate,
      typeTitle:
        CERT_TYPE_TITLES[certificate.type as keyof typeof CERT_TYPE_TITLES] ??
        certificate.title,
      metaParsed: parseMeta(certificate.meta),
    });
  } catch (e) {
    return handleError(e, res);
  }
});

// GET /api/certificates/:code/html — self-contained, print-ready A4 award
// certificate (inline CSS only, auto window.print). Public with the
// certificate code acting as the capability.
router.get("/:code/html", async (req, res) => {
  try {
    const { code } = req.params;

    const certificate = await db.certificate.findUnique({
      where: { code: decodeURIComponent(code) },
    });
    if (!certificate) throw new ApiError("Certificate not found", 404);

    const org = await orgProfile();

    return res
      .status(200)
      .setHeader("content-type", "text/html; charset=utf-8")
      .setHeader("cache-control", "no-store")
      .send(certificateHtml(certificate, org));
  } catch (e) {
    return handleError(e, res);
  }
});
