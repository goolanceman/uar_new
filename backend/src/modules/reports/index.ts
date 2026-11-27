/**
 * Reports module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/reports.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaReportRepository } from "./repositories/report.repository";
import { ReportService } from "./services/report.service";
import { ReportController } from "./controllers/report.controller";

const reportRepository = new PrismaReportRepository();
const reportService = new ReportService(reportRepository);

export const reportController = new ReportController(reportService);
export { ReportService, ReportController, PrismaReportRepository };
