/**
 * Health AI repository contract — persistence operations for AIInteraction
 * records and the clinical aggregates the four AI actions read. The service
 * layer depends on this interface, never on Prisma directly.
 */
import type { AIInteraction, MedicalDocument, Prisma } from "@prisma/client";

/** Beneficiary fields embedded in the consult-draft prompt. */
export type ConsultBeneficiary = Prisma.BeneficiaryGetPayload<{
  select: { code: true; name: true; age: true; gender: true };
}>;

/** Beneficiary fields needed by the timeline summary. */
export type TimelineBeneficiary = Prisma.BeneficiaryGetPayload<{ select: { id: true; code: true } }>;

/** The seven activity counters feeding the timeline summary prompt. */
export interface TimelineCounts {
  encounters: number;
  vitals: number;
  screenings: number;
  rx: number;
  labsPending: number;
  referralsOpen: number;
  followUpsPending: number;
}

/** The five camp aggregates feeding the camp-plan prompt (legacy order). */
export interface CampStats {
  totalCamps: number;
  byStatus: Array<{ status: string; _count: number }>;
  attendanceTotal: number;
  noShows: number;
  topCities: Array<{ city: string | null; _count: number }>;
}

/** Optional audit-list filter (GET /api/health-ai). */
export interface InteractionFilter {
  action?: string;
  status?: string;
}

/** AIInteraction create payload — minimised digests only, never PHI. */
export interface InteractionCreateData {
  action: string;
  entityType: string;
  entityId: string | null;
  promptDigest: string;
  outputDigest: string;
  confidence?: number | null;
  status: string;
  userId: string;
}

export interface HealthAiRepository {
  listInteractions(
    filter: InteractionFilter,
    skip: number,
    limit: number
  ): Promise<{ total: number; items: AIInteraction[] }>;

  findBeneficiaryForConsult(id: string): Promise<ConsultBeneficiary | null>;
  findEncounterId(id: string): Promise<{ id: string } | null>;
  setEncounterAiDraftUsed(id: string): Promise<void>;

  findBeneficiaryForTimeline(id: string): Promise<TimelineBeneficiary | null>;
  timelineCounts(beneficiaryId: string): Promise<TimelineCounts>;

  campStats(city: string | null): Promise<CampStats>;

  findMedicalDocument(id: string): Promise<MedicalDocument | null>;

  createInteraction(data: InteractionCreateData): Promise<AIInteraction>;
  findInteractionById(id: string): Promise<AIInteraction | null>;
  updateInteraction(
    id: string,
    data: { status: string; reviewedByName: string }
  ): Promise<AIInteraction>;
}
