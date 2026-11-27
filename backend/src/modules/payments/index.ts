/**
 * Payments module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/payments.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaPaymentRepository } from "./repositories/payment.repository";
import { PaymentService } from "./services/payment.service";
import { PaymentController } from "./controllers/payment.controller";

const paymentRepository = new PrismaPaymentRepository();
const paymentService = new PaymentService(paymentRepository);

export const paymentController = new PaymentController(paymentService);
export { PaymentService, PaymentController, PrismaPaymentRepository };
