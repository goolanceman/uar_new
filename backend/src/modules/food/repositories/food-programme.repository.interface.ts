/**
 * Food programme repository contract — FoodProgramme persistence and the
 * linked-campaign lookup shared with the event desk. The service layer
 * depends on this interface, never on Prisma directly.
 */
import type { Campaign, FoodEvent, FoodProgramme } from "@prisma/client";

export type FoodProgrammeRow = FoodProgramme;
export type CampaignRow = Campaign;

/** Admin list include (campaign summary + event count). */
export type ProgrammeListRow = FoodProgramme & {
  campaign: { id: string; title: string } | null;
  _count: { events: number };
};

/** Detail include (campaign + events with registration counts). */
export type ProgrammeDetailRow = FoodProgramme & {
  campaign: { id: string; title: string } | null;
  events: (FoodEvent & { _count: { registrations: number } })[];
};

export interface ProgrammeCreateData {
  code: string;
  title: string;
  slug: string;
  description: string;
  category: string;
  targetGroup: string | null;
  geographicCoverage: string | null;
  startDate: Date;
  endDate: Date | null;
  budget: number | null;
  fundraisingTarget: number | null;
  frequency: string;
  assistanceCategories: string | null;
  eligibilityCriteria: string | null;
  coordinatorName: string | null;
  coordinatorPhone: string | null;
  campaignId: string | null;
  publicVisible: boolean;
  status: string;
  createdByName: string;
}

/** PATCH field patch — keys exist only when the legacy handler set them. */
export interface ProgrammeUpdateData {
  title?: string;
  description?: string;
  targetGroup?: string | null;
  geographicCoverage?: string | null;
  startDate?: Date;
  endDate?: Date | null;
  budget?: number | null;
  fundraisingTarget?: number | null;
  frequency?: string;
  eligibilityCriteria?: string | null;
  coordinatorName?: string | null;
  coordinatorPhone?: string | null;
  publicVisible?: boolean;
  campaignId?: string | null;
  status?: string;
}

export interface FoodProgrammeRepository {
  /** Public-visible PUBLISHED/ACTIVE programmes, newest start first. */
  listPublicProgrammes(): Promise<FoodProgrammeRow[]>;
  listProgrammes(status?: string | null): Promise<ProgrammeListRow[]>;
  findProgrammeById(id: string): Promise<FoodProgrammeRow | null>;
  findCampaignById(id: string): Promise<CampaignRow | null>;
  /** code/slug are unique — constraint failures render as conflicts. */
  createProgramme(data: ProgrammeCreateData): Promise<FoodProgrammeRow>;
  findProgrammeDetail(id: string): Promise<ProgrammeDetailRow | null>;
  updateProgramme(id: string, data: ProgrammeUpdateData): Promise<FoodProgrammeRow>;
}
