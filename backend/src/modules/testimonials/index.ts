/**
 * Testimonials module — composition root. Wires repository → service →
 * controller. The router itself lives in src/routes/testimonials.ts
 * (preserved export path for tests and the app entry) and references the
 * controller from here.
 */
import { PrismaTestimonialRepository } from "./repositories/testimonial.repository";
import { TestimonialService } from "./services/testimonial.service";
import { TestimonialController } from "./controllers/testimonial.controller";

const testimonialRepository = new PrismaTestimonialRepository();
const testimonialService = new TestimonialService(testimonialRepository);

export const testimonialController = new TestimonialController(testimonialService);
export { TestimonialService, TestimonialController, PrismaTestimonialRepository };
