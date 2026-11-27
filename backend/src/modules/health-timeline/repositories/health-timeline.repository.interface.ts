/**
 * Health-timeline repository contract — the beneficiary header plus the nine
 * event streams merged into the unified timeline. The service layer depends
 * on this interface, never on Prisma directly.
 */

export interface TimelineEncounterRow {
  id: string;
  createdAt: Date;
  status: string;
  chiefComplaint: string | null;
  diagnosis: string | null;
  followUpDate: Date | null;
  doctor: { name: string };
  camp: { title: string } | null;
}

export interface TimelineVitalRow {
  id: string;
  recordedAt: Date;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulse: number | null;
  tempC: number | null;
  respRate: number | null;
  spo2: number | null;
  bmi: number | null;
  glucose: number | null;
  recordedByName: string | null;
}

export interface TimelineScreeningRow {
  id: string;
  recordedAt: Date;
  type: string;
  result: string;
  abnormal: boolean;
  recordedByName: string | null;
}

export interface TimelinePrescriptionRow {
  id: string;
  code: string;
  createdAt: Date;
  status: string;
  diagnosis: string | null;
  signedByName: string | null;
  items: Array<{ id: string }>;
}

export interface TimelineLabRow {
  id: string;
  code: string;
  createdAt: Date;
  testName: string;
  status: string;
  critical: boolean;
}

export interface TimelineReferralRow {
  id: string;
  code: string;
  createdAt: Date;
  reason: string;
  priority: string;
  status: string;
  receivingOrg: { name: string } | null;
}

export interface TimelineFollowUpRow {
  id: string;
  createdAt: Date;
  dueDate: Date;
  instructions: string | null;
  status: string;
  ownerName: string | null;
}

export interface TimelineDocumentRow {
  id: string;
  createdAt: Date;
  name: string;
  kind: string;
  url: string;
  uploadedByName: string | null;
}

export interface TimelineAttendanceRow {
  id: string;
  checkInAt: Date | null;
  status: string;
  queueToken: number | null;
  camp: { title: string; code: string };
}

/** The nine event streams, loaded in one Promise.all (legacy parity). */
export interface HealthTimelineBundle {
  encounters: TimelineEncounterRow[];
  vitals: TimelineVitalRow[];
  screenings: TimelineScreeningRow[];
  prescriptions: TimelinePrescriptionRow[];
  labOrders: TimelineLabRow[];
  referrals: TimelineReferralRow[];
  followUps: TimelineFollowUpRow[];
  documents: TimelineDocumentRow[];
  attendances: TimelineAttendanceRow[];
}

export interface HealthTimelineRepository {
  /** BENEFICIARY self-lookup — only the id is read (legacy select). */
  findBeneficiaryIdByUserId(userId: string): Promise<{ id: string } | null>;
  findBeneficiaryHeader(id: string): Promise<{ id: string; code: string; name: string } | null>;
  loadTimeline(beneficiaryId: string, limit: number): Promise<HealthTimelineBundle>;
}
