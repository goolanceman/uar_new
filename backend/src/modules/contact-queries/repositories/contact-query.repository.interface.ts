/**
 * Contact query repository contract — persistence operations for the admin
 * contact-query inbox. The service depends on this interface, never on
 * Prisma directly.
 */
import type { ContactQuery, Prisma } from "@prisma/client";

export type ContactQueryRow = ContactQuery;

export interface ContactQueryRepository {
  list(status?: string): Promise<ContactQueryRow[]>;
  create(data: {
    name: string;
    email: string;
    phone: string | null;
    subject: string;
    message: string;
    status: string;
  }): Promise<ContactQueryRow>;
  findById(id: string): Promise<ContactQueryRow | null>;
  update(id: string, data: Prisma.ContactQueryUpdateInput): Promise<ContactQueryRow>;
  remove(id: string): Promise<void>;
}
