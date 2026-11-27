/**
 * Volunteer tasks module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/volunteer-tasks.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaVolunteerTaskRepository } from "./repositories/volunteer-task.repository";
import { VolunteerTaskService } from "./services/volunteer-task.service";
import { VolunteerTaskController } from "./controllers/volunteer-task.controller";

const volunteerTaskRepository = new PrismaVolunteerTaskRepository();
const volunteerTaskService = new VolunteerTaskService(volunteerTaskRepository);

export const volunteerTaskController = new VolunteerTaskController(volunteerTaskService);
export { VolunteerTaskService, VolunteerTaskController, PrismaVolunteerTaskRepository };
