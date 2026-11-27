/**
 * Volunteers module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/volunteers.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaVolunteerRepository } from "./repositories/volunteer.repository";
import { VolunteerService } from "./services/volunteer.service";
import { VolunteerController } from "./controllers/volunteer.controller";

const volunteerRepository = new PrismaVolunteerRepository();
const volunteerService = new VolunteerService(volunteerRepository);

export const volunteerController = new VolunteerController(volunteerService);
export { VolunteerService, VolunteerController, PrismaVolunteerRepository };
