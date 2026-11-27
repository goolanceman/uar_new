/**
 * Volunteer-assignments module — composition root. Wires repository →
 * service → controller. The router itself lives in
 * src/routes/volunteer-assignments.ts (preserved export path for tests and
 * the app entry) and references the controller from here.
 */
import { PrismaVolunteerAssignmentRepository } from "./repositories/volunteer-assignment.repository";
import { VolunteerAssignmentService } from "./services/volunteer-assignment.service";
import { VolunteerAssignmentController } from "./controllers/volunteer-assignment.controller";

const volunteerAssignmentRepository = new PrismaVolunteerAssignmentRepository();
const volunteerAssignmentService = new VolunteerAssignmentService(volunteerAssignmentRepository);

export const volunteerAssignmentController = new VolunteerAssignmentController(
  volunteerAssignmentService
);
export { VolunteerAssignmentService, VolunteerAssignmentController, PrismaVolunteerAssignmentRepository };
