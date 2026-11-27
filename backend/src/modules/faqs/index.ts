/**
 * FAQs module — composition root. Wires repository → service → controller.
 * The router itself lives in src/routes/faqs.ts (preserved export path for
 * tests and the app entry) and references the controller from here.
 */
import { PrismaFaqRepository } from "./repositories/faq.repository";
import { FaqService } from "./services/faq.service";
import { FaqController } from "./controllers/faq.controller";

const faqRepository = new PrismaFaqRepository();
const faqService = new FaqService(faqRepository);

export const faqController = new FaqController(faqService);
export { FaqService, FaqController, PrismaFaqRepository };
