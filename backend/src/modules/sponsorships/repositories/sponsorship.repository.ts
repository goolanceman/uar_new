/**
 * Prisma implementation of the sponsorship repository — the ONLY place in
 * the sponsorships module that touches Prisma models directly.
 */
import { Prisma, type Beneficiary, type BeneficiarySponsorship, type Donor, type RecurringNeed } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import {
  SPONSORSHIP_INCLUDE,
  SPONSORSHIP_UPDATE_INCLUDE,
} from "./sponsorship.repository.interface";
import type {
  MatchDonor,
  MatchNeed,
  SponsorshipCreateData,
  SponsorshipListFilter,
  SponsorshipRepository,
  SponsorshipRow,
  SponsorshipUpdateData,
  SponsorshipUpdatedRow,
} from "./sponsorship.repository.interface";

export class PrismaSponsorshipRepository implements SponsorshipRepository {
  async findDonorIdByUserId(userId: string): Promise<string | null> {
    const donor = await db.donor.findUnique({ where: { userId }, select: { id: true } });
    return donor?.id ?? null;
  }

  async list(filter: SponsorshipListFilter): Promise<SponsorshipRow[]> {
    const where: Record<string, unknown> = {};
    if (filter.donorId) where.donorId = filter.donorId;
    if (filter.beneficiaryId) where.beneficiaryId = filter.beneficiaryId;
    if (filter.status) where.status = filter.status;

    return db.beneficiarySponsorship.findMany({
      where,
      include: SPONSORSHIP_INCLUDE,
      orderBy: { createdAt: "desc" },
    }) as Promise<SponsorshipRow[]>;
  }

  async findMatchingSettings(): Promise<Array<{ key: string; value: string }>> {
    return db.setting.findMany({
      where: { key: { startsWith: "matching." } },
      select: { key: true, value: true },
    });
  }

  async listMatchableNeeds(): Promise<MatchNeed[]> {
    // Needs that are active and have no ACTIVE/PAUSED sponsorship yet.
    return db.recurringNeed.findMany({
      where: {
        status: "ACTIVE",
        sponsorships: { none: { status: { in: ["ACTIVE", "PAUSED"] } } },
      },
      include: {
        beneficiary: { select: { id: true, name: true, city: true, urgencyLevel: true } },
        item: { select: { id: true, name: true, unit: true, pricePerUnit: true } },
      },
      orderBy: { nextDueAt: "asc" },
    }) as Promise<MatchNeed[]>;
  }

  async listDonorsWithLoad(category: string): Promise<MatchDonor[]> {
    // Candidate donors: configured category, with their current active-sponsorship load.
    const donors = await db.donor.findMany({
      where: { category },
      select: {
        id: true,
        name: true,
        email: true,
        category: true,
        _count: { select: { sponsorships: { where: { status: { in: ["ACTIVE", "PAUSED"] } } } } },
      },
    });
    return donors.map((d) => ({
      id: d.id,
      name: d.name,
      email: d.email,
      category: d.category,
      _count: { sponsorships: d._count.sponsorships },
    }));
  }

  async findBeneficiaryById(id: string): Promise<Beneficiary | null> {
    return db.beneficiary.findUnique({ where: { id } });
  }

  async findDonorById(id: string): Promise<Donor | null> {
    return db.donor.findUnique({ where: { id } });
  }

  async findRecurringNeedById(id: string): Promise<RecurringNeed | null> {
    return db.recurringNeed.findUnique({ where: { id } });
  }

  async create(data: SponsorshipCreateData): Promise<SponsorshipRow> {
    // FK-guarded: beneficiary/donor/recurring-need references could race a
    // concurrent delete.
    return mapPrismaError(() =>
      db.beneficiarySponsorship.create({
        data: {
          beneficiaryId: data.beneficiaryId,
          donorId: data.donorId,
          donorName: data.donorName,
          recurringNeedId: data.recurringNeedId,
          amountPerMonth: data.amountPerMonth,
          months: data.months,
          notes: data.notes,
          source: data.source,
          assignedByName: data.assignedByName,
        },
        include: SPONSORSHIP_INCLUDE,
      }) as Promise<SponsorshipRow>
    );
  }

  async findById(id: string): Promise<BeneficiarySponsorship | null> {
    return db.beneficiarySponsorship.findUnique({ where: { id } });
  }

  async update(id: string, data: SponsorshipUpdateData): Promise<SponsorshipUpdatedRow> {
    return mapPrismaError(() =>
      db.beneficiarySponsorship.update({
        where: { id },
        data,
        include: SPONSORSHIP_UPDATE_INCLUDE,
      }) as Promise<SponsorshipUpdatedRow>
    );
  }

  async delete(id: string): Promise<void> {
    await mapPrismaError(() => db.beneficiarySponsorship.delete({ where: { id } }));
  }
}
