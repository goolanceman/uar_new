/**
 * Notifications module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/notifications.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaNotificationRepository } from "./repositories/notification.repository";
import { NotificationService } from "./services/notification.service";
import { NotificationController } from "./controllers/notification.controller";

const notificationRepository = new PrismaNotificationRepository();
const notificationService = new NotificationService(notificationRepository);

export const notificationController = new NotificationController(notificationService);
export { NotificationService, NotificationController, PrismaNotificationRepository };
