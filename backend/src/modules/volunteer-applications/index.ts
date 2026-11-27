/**
 * Volunteer applications module — composition root. Wires repository →
 * service → controller. The router itself lives in
 * src/routes/volunteer-applications.ts (preserved export path for tests and
 * the app entry) and references the controller from here.
 */
import { PrismaVolunteerApplicationRepository } from "./repositories/volunteer-application.repository";
import { VolunteerApplicationService } from "./services/volunteer-application.service";
import { VolunteerApplicationController } from "./controllers/volunteer-application.controller";

const volunteerApplicationRepository = new PrismaVolunteerApplicationRepository();
const volunteerApplicationService = new VolunteerApplicationService(volunteerApplicationRepository);

export const volunteerApplicationController = new VolunteerApplicationController(
  volunteerApplicationService
);
export { VolunteerApplicationService, VolunteerApplicationController, PrismaVolunteerApplicationRepository };
