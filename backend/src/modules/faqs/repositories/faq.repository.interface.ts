/**
 * FAQ repository contract — persistence operations for the FAQ catalog.
 * The service layer depends on this interface, never on Prisma directly.
 */
export interface FaqTypeRow {
  id: number;
  title: string;
  isDeleted: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FaqRow {
  id: number;
  faqsTypeId: number;
  question: string;
  answer: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FaqTypeWithFaqs extends FaqTypeRow {
  faqs: FaqRow[];
}

export interface FaqRepository {
  findTypeByTitle(title: string): Promise<FaqTypeRow | null>;
  findTypeById(id: number): Promise<FaqTypeRow | null>;
  createType(title: string): Promise<FaqTypeRow>;
  updateType(id: number, title: string): Promise<FaqTypeRow>;
  softDeleteType(id: number): Promise<void>;
  deleteFaqsOfType(typeId: number): Promise<number>;

  findFaqById(id: number): Promise<FaqRow | null>;
  createFaq(data: { faqsTypeId: number; question: string; answer: string }): Promise<FaqRow>;
  updateFaq(id: number, data: Partial<{ question: string; answer: string; faqsTypeId: number }>): Promise<FaqRow>;
  deleteFaq(id: number): Promise<void>;

  listTypesWithFaqs(skip: number, limit: number): Promise<{ rows: FaqTypeWithFaqs[]; total: number }>;
}
