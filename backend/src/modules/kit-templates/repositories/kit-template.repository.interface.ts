/**
 * Kit template repository contract — persistence operations for the kit
 * template catalog. The service depends on this interface, never on Prisma
 * directly.
 */
import type { Prisma } from "@prisma/client";

/** Row shape returned to the wire (legacy include on list). */
export type KitTemplateWithCounts = Prisma.KitTemplateGetPayload<{
  include: { _count: { select: { batches: true } } };
}>;

export type KitTemplateRow = Prisma.KitTemplateGetPayload<Record<string, never>>;

export interface KitTemplateCreateData {
  code: string;
  name: string;
  kind: string;
  codePrefix: string | null;
  description: string | null;
  image: string | null;
  /** Raw item array — the repository persists the JSON string (legacy). */
  items: unknown[];
  costPerUnit: number;
  status: string;
}

export interface KitTemplateUpdateData {
  name?: string;
  kind?: string;
  codePrefix?: string | null;
  image?: string | null;
  status?: string;
  description?: string | null;
  /** Raw item array — the repository persists the JSON string (legacy). */
  items?: unknown[];
  costPerUnit?: number;
}

export interface KitTemplateRepository {
  list(): Promise<KitTemplateWithCounts[]>;
  findById(id: string): Promise<KitTemplateRow | null>;
  findByIdWithBatchCount(id: string): Promise<KitTemplateWithCounts | null>;
  create(data: KitTemplateCreateData): Promise<KitTemplateRow>;
  update(id: string, data: KitTemplateUpdateData): Promise<KitTemplateRow>;
  remove(id: string): Promise<void>;
}
