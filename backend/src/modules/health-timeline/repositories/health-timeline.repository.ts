/**
 * Prisma implementation of the health-timeline repository — the ONLY place
 * in the health-timeline module that touches Prisma models directly.
 * (Read-only lookups/lists: no unique/FK violation risk, so no mapPrismaError
 * wrap.)
 */
import { db } from "@/infrastructure/database/prisma";
import type {
  HealthTimelineBundle,
  HealthTimelineRepository,
  TimelineAttendanceRow,
  TimelineDocumentRow,
  TimelineEncounterRow,
  TimelineFollowUpRow,
  TimelineLabRow,
  TimelinePrescriptionRow,
  TimelineReferralRow,
  TimelineScreeningRow,
  TimelineVitalRow,
} from "./health-timeline.repository.interface";

export class PrismaHealthTimelineRepository implements HealthTimelineRepository {
  async findBeneficiaryIdByUserId(userId: string): Promise<{ id: string } | null> {
    return db.beneficiary.findUnique({
      where: { userId },
      select: { id: true },
    });
  }

  async findBeneficiaryHeader(id: string): Promise<{ id: string; code: string; name: string } | null> {
    return db.beneficiary.findUnique({
      where: { id },
      select: { id: true, code: true, name: true },
    });
  }

  /** The legacy 9-query Promise.all — one parallel read burst, each stream
   *  individually capped at `limit` before the service merges + re-caps. */
  async loadTimeline(beneficiaryId: string, limit: number): Promise<HealthTimelineBundle> {
    const [
      encounters,
      vitals,
      screenings,
      prescriptions,
      labOrders,
      referrals,
      followUps,
      documents,
      attendances,
    ] = await Promise.all([
      db.encounter.findMany({
        where: { beneficiaryId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true, createdAt: true, status: true, chiefComplaint: true, diagnosis: true, followUpDate: true,
          doctor: { select: { name: true } },
          camp: { select: { title: true } },
        },
      }),
      db.vitalObservation.findMany({
        where: { beneficiaryId },
        orderBy: { recordedAt: "desc" },
        take: limit,
        select: {
          id: true, recordedAt: true, bpSystolic: true, bpDiastolic: true, pulse: true,
          tempC: true, respRate: true, spo2: true, bmi: true, glucose: true, recordedByName: true,
        },
      }),
      db.screeningRecord.findMany({
        where: { beneficiaryId },
        orderBy: { recordedAt: "desc" },
        take: limit,
        select: { id: true, recordedAt: true, type: true, result: true, abnormal: true, recordedByName: true },
      }),
      db.prescription.findMany({
        where: { beneficiaryId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true, code: true, createdAt: true, status: true, diagnosis: true, signedByName: true,
          items: { select: { id: true } },
        },
      }),
      db.diagnosticOrder.findMany({
        where: { beneficiaryId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, code: true, createdAt: true, testName: true, status: true, critical: true },
      }),
      db.medicalReferral.findMany({
        where: { beneficiaryId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true, code: true, createdAt: true, reason: true, priority: true, status: true,
          receivingOrg: { select: { name: true } },
        },
      }),
      db.followUp.findMany({
        where: { beneficiaryId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, createdAt: true, dueDate: true, instructions: true, status: true, ownerName: true },
      }),
      db.medicalDocument.findMany({
        where: { beneficiaryId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, createdAt: true, name: true, kind: true, url: true, uploadedByName: true },
      }),
      db.campAttendance.findMany({
        where: { beneficiaryId, checkInAt: { not: null } },
        orderBy: { checkInAt: "desc" },
        take: limit,
        select: { id: true, checkInAt: true, status: true, queueToken: true, camp: { select: { title: true, code: true } } },
      }),
    ]);

    return {
      encounters: encounters as TimelineEncounterRow[],
      vitals: vitals as TimelineVitalRow[],
      screenings: screenings as TimelineScreeningRow[],
      prescriptions: prescriptions as TimelinePrescriptionRow[],
      labOrders: labOrders as TimelineLabRow[],
      referrals: referrals as TimelineReferralRow[],
      followUps: followUps as TimelineFollowUpRow[],
      documents: documents as TimelineDocumentRow[],
      attendances: attendances as TimelineAttendanceRow[],
    };
  }
}
