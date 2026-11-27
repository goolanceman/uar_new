/**
 * Reports routes — /api/reports, /api/reports/sponsorship-coverage
 * Thin endpoint definitions; all logic lives in src/modules/reports
 * (routes → controllers → services → repositories).
 * The historical export path (`@/routes/reports`) is preserved.
 */
import { Router } from "express";
import { authorize } from "@/shared/middleware/auth";
import { validate } from "@/shared/middleware/validate";
import { reportsQuerySchema } from "@/modules/reports/schemas/report.schema";
import { reportController } from "@/modules/reports";

export const router = Router();

// GET /api/reports — three branches on one route:
//
// 1. ?type=overview|donations|distributions|causes|animals&from&to
//    Legacy typed reports (ADMIN/VOLUNTEER).
//
// 2. ?from=YYYY-MM-DD&to=YYYY-MM-DD&compare=1   (ADMIN only — reports module)
//    Consolidated trust-report payload for an arbitrary period with an
//    optional previous-period comparison. Every number is a live DB
//    aggregate (no synthetic data).
//
// 3. ?fy=YYYY  (or bare)
//    Public consolidated FY payload consumed by the Impact page and the
//    admin dashboard. Same shape as round 3 — topDonors filled only for
//    ADMIN callers. FY = April → March; `fy` is the START year.
//
// The branch dispatch — and with it the branch-dependent auth gates — stays
// inside the controller, exactly like the legacy handler (the schema below
// never rejects; it only normalizes sp.get semantics).
router.get("/", validate({ query: reportsQuerySchema }), reportController.get);

// GET /api/reports/sponsorship-coverage (ADMIN only)
// Coverage of standing (recurring) beneficiary needs by monthly donor
// sponsorships — how much of what beneficiaries need every month is actually
// backed by a committed sponsor, donor retention on that commitment, and
// which lapsed sponsors/unsponsored needs deserve attention.
router.get("/sponsorship-coverage", authorize("ADMIN"), reportController.sponsorshipCoverage);
