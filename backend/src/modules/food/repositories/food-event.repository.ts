/**
 * Prisma implementation of the food event repository — the ONLY place in the
 * food module that touches FoodEvent/FoodEventExpense/Campaign/KitTemplate
 * models directly. Legacy query shapes are reproduced verbatim.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import { FOOD_PUBLIC_EVENT_STATUSES } from "@/lib/food";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";
import type {
  AdminEventRow,
  EventCreateData,
  EventDetailRow,
  EventListFilters,
  EventUpdateData,
  ExpenseCreateData,
  FoodEventRepository,
  MyRegistrationRow,
  PublicEventRow,
} from "./food-event.repository.interface";

/** Event-detail include — the operations-brain projection. */
const EVENT_DETAIL_INCLUDE = {
  programme: { select: { id: true, code: true, title: true, category: true } },
  campaign: { select: { id: true, title: true } },
  packageTemplate: true,
  registrations: {
    orderBy: { createdAt: "asc" },
    include: {
      beneficiary: { select: { id: true, code: true, name: true, phone: true, city: true, category: true, familyMembers: true } },
      household: { select: { id: true, code: true, name: true, size: true } },
      checkIn: { select: { method: true, checkedInAt: true, operatorName: true } },
    },
  },
  allocations: {
    include: {
      batch: { select: { id: true, batchNo: true, expiryDate: true, qualityStatus: true, source: true } },
      item: { select: { id: true, name: true, unit: true } },
    },
  },
  expenses: { orderBy: { spentAt: "desc" } },
  _count: { select: { registrations: true } },
} satisfies Prisma.FoodEventInclude;

export class PrismaFoodEventRepository implements FoodEventRepository {
  async listPublicEvents(): Promise<PublicEventRow[]> {
    const rows = await db.foodEvent.findMany({
      where: {
        publicVisible: true,
        status: { in: FOOD_PUBLIC_EVENT_STATUSES },
      },
      orderBy: { eventDate: "asc" },
      include: {
        programme: { select: { title: true, slug: true, category: true, eligibilityCriteria: true } },
        _count: { select: { registrations: { where: { status: { notIn: ["CANCELLED", "REJECTED"] } } } } },
      },
    });
    return rows as PublicEventRow[];
  }

  async findEventById(id: string) {
    return db.foodEvent.findUnique({ where: { id } });
  }

  async findEventWithTemplate(id: string) {
    return db.foodEvent.findUnique({
      where: { id },
      include: { packageTemplate: true },
    });
  }

  async listMyRegistrations(beneficiaryId: string): Promise<MyRegistrationRow[]> {
    const rows = await db.foodRegistration.findMany({
      where: { beneficiaryId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        event: {
          select: {
            id: true, code: true, title: true, eventDate: true, startTime: true,
            endTime: true, venue: true, city: true, status: true, eventType: true,
            programme: { select: { title: true } },
          },
        },
      },
    });
    return rows as MyRegistrationRow[];
  }

  async listEvents(filters: EventListFilters): Promise<AdminEventRow[]> {
    const where: Prisma.FoodEventWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.programmeId) where.programmeId = filters.programmeId;
    if (filters.city) where.city = { contains: filters.city };
    if (filters.q) where.OR = [{ title: { contains: filters.q } }, { code: { contains: filters.q } }, { venue: { contains: filters.q } }];

    const rows = await db.foodEvent.findMany({
      where,
      orderBy: { eventDate: "desc" },
      include: {
        programme: { select: { id: true, title: true, category: true } },
        _count: { select: { registrations: true } },
      },
    });
    return rows as AdminEventRow[];
  }

  async createEvent(data: EventCreateData) {
    return mapPrismaError(() => db.foodEvent.create({ data }));
  }

  async findEventDetail(id: string): Promise<EventDetailRow | null> {
    const event = await db.foodEvent.findUnique({
      where: { id },
      include: EVENT_DETAIL_INCLUDE,
    });
    return event as EventDetailRow | null;
  }

  async updateEvent(id: string, data: EventUpdateData, client?: DbClient) {
    const run = (c: DbClient) =>
      mapPrismaError(() =>
        c.foodEvent.update({ where: { id }, data: data as Prisma.FoodEventUncheckedUpdateInput })
      );
    return client ? run(client) : run(db);
  }

  async findCampaignById(id: string) {
    return db.campaign.findUnique({ where: { id } });
  }

  async findKitTemplateById(id: string) {
    return db.kitTemplate.findUnique({ where: { id } });
  }

  async listExpenses(eventId: string) {
    return db.foodEventExpense.findMany({
      where: { eventId },
      orderBy: { spentAt: "desc" },
    });
  }

  async createExpense(data: ExpenseCreateData) {
    return mapPrismaError(() => db.foodEventExpense.create({ data }));
  }
}
