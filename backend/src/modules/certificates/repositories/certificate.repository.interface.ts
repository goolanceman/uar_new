/**
 * Certificate repository contract — issued certificates and the linked-user
 * existence check. The service layer depends on this interface, never on
 * Prisma directly.
 */
export interface CertificateRow {
  id: string;
  code: string;
  type: string;
  recipientName: string;
  recipientEmail: string | null;
  userId: string | null;
  title: string;
  description: string | null;
  refType: string | null;
  refId: string | null;
  issuedBy: string | null;
  meta: string | null;
  issuedAt: Date;
}

export interface CreateCertificateData {
  code: string;
  type: string;
  recipientName: string;
  recipientEmail: string | null;
  userId: string | null;
  title: string;
  description: string | null;
  refType: string | null;
  refId: string | null;
  issuedBy: string | null;
  meta: string | null;
}

export interface CertificateListScope {
  userId?: string;
}

export interface CertificateRepository {
  count(): Promise<number>;
  findByCode(code: string): Promise<CertificateRow | null>;
  list(scope: CertificateListScope, limit: number): Promise<CertificateRow[]>;
  findUserById(id: string): Promise<{ id: string } | null>;
  create(data: CreateCertificateData): Promise<CertificateRow>;
}
