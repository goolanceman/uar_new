/**
 * Health orgs module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/health-orgs.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaHealthOrgRepository } from "./repositories/health-org.repository";
import { HealthOrgService } from "./services/health-org.service";
import { HealthOrgController } from "./controllers/health-org.controller";

const healthOrgRepository = new PrismaHealthOrgRepository();
const healthOrgService = new HealthOrgService(healthOrgRepository);

export const healthOrgController = new HealthOrgController(healthOrgService);
export { HealthOrgService, HealthOrgController, PrismaHealthOrgRepository };
