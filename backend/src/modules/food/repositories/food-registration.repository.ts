/**
 * Prisma implementation of the food registration repository — the ONLY place
 * in the food module that touches FoodRegistration/FoodCheckIn/Volunteer/
 * VolunteerTask models directly. Legacy query shapes are reproduced verbatim.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/database/prisma";
import { mapPrismaError } from "@/shared/errors";
import type { DbClient } from "@/infrastructure/database/transactions/transaction.manager";
import type {
  CheckInCreateData,
  EventRegistrationRow,
  FoodRegistrationRepository,
  RegistrationCandidate,
  RegistrationClaimData,
  RegistrationCreateData,
  RegistrationFreshRow,
  RegistrationHandoverRow,
  RegistrationQueueFilters,
  RegistrationQueueRow,
  RegistrationReplayRow,
  RegistrationUpdateData,
  RegistrationWithBeneficiary,
  RegistrationWithEvent,
  RegistrationWithEventSummary,
  VolunteerTaskCreateData,
  VolunteerTaskWithVolunteer,
} from "./food-registration.repository.interface";

/** Legacy taskInclude — assignee code + user name/phone/email. */
const TASK_INCLUDE = {
  volunteer: {
    select: {
      id: true,
      code: true,
      user: { select: { name: true, phone: true, email: true } },
    },
  },
} as const;

export class PrismaFoodRegistrationRepository implements FoodRegistrationRepository {
  // ── resolution (check-in desk) ────────────────────────────────────────────

  async findRegistrationByEventCode(code: string): Promise<RegistrationWithEvent | null> {
    return db.foodRegistration.findUnique({
      where: { code },
      include: { event: true },
    });
  }

  async listRegistrationCandidates(code: string, eventId: string | null): Promise<RegistrationCandidate[]> {
    // Legacy where building, verbatim: beneficiary-code / 10-digit phone /
    // name-contains match keys, optional event scoping (the spread wins).
    const where: Record<string, unknown> = {};
    if (/^UAR-BEN/i.test(code)) where.code = code.toUpperCase();
    else if (/^\d{10}$/.test(code.replace(/\D/g, ""))) where.beneficiary = { phone: { contains: code.replace(/\D/g, "") } };
    else where.beneficiary = { name: { contains: code } };
    if (eventId) where.eventId = eventId;

    const rows = await db.foodRegistration.findMany({
      where: { ...where, eventId: eventId ?? undefined },
      take: 6,
      orderBy: { createdAt: "desc" },
      include: {
        event: true,
        beneficiary: { select: { code: true, name: true, phone: true } },
      },
    });
    return rows as RegistrationCandidate[];
  }

  async findCheckInByOfflineRef(offlineRef: string) {
    return db.foodCheckIn.findUnique({ where: { offlineRef } });
  }

  async findRegistrationReplay(id: string): Promise<RegistrationReplayRow | null> {
    const row = await db.foodRegistration.findUnique({
      where: { id },
      include: { beneficiary: { select: { code: true, name: true } } },
    });
    return row as RegistrationReplayRow | null;
  }

  // ── check-in / handover writes ────────────────────────────────────────────

  async claimRegistration(id: string, fromStatus: string, data: RegistrationClaimData, client: DbClient): Promise<number> {
    const result = await client.foodRegistration.updateMany({
      where: { id, status: fromStatus },
      data: data as Prisma.FoodRegistrationUpdateManyMutationInput,
    });
    return result.count;
  }

  async createCheckIn(data: CheckInCreateData, client: DbClient): Promise<void> {
    await client.foodCheckIn.create({ data });
  }

  async findRegistrationFresh(id: string): Promise<RegistrationFreshRow | null> {
    const row = await db.foodRegistration.findUnique({
      where: { id },
      include: {
        beneficiary: { select: { code: true, name: true, familyMembers: true, city: true } },
        event: { select: { code: true, title: true, venue: true, packageTemplate: { select: { name: true } } } },
      },
    });
    return row as RegistrationFreshRow | null;
  }

  async findRegistrationForHandover(id: string, client: DbClient): Promise<RegistrationHandoverRow> {
    const row = await client.foodRegistration.findUniqueOrThrow({
      where: { id },
      include: {
        beneficiary: { select: { code: true, name: true } },
        event: { select: { code: true, title: true } },
      },
    });
    return row as RegistrationHandoverRow;
  }

  // ── role scoping ──────────────────────────────────────────────────────────

  async findVolunteerByUserId(userId: string) {
    return db.volunteer.findUnique({ where: { userId } });
  }

  async findActiveEventTask(volunteerId: string, eventId: string) {
    return db.volunteerTask.findFirst({
      where: { volunteerId, refType: "FOOD_EVENT", refId: eventId, status: { not: "CANCELLED" } },
    });
  }

  async findEventTask(volunteerId: string, eventId: string) {
    return db.volunteerTask.findFirst({
      where: { volunteerId, refType: "FOOD_EVENT", refId: eventId },
    });
  }

  // ── event registrations ───────────────────────────────────────────────────

  async listEventRegistrations(eventId: string, status?: string | null): Promise<EventRegistrationRow[]> {
    const rows = await db.foodRegistration.findMany({
      where: { eventId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "asc" },
      include: {
        beneficiary: { select: { id: true, code: true, name: true, phone: true, city: true, familyMembers: true } },
        household: { select: { id: true, code: true, name: true, size: true } },
        checkIn: { select: { method: true, checkedInAt: true, operatorName: true } },
      },
    });
    return rows as EventRegistrationRow[];
  }

  async countActiveRegistrations(eventId: string, activeStatuses: readonly string[]): Promise<number> {
    return db.foodRegistration.count({
      where: { eventId, status: { in: [...activeStatuses] } },
    });
  }

  async aggregateDeliveredUnits(eventId: string, client: DbClient) {
    return client.foodRegistration.aggregate({
      where: { eventId, status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] } },
      _sum: { unitsDelivered: true },
    });
  }

  async countRegistrations(client: DbClient): Promise<number> {
    return client.foodRegistration.count();
  }

  async findRegistrationCodeOwner(code: string, client: DbClient) {
    return client.foodRegistration.findUnique({ where: { code }, select: { code: true } });
  }

  async findBeneficiaryById(id: string, client: DbClient) {
    return client.beneficiary.findUnique({ where: { id } });
  }

  async createRegistration(data: RegistrationCreateData, client: DbClient) {
    return mapPrismaError(() => client.foodRegistration.create({ data }));
  }

  async reinstateRegistration(id: string, units: number, client: DbClient): Promise<void> {
    await client.foodRegistration.update({
      where: { id },
      data: { status: "REGISTERED", reason: null, unitsAllocated: units },
    });
  }

  // ── walk-in ───────────────────────────────────────────────────────────────

  async findRegistrationByBeneficiaryPhone(eventId: string, phoneSuffix: string): Promise<RegistrationWithBeneficiary | null> {
    const row = await db.foodRegistration.findFirst({
      where: { eventId, beneficiary: { phone: { contains: phoneSuffix } } },
      include: { beneficiary: { select: { code: true, name: true } } },
    });
    return row as RegistrationWithBeneficiary | null;
  }

  // ── admin queue ───────────────────────────────────────────────────────────

  async listRegistrations(filters: RegistrationQueueFilters): Promise<RegistrationQueueRow[]> {
    const where: Record<string, unknown> = {};
    if (filters.eventId) where.eventId = filters.eventId;
    if (filters.status) where.status = filters.status;
    if (filters.q) {
      where.OR = [
        { code: { contains: filters.q } },
        { beneficiary: { is: { name: { contains: filters.q } } } },
        { beneficiary: { is: { code: { contains: filters.q } } } },
        { beneficiary: { is: { phone: { contains: filters.q } } } },
      ];
    }

    const rows = await db.foodRegistration.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        beneficiary: { select: { id: true, code: true, name: true, phone: true, city: true } },
        event: { select: { id: true, code: true, title: true, eventDate: true, status: true } },
        checkIn: { select: { method: true, checkedInAt: true, operatorName: true } },
      },
    });
    return rows as RegistrationQueueRow[];
  }

  async findRegistrationWithEventSummary(id: string): Promise<RegistrationWithEventSummary | null> {
    const row = await db.foodRegistration.findUnique({
      where: { id },
      include: { event: { select: { code: true, title: true } } },
    });
    return row as RegistrationWithEventSummary | null;
  }

  async updateRegistration(id: string, data: RegistrationUpdateData) {
    return mapPrismaError(() =>
      db.foodRegistration.update({
        where: { id },
        data: data as Prisma.FoodRegistrationUncheckedUpdateInput,
      })
    );
  }

  async findRegistrationById(id: string, client?: DbClient) {
    return (client ?? db).foodRegistration.findUnique({ where: { id } });
  }

  async findRegistrationByIdOrThrow(id: string, client?: DbClient) {
    return (client ?? db).foodRegistration.findUniqueOrThrow({ where: { id } });
  }

  async findRegistrationForEventBeneficiary(eventId: string, beneficiaryId: string, client: DbClient) {
    return client.foodRegistration.findUnique({
      where: { eventId_beneficiaryId: { eventId, beneficiaryId } },
    });
  }

  // ── event volunteer staffing ──────────────────────────────────────────────

  async listAssignedVolunteerIds(eventId: string) {
    return db.volunteerTask.findMany({
      where: { refType: "FOOD_EVENT", refId: eventId, status: { not: "CANCELLED" } },
      select: { volunteerId: true },
    });
  }

  async listAvailableVolunteers(excludeVolunteerIds: string[]) {
    return db.volunteer.findMany({
      where: { status: "ACTIVE", id: { notIn: excludeVolunteerIds } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, user: { select: { name: true, phone: true } } },
    });
  }

  async listEventVolunteerTasks(eventId: string): Promise<VolunteerTaskWithVolunteer[]> {
    const rows = await db.volunteerTask.findMany({
      where: { refType: "FOOD_EVENT", refId: eventId },
      orderBy: { scheduledDate: "desc" },
      include: TASK_INCLUDE,
    });
    return rows as VolunteerTaskWithVolunteer[];
  }

  async findVolunteerWithUser(id: string) {
    return db.volunteer.findUnique({
      where: { id },
      include: { user: { select: { name: true } } },
    });
  }

  async findActiveAssignment(volunteerId: string, eventId: string) {
    return db.volunteerTask.findFirst({
      where: { volunteerId, refType: "FOOD_EVENT", refId: eventId, status: { not: "CANCELLED" } },
    });
  }

  async createVolunteerTask(data: VolunteerTaskCreateData): Promise<VolunteerTaskWithVolunteer> {
    const task = await db.volunteerTask.create({ data, include: TASK_INCLUDE });
    return task as VolunteerTaskWithVolunteer;
  }

  async findTaskWithVolunteer(taskId: string): Promise<VolunteerTaskWithVolunteer | null> {
    const task = await db.volunteerTask.findUnique({
      where: { id: taskId },
      include: TASK_INCLUDE,
    });
    return task as VolunteerTaskWithVolunteer | null;
  }

  async cancelTask(taskId: string): Promise<void> {
    await db.volunteerTask.update({ where: { id: taskId }, data: { status: "CANCELLED" } });
  }
}
