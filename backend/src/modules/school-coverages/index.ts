/**
 * School-coverages module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/school-coverages.ts
 * (preserved export path for tests and the app entry).
 */
import { PrismaSchoolCoverageRepository } from "./repositories/school-coverage.repository";
import { SchoolCoverageService } from "./services/school-coverage.service";
import { SchoolCoverageController } from "./controllers/school-coverage.controller";

const schoolCoverageRepository = new PrismaSchoolCoverageRepository();
const schoolCoverageService = new SchoolCoverageService(schoolCoverageRepository);

export const schoolCoverageController = new SchoolCoverageController(schoolCoverageService);
export { SchoolCoverageService, SchoolCoverageController, PrismaSchoolCoverageRepository };
