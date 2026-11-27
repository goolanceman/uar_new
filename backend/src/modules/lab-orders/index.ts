/**
 * Lab orders module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/lab-orders.ts (preserved
 * export path for tests and the app entry) and references the controller
 * from here.
 */
import { PrismaLabOrderRepository } from "./repositories/lab-order.repository";
import { LabOrderService } from "./services/lab-order.service";
import { LabOrderController } from "./controllers/lab-order.controller";

const labOrderRepository = new PrismaLabOrderRepository();
const labOrderService = new LabOrderService(labOrderRepository);

export const labOrderController = new LabOrderController(labOrderService);
export { LabOrderService, LabOrderController, PrismaLabOrderRepository };
