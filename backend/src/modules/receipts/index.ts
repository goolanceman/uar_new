/**
 * Receipts module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/receipts.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaReceiptRepository } from "./repositories/receipt.repository";
import { ReceiptService } from "./services/receipt.service";
import { ReceiptController } from "./controllers/receipt.controller";

const receiptRepository = new PrismaReceiptRepository();
const receiptService = new ReceiptService(receiptRepository);

export const receiptController = new ReceiptController(receiptService);
export { ReceiptService, ReceiptController, PrismaReceiptRepository };
