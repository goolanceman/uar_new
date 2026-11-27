/**
 * Report controller — HTTP layer only. Extracts the validated query params
 * and the branch-dependent session gates, delegates to the service, returns
 * the response.
 *
 * Errors are rendered via lib/session handleError directly (the payments-
 * controller pattern) — the legacy handlers wrapped everything in
 * try/catch + handleError, and test harnesses mount this router on bare
 * Express apps without an app-level error middleware. In the real app the
 * centralized middleware renders through the identical handleError.
 *
 * The GET handler keeps the legacy three-branch dispatch on one route; the
 * auth gates are branch-dependent (ADMIN/VOLUNTEER for ?type, ADMIN for the
 * range report, optional session for the public FY payload), so they stay
 * as inline lib calls instead of route-level middleware — preserving the
 * legacy evaluation order exactly.
 */
import type { Request, RequestHandler, Response } from "express";
import { handleError, requireRole, validateSession } from "@/lib/session";
import { validatedQuery } from "@/shared/middleware/validate";
import type { ReportService } from "../services/report.service";
import type { ReportsQuery } from "../schemas/report.schema";

export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  /**
   * GET /api/reports — three branches on one route:
   *
   * 1. ?type=overview|donations|distributions|causes|animals&from&to
   *    Legacy typed reports (ADMIN/VOLUNTEER).
   *
   * 2. ?from=YYYY-MM-DD&to=YYYY-MM-DD&compare=1   (ADMIN only — reports module)
   *    Consolidated trust-report payload for an arbitrary period with an
   *    optional previous-period comparison. Every number is a live DB
   *    aggregate (no synthetic data).
   *
   * 3. ?fy=YYYY  (or bare)
   *    Public consolidated FY payload consumed by the Impact page and the
   *    admin dashboard. Same shape as round 3 — topDonors filled only for
   *    ADMIN callers. FY = April → March; `fy` is the START year.
   */
  get: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const query = validatedQuery<ReportsQuery>(req);

      // Branch 1 — legacy typed reports (ADMIN/VOLUNTEER).
      if (query.type) {
        await requireRole(req, "ADMIN", "VOLUNTEER");
        res.json(await this.reportService.legacyTypedReport(query.type, query.from, query.to));
        return;
      }

      // Branch 2 — ADMIN-only consolidated range report (reports module).
      if (query.from || query.to || query.compare) {
        await requireRole(req, "ADMIN");
        res.json(await this.reportService.adminRangeReport(query.from, query.to, query.compare));
        return;
      }

      // Branch 3 — public consolidated FY payload (Impact page + admin
      // dashboard); the session only enriches the response for ADMINs.
      const session = await validateSession(req);
      res.json(await this.reportService.publicFyReport(session?.role === "ADMIN", query.fy));
    } catch (error) {
      handleError(error, res);
    }
  };

  /** GET /api/reports/sponsorship-coverage (ADMIN only — route-level gate). */
  sponsorshipCoverage: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.reportService.sponsorshipCoverage());
    } catch (error) {
      handleError(error, res);
    }
  };
}
