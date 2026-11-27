/**
 * Testimonial controller — HTTP layer only. Extracts validated data /
 * session, delegates to the service, returns the response. Errors flow to
 * the centralized error middleware via next(error).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validatedBody, validatedParams } from "@/shared/middleware/validate";
import type {
  CreateTestimonialBody,
  UpdateTestimonialBody,
} from "../schemas/testimonial.schema";
import type { TestimonialService } from "../services/testimonial.service";

export class TestimonialController {
  constructor(private readonly testimonialService: TestimonialService) {}

  /** GET /api/testimonials — public wall */
  list: RequestHandler = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const testimonials = await this.testimonialService.listWall();
      res.json(testimonials);
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/testimonials — admin curates */
  create: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = validatedBody<CreateTestimonialBody>(req);
      const testimonial = await this.testimonialService.create(body, req.session!);
      res.status(201).json(testimonial);
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/testimonials/:id — admin edits */
  update: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const body = validatedBody<UpdateTestimonialBody>(req) ?? {};
      const testimonial = await this.testimonialService.update(id, body, req.session!);
      res.json(testimonial);
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /api/testimonials/:id — admin removes */
  remove: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = validatedParams<{ id: string }>(req);
      const result = await this.testimonialService.remove(id, req.session!);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}
