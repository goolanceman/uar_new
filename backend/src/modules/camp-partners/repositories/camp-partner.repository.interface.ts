/**
 * Camp partner repository contract — persistence for camp invitations and
 * their responses. The service layer depends on this interface, never on
 * Prisma directly.
 */
export interface CampPartnerCampRef {
  id: string;
  code: string;
  title: string;
  campDate: Date;
  venue: string;
  city: string | null;
  status: string;
}

export interface CampPartnerOrgRef {
  id: string;
  name: string;
  type: string;
  city: string | null;
  status: string;
}

export interface CampPartnerRow {
  id: string;
  campId: string;
  orgId: string;
  role: string;
  status: string;
  respondedAt: Date | null;
  notes: string | null;
  createdAt: Date;
}

export interface CampPartnerWithRefs extends CampPartnerRow {
  camp: CampPartnerCampRef;
  org: CampPartnerOrgRef;
}

/** Pre-update lookup for PATCH (legacy include: { camp: true, org: true }) —
 *  exposes the fields the ownership gate and logs actually read. */
export interface CampPartnerWithFullRefs extends CampPartnerRow {
  camp: { id: string; title: string };
  org: { id: string; name: string; ownerUserId: string | null };
}

export interface CampPartnerListFilter {
  campId?: string;
  status?: string;
  orgId?: string;
}

export interface CampPartnerRepository {
  /** Org id owned by a HOSPITAL portal user (ownerUserId is unique). */
  findOrgIdByOwner(userId: string): Promise<string | null>;
  /** Paged partner list with the camp/org reference selects, newest first. */
  list(filter: CampPartnerListFilter, skip: number, take: number): Promise<{ rows: CampPartnerWithRefs[]; total: number }>;
  findCampById(id: string): Promise<{ id: string; title: string } | null>;
  findOrgById(id: string): Promise<{ id: string; name: string } | null>;
  findPartnerByCampAndOrg(campId: string, orgId: string): Promise<{ id: string } | null>;
  createPartner(data: { campId: string; orgId: string; role: string }): Promise<CampPartnerWithRefs>;
  findPartnerWithRefsById(id: string): Promise<CampPartnerWithFullRefs | null>;
  updatePartner(
    id: string,
    data: { status?: string; notes?: string | null; respondedAt?: Date; role?: string }
  ): Promise<CampPartnerWithRefs>;
}
