/**
 * Appointments module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/appointments.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaAppointmentRepository } from "./repositories/appointment.repository";
import { AppointmentService } from "./services/appointment.service";
import { AppointmentController } from "./controllers/appointment.controller";

const appointmentRepository = new PrismaAppointmentRepository();
const appointmentService = new AppointmentService(appointmentRepository);

export const appointmentController = new AppointmentController(appointmentService);
export { AppointmentService, AppointmentController, PrismaAppointmentRepository };
