/**
 * Volunteer-attendances module — composition root. Wires repository →
 * service → controller. The router itself lives in
 * src/routes/volunteer-attendances.ts (preserved export path for tests and
 * the app entry) and references the controller from here.
 */
import { PrismaVolunteerAttendanceRepository } from "./repositories/volunteer-attendance.repository";
import { VolunteerAttendanceService } from "./services/volunteer-attendance.service";
import { VolunteerAttendanceController } from "./controllers/volunteer-attendance.controller";

const volunteerAttendanceRepository = new PrismaVolunteerAttendanceRepository();
const volunteerAttendanceService = new VolunteerAttendanceService(volunteerAttendanceRepository);

export const volunteerAttendanceController = new VolunteerAttendanceController(
  volunteerAttendanceService
);
export { VolunteerAttendanceService, VolunteerAttendanceController, PrismaVolunteerAttendanceRepository };
