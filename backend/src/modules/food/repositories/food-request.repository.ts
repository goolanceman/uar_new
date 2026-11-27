/**
 * Prisma implementation of the food request repository — the ONLY place in
 * the food module that touches BeneficiaryRequest/Beneficiary/Notification
 * models directly. Legacy query shapes are reproduced verbatim.
 */
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";
import type {
  ApplicationCreateData,
  ApplicationRow,
  ApplicationStatusRow,
  ApplicationUpdateData,
  BeneficiaryCreateData,
  FoodRequestRepository,
  NotificationCreateData,
} from "./food-request.repository.interface";

/** GET /applications include — beneficiary summary. */
const APPLICATION_INCLUDE = { beneficiary: { select: { id: true, code: true, name: true } } };

export class PrismaFoodRequestRepository implements FoodRequestRepository {
  async listApplications(status?: string | null): Promise<ApplicationRow[]> {
    const rows = await db.beneficiaryRequest.findMany({
      where: { category: "FOOD_ASSISTANCE", ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: APPLICATION_INCLUDE,
    });
    return rows as ApplicationRow[];
  }

  async findRequestByRefCode(refCode: string) {
    return db.beneficiaryRequest.findUnique({
      where: { refCode },
      select: { phone: true, status: true, reviewNote: true, createdAt: true, updatedAt: true, name: true },
    });
  }

  async findRequestById(id: string) {
    return db.beneficiaryRequest.findUnique({ where: { id } });
  }

  async findOpenRequestByPhone(phone: string) {
    return db.beneficiaryRequest.findFirst({
      where: {
        category: "FOOD_ASSISTANCE",
        phone: { contains: phone },
        status: { in: ["PENDING", "IN_REVIEW"] },
      },
      select: { refCode: true, createdAt: true },
    });
  }

  async createRequest(data: ApplicationCreateData) {
    return mapPrismaError(() => db.beneficiaryRequest.create({ data }));
  }

  async updateRequest(id: string, data: ApplicationUpdateData): Promise<ApplicationRow> {
    const row = await mapPrismaError(() =>
      db.beneficiaryRequest.update({
        where: { id },
        data,
        include: APPLICATION_INCLUDE,
      })
    );
    return row as ApplicationRow;
  }

  async findBeneficiaryByUserId(userId: string) {
    return db.beneficiary.findUnique({ where: { userId } });
  }

  async findBeneficiaryById(id: string) {
    return db.beneficiary.findUnique({ where: { id } });
  }

  async createBeneficiary(data: BeneficiaryCreateData, client?: DbClient) {
    return mapPrismaError(() => (client ?? db).beneficiary.create({ data }));
  }

  async countBeneficiaries(client: DbClient): Promise<number> {
    return client.beneficiary.count();
  }

  async findBeneficiaryCodeOwner(code: string, client: DbClient) {
    return client.beneficiary.findUnique({ where: { code }, select: { code: true } });
  }

  async findBeneficiaryByPhoneContains(phone: string) {
    return db.beneficiary.findFirst({
      where: { phone: { contains: phone } },
      orderBy: { createdAt: "asc" },
    });
  }

  async updateBeneficiaryName(id: string, name: string, client: DbClient): Promise<void> {
    await client.beneficiary.update({ where: { id }, data: { name } });
  }

  async createNotification(data: NotificationCreateData): Promise<void> {
    await db.notification.create({ data });
  }
}
