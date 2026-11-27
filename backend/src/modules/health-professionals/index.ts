/**
 * Health professionals module — composition root. Wires repository → service
 * → controller. The router itself lives in src/routes/health-professionals.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaHealthProfessionalRepository } from "./repositories/health-professional.repository";
import { HealthProfessionalService } from "./services/health-professional.service";
import { HealthProfessionalController } from "./controllers/health-professional.controller";

const healthProfessionalRepository = new PrismaHealthProfessionalRepository();
const healthProfessionalService = new HealthProfessionalService(healthProfessionalRepository);

export const healthProfessionalController = new HealthProfessionalController(healthProfessionalService);
export { HealthProfessionalService, HealthProfessionalController, PrismaHealthProfessionalRepository };
