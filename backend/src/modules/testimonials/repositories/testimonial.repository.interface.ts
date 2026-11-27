/**
 * Testimonial repository contract — persistence operations for the public
 * testimonial wall. The service layer depends on this interface, never on
 * Prisma directly.
 */
export interface TestimonialRow {
  id: string;
  name: string;
  role: string;
  message: string;
  rating: number;
  createdAt: Date;
}

export interface TestimonialCreateData {
  name: string;
  role: string;
  message: string;
  rating: number;
}

export interface TestimonialUpdateData {
  name?: string;
  role?: string;
  message?: string;
  rating?: number;
}

export interface TestimonialRepository {
  findWall(): Promise<TestimonialRow[]>;
  findById(id: string): Promise<TestimonialRow | null>;
  create(data: TestimonialCreateData): Promise<TestimonialRow>;
  update(id: string, data: TestimonialUpdateData): Promise<TestimonialRow>;
  delete(id: string): Promise<void>;
}
