/**
 * Certificate service — issuing rules and capability-URL lookups. The
 * certificate code is the shared verification link: detail and print-ready
 * HTML lookups are public. Depends on the repository contract, throws
 * application errors, never touches HTTP.
 *
 * The legacy POST validated body fields mid-handler after the auth gate, so
 * those checks and their exact messages live here instead of in a route-level
 * Zod schema.
 */
import { logger } from "@/lib/logger";
import { CERT_TYPE_TITLES, isCertificateType, parseMeta, certificateHtml } from "@/lib/certificates-pdf";
import { orgProfile } from "@/lib/api-org";
import { ApiError } from "@/shared/errors";
import { logActivity, type Session } from "@/lib/session";
import type {
  CertificateListScope,
  CertificateRepository,
  CertificateRow,
} from "../repositories/certificate.repository.interface";
import type { CreateCertificateBody } from "../schemas/certificate.schema";

const log = logger.child("certificates");

export interface CertificateWithTypeTitle extends CertificateRow {
  typeTitle: string;
}

export interface CertificateDetail extends CertificateWithTypeTitle {
  metaParsed: [string, string][];
}

export class CertificateService {
  constructor(private readonly certificateRepository: CertificateRepository) {}

  /**
   * GET /api/certificates?limit=50 — newest first. ADMIN: all certificates ·
   * other signed-in roles: only their own (userId).
   */
  async list(actor: Session, limit: number): Promise<CertificateWithTypeTitle[]> {
    const scope: CertificateListScope = actor.role === "ADMIN" ? {} : { userId: actor.userId };
    const rows = await this.certificateRepository.list(scope, limit);
    return rows.map((c) => ({
      ...c,
      typeTitle: CERT_TYPE_TITLES[c.type as keyof typeof CERT_TYPE_TITLES] ?? c.title,
    }));
  }

  /**
   * POST /api/certificates — ADMIN issues a certificate. Body: { type,
   * recipientName, recipientEmail?, userId?, title?, description?, refType?,
   * refId?, meta? }
   */
  async create(body: CreateCertificateBody, actor: Session): Promise<CertificateRow> {
    const type = String(body?.type ?? "").trim();
    if (!isCertificateType(type))
      throw new ApiError(
        `type must be one of: ${Object.keys(CERT_TYPE_TITLES).join(", ")}`,
        400
      );

    const recipientName = String(body?.recipientName ?? "").trim();
    if (!recipientName) throw new ApiError("recipientName is required", 400);

    const recipientEmail = body?.recipientEmail
      ? String(body.recipientEmail).trim().toLowerCase()
      : null;
    if (recipientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail))
      throw new ApiError("recipientEmail does not look valid", 400);

    const userId = body?.userId ? String(body.userId) : null;
    if (userId) {
      const user = await this.certificateRepository.findUserById(userId);
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

    const code = await this.nextCertificateCode();

    const certificate = await this.certificateRepository.create({
      code,
      type,
      recipientName,
      recipientEmail,
      userId,
      title,
      description,
      refType,
      refId,
      issuedBy: actor.name,
      meta,
    });

    log.info("certificate_issued", {
      code,
      type,
      recipientEmail,
      actor: actor.userId,
    });
    await logActivity(
      actor.name,
      "CERTIFICATE_ISSUE",
      "CERTIFICATE",
      `${code} (${type}) → ${recipientName}`,
      actor.userId
    );

    return certificate;
  }

  /**
   * GET /api/certificates/:code — certificate detail. Public by capability:
   * the certificate code is the shared verification link.
   */
  async getByCode(code: string): Promise<CertificateDetail> {
    const certificate = await this.certificateRepository.findByCode(decodeURIComponent(code));
    if (!certificate) throw new ApiError("Certificate not found", 404);

    return {
      ...certificate,
      typeTitle:
        CERT_TYPE_TITLES[certificate.type as keyof typeof CERT_TYPE_TITLES] ??
        certificate.title,
      metaParsed: parseMeta(certificate.meta),
    };
  }

  /**
   * GET /api/certificates/:code/html — self-contained, print-ready A4 award
   * certificate (inline CSS only, auto window.print). Public with the
   * certificate code acting as the capability.
   */
  async getHtmlByCode(code: string): Promise<string> {
    const certificate = await this.certificateRepository.findByCode(decodeURIComponent(code));
    if (!certificate) throw new ApiError("Certificate not found", 404);

    const org = await orgProfile();
    return certificateHtml(certificate, org);
  }

  /** Sequential code allocation: UAR-CERT-<year>-<00001>, skipping collisions. */
  private async nextCertificateCode(): Promise<string> {
    const year = new Date().getFullYear();
    let n = (await this.certificateRepository.count()) + 1;
    let code = `UAR-CERT-${year}-${String(n).padStart(5, "0")}`;
    while (await this.certificateRepository.findByCode(code)) {
      n += 1;
      code = `UAR-CERT-${year}-${String(n).padStart(5, "0")}`;
    }
    return code;
  }
}
