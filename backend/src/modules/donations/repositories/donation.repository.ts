/**
 * Prisma implementation of the donation repository — the ONLY place in the
 * donations module that touches Prisma models directly.
 *
 * Legacy transaction usage is preserved exactly: POST / runs the donor upsert
 * + donation create inside ONE interactive transaction (the service opens it
 * via withTransaction and passes the tx client down), while every other flow
 * runs on the default client like the legacy routes did. Create/update
 * operations with unique/FK violation risk are wrapped in mapPrismaError.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";
import type {
  CreateDonationData,
  CreateDonorData,
  DonationAdminRow,
  DonationDetailRow,
  DonationListFilters,
  DonationRepository,
  DonationRow,
  DonationWallRow,
  DonationWithCampaignAccent,
  DonationWithCampaignTitle,
  DonorSyncInput,
  RecurringParentRow,
  UpdateDonorData,
} from "./donation.repository.interface";

type Tx = Prisma.TransactionClient;

export class PrismaDonationRepository implements DonationRepository {
  // ── lookups ──────────────────────────────────────────────────────────────

  async findDonationById(id: string, client?: DbClient): Promise<DonationRow | null> {
    const c = (client ?? db) as Tx;
    return c.donation.findUnique({ where: { id } });
  }

  async findDonationDetail(id: string): Promise<DonationDetailRow | null> {
    return db.donation.findUnique({
      where: { id },
      include: {
        campaign: { select: { id: true, title: true, accent: true, slug: true } },
        donorRef: true,
      },
    });
  }

  async findDonorByEmail(email: string, client?: DbClient) {
    const c = (client ?? db) as Tx;
    return c.donor.findUnique({ where: { email } });
  }

  async findCampaignById(id: string) {
    return db.campaign.findUnique({ where: { id } });
  }

  async findCampaignTitle(campaignId: string): Promise<{ title: string } | null> {
    return db.campaign.findUnique({
      where: { id: campaignId },
      select: { title: true },
    });
  }

  async findFoodEventById(id: string) {
    return db.foodEvent.findUnique({ where: { id } });
  }

  async findPledgeById(id: string) {
    return db.pledge.findUnique({ where: { id } });
  }

  // ── POST / create flow ───────────────────────────────────────────────────

  async nextReceiptNumber(): Promise<string> {
    const year = new Date().getFullYear();
    let n = (await db.donation.count()) + 1;
    let receiptNumber = `UAR-RCPT-${year}-${String(n).padStart(5, "0")}`;
    // loop while exists (guards against concurrent creates)
    while (await db.donation.findUnique({ where: { receiptNumber } })) {
      n += 1;
      receiptNumber = `UAR-RCPT-${year}-${String(n).padStart(5, "0")}`;
    }
    return receiptNumber;
  }

  async createDonor(data: CreateDonorData, client?: DbClient) {
    const c = (client ?? db) as Tx;
    return mapPrismaError(() => c.donor.create({ data: data as Prisma.DonorUncheckedCreateInput }));
  }

  async updateDonorById(id: string, data: UpdateDonorData, client?: DbClient) {
    const c = (client ?? db) as Tx;
    return c.donor.update({ where: { id }, data });
  }

  async createDonation(
    data: CreateDonationData,
    client?: DbClient
  ): Promise<DonationWithCampaignTitle> {
    const c = (client ?? db) as Tx;
    return mapPrismaError(() =>
      c.donation.create({
        data: data as Prisma.DonationUncheckedCreateInput,
        include: { campaign: { select: { title: true } } },
      })
    );
  }

  async incrementCampaignRaised(campaignId: string, amount: number): Promise<void> {
    await mapPrismaError(() =>
      db.campaign.update({
        where: { id: campaignId },
        data: { raisedAmount: { increment: amount } },
      })
    );
  }

  async updateUserPan(userId: string, pan: string): Promise<void> {
    await db.user.update({ where: { id: userId }, data: { pan } });
  }

  // ── GET / multi-mode list ────────────────────────────────────────────────

  async listMine(donorId: string, limit?: number): Promise<DonationWithCampaignAccent[]> {
    return db.donation.findMany({
      where: { donorId },
      orderBy: { createdAt: "desc" },
      ...(limit && limit > 0 ? { take: limit } : {}),
      include: { campaign: { select: { title: true, accent: true } } },
    });
  }

  async listDonorWall(
    campaignId: string,
    sortBy: string,
    sortDirection: "asc" | "desc",
    skip: number,
    limit: number
  ): Promise<{ rows: DonationWallRow[]; total: number; totalRaised: number }> {
    const where = { campaignId, paymentStatus: "COMPLETED" as const };
    const [rows, total, agg] = await Promise.all([
      db.donation.findMany({
        where,
        orderBy: { [sortBy]: sortDirection },
        skip,
        take: limit,
        include: {
          campaign: { select: { id: true, title: true, slug: true } },
          donor: { select: { id: true, name: true, username: true, avatar: true } },
        },
      }),
      db.donation.count({ where }),
      db.donation.aggregate({ _sum: { amount: true }, where }),
    ]);
    return { rows: rows as DonationWallRow[], total, totalRaised: agg._sum.amount ?? 0 };
  }

  async listPublicWall(): Promise<DonationWithCampaignAccent[]> {
    return db.donation.findMany({
      where: { paymentStatus: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { campaign: { select: { title: true, accent: true } } },
    });
  }

  async listAdmin(
    filters: DonationListFilters,
    skip: number,
    take: number
  ): Promise<{ rows: DonationAdminRow[]; total: number; completedSum: number }> {
    const where: Record<string, unknown> = {};
    if (filters.campaignId) where.campaignId = filters.campaignId;
    if (filters.status) where.paymentStatus = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.category) where.category = filters.category;
    if (filters.method) where.paymentMethod = filters.method;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999Z`) } : {}),
      };
    }
    if (filters.q) {
      where.OR = [
        { donorName: { contains: filters.q } },
        { donorEmail: { contains: filters.q } },
        { receiptNumber: { contains: filters.q } },
        { transactionId: { contains: filters.q } },
      ];
    }

    const [rows, total, sumAgg] = await Promise.all([
      db.donation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          campaign: { select: { title: true, accent: true } },
          donorRef: { select: { id: true, category: true, tags: true } },
        },
      }),
      db.donation.count({ where }),
      db.donation.aggregate({
        where: { ...where, paymentStatus: "COMPLETED" },
        _sum: { amount: true },
      }),
    ]);
    return { rows: rows as DonationAdminRow[], total, completedSum: sumAgg._sum.amount ?? 0 };
  }

  // ── recurring commitments ────────────────────────────────────────────────

  async listRecurringParents(donorId: string): Promise<RecurringParentRow[]> {
    return db.donation.findMany({
      where: { donorId, type: "RECURRING", recurringParentId: null },
      orderBy: { createdAt: "desc" },
      include: { campaign: { select: { id: true, title: true, accent: true } } },
    });
  }

  async listInstallments(parentIds: string[]): Promise<DonationRow[]> {
    return db.donation.findMany({
      where: { recurringParentId: { in: parentIds } },
      orderBy: { createdAt: "desc" },
    });
  }

  // ── admin edit / delete ──────────────────────────────────────────────────

  async updateDonation(id: string, data: Record<string, unknown>): Promise<DonationRow> {
    return mapPrismaError(() => db.donation.update({ where: { id }, data }));
  }

  async deleteDonation(id: string): Promise<void> {
    await mapPrismaError(() => db.donation.delete({ where: { id } }));
  }

  async upsertDonorRecord(input: DonorSyncInput): Promise<void> {
    await mapPrismaError(() =>
      db.donor.upsert({
        where: { email: input.email },
        create: {
          code: input.code,
          name: input.name,
          email: input.email,
          phone: input.phone,
          pan: input.pan,
          source: "OFFLINE",
        },
        update: {
          name: input.name,
          phone: input.phone ?? undefined,
          pan: input.pan ?? undefined,
        },
      })
    );
  }

  async recomputeCampaignRaised(campaignId: string): Promise<void> {
    const agg = await db.donation.aggregate({
      _sum: { amount: true },
      where: { campaignId, paymentStatus: "COMPLETED" },
    });
    await mapPrismaError(() =>
      db.campaign.update({
        where: { id: campaignId },
        data: { raisedAmount: agg._sum.amount ?? 0 },
      })
    );
  }
}
