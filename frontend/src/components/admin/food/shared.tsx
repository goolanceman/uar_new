"use client";

/**
 * Food Security module — shared types, label maps and tiny helpers used by
 * every admin food tab. Statuses mirror src/lib/food.ts (backend truth).
 */

export interface TabProps {
  revision: number;
  isAdmin: boolean;
  onNavigate?: (tab: string) => void;
}

export function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data))
    return (data as { data?: T[] }).data as T[];
  return [];
}

export const FOOD_PROGRAMME_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "GROCERY_KIT", label: "Family Grocery Kits" },
  { value: "COOKED_MEAL", label: "Free Cooked Meals" },
  { value: "MONTHLY_RATION", label: "Monthly Food Assistance" },
  { value: "CHILD_NUTRITION", label: "Children's Nutrition" },
  { value: "SENIOR_SUPPORT", label: "Senior Citizen Food Support" },
  { value: "EMERGENCY", label: "Emergency Food Relief" },
  { value: "COMMUNITY_KITCHEN", label: "Community Kitchen" },
  { value: "FESTIVAL", label: "Festival Food Distribution" },
  { value: "RURAL", label: "Rural Food Assistance" },
  { value: "SURPLUS_RECOVERY", label: "Surplus Food Recovery" },
];

export const FOOD_EVENT_TYPES: Array<{ value: string; label: string }> = [
  { value: "COMMUNITY", label: "Community distribution" },
  { value: "HOME_DELIVERY", label: "Home delivery" },
  { value: "DOOR_TO_DOOR", label: "Door-to-door" },
  { value: "KITCHEN", label: "Community kitchen" },
  { value: "MEAL_SERVING", label: "Cooked meal serving" },
  { value: "MONTHLY_KIT", label: "Monthly grocery kits" },
  { value: "EMERGENCY", label: "Emergency distribution" },
  { value: "INSTITUTION", label: "Institution-based" },
  { value: "SCHOOL", label: "School-based" },
  { value: "RURAL", label: "Rural distribution" },
  { value: "MOBILE", label: "Mobile distribution" },
];

export const FOOD_SOURCES: Array<{ value: string; label: string }> = [
  { value: "DONATED", label: "Food donation" },
  { value: "PURCHASED", label: "Purchased" },
  { value: "CSR", label: "CSR-sponsored" },
  { value: "PARTNER", label: "Partner-contributed" },
  { value: "RECOVERED", label: "Recovered surplus" },
];

export const ACK_METHODS: Array<{ value: string; label: string }> = [
  { value: "DIGITAL", label: "Digital acknowledgement" },
  { value: "OTP", label: "OTP verification" },
  { value: "SIGNATURE", label: "Signature" },
  { value: "ASSISTED", label: "Assisted (staff operated)" },
  { value: "WITNESS", label: "Staff witness" },
];

export { FOOD_EVENT_STATUSES } from "@/lib/food-workflows";

export const NO_SHOW_REASONS: Array<{ value: string; label: string }> = [
  { value: "NO_SHOW", label: "Did not arrive" },
  { value: "PARTIAL_COLLECTION", label: "Partial collection" },
  { value: "WRONG_PACKAGE", label: "Wrong package" },
  { value: "INSUFFICIENT_STOCK", label: "Insufficient stock" },
  { value: "BENEFICIARY_UNREACHABLE", label: "Beneficiary unreachable" },
  { value: "DELIVERY_FAILED", label: "Delivery failed" },
  { value: "BENEFICIARY_DECLINED", label: "Beneficiary declined" },
  { value: "CANCELLED", label: "Distribution cancelled" },
  { value: "OTHER", label: "Other (see notes)" },
];

export const labelOf = (list: Array<{ value: string; label: string }>, value: string | null | undefined) =>
  list.find((o) => o.value === value)?.label ?? value ?? "—";

/* Programme / event / registration interfaces shared by tabs */

export interface FoodProgramme {
  id: string;
  code: string;
  title: string;
  slug: string;
  description: string;
  category: string;
  targetGroup?: string | null;
  geographicCoverage?: string | null;
  startDate: string;
  endDate?: string | null;
  budget?: number | null;
  fundraisingTarget?: number | null;
  frequency: string;
  assistanceCategories?: string | null;
  eligibilityCriteria?: string | null;
  coordinatorName?: string | null;
  coordinatorPhone?: string | null;
  campaignId?: string | null;
  publicVisible: boolean;
  status: string;
  createdAt?: string;
  _count?: { events: number };
}

export interface FoodEvent {
  id: string;
  code: string;
  programmeId: string;
  campaignId?: string | null;
  title: string;
  description?: string | null;
  eventDate: string;
  startTime?: string | null;
  endTime?: string | null;
  venue: string;
  city?: string | null;
  address?: string | null;
  eventType: string;
  packageTemplateId?: string | null;
  plannedUnits: number;
  maxCapacity?: number | null;
  coordinatorName?: string | null;
  registrationDeadline?: string | null;
  registrationOpen: boolean;
  publicVisible: boolean;
  specialInstructions?: string | null;
  status: string;
  statusReason?: string | null;
  budget?: number | null;
  createdByName?: string | null;
  programme?: { id: string; code: string; title: string; category: string } | null;
  _count?: { registrations: number };
}

export interface FoodRegistration {
  id: string;
  code: string;
  eventId: string;
  beneficiaryId: string;
  householdId?: string | null;
  unitsAllocated: number;
  packageSnapshot?: string | null;
  status: string;
  unitsDelivered: number;
  registeredVia: string;
  ackMethod?: string | null;
  ackByName?: string | null;
  ackRef?: string | null;
  reason?: string | null;
  notes?: string | null;
  createdAt: string;
  beneficiary?: { id: string; code: string; name: string; phone?: string | null; city?: string | null; familyMembers?: number };
  household?: { id: string; code: string; name: string; size: number } | null;
  event?: { id: string; code: string; title: string; eventDate: string; status: string };
  checkIn?: { method: string; checkedInAt: string; operatorName?: string | null } | null;
}

export interface FoodBatch {
  id: string;
  itemId: string;
  batchNo: string;
  source: string;
  donorName?: string | null;
  supplierName?: string | null;
  quantityReceived: number;
  quantityReserved: number;
  quantityConsumed: number;
  quantityWasted: number;
  quantityReturned: number;
  mfgDate?: string | null;
  expiryDate?: string | null;
  storageNotes?: string | null;
  tempRequirement?: string | null;
  qualityStatus: string;
  inspectedByName?: string | null;
  rejectionReason?: string | null;
  status: string;
  createdAt?: string;
  item?: { id: string; name: string; unit: string; category: string };
}

export interface FoodApplication {
  id: string;
  refCode?: string | null;
  name: string;
  phone?: string | null;
  category: string;
  urgency: string;
  details: string;
  status: string;
  reviewNote?: string | null;
  reviewedBy?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  familyMembers?: number | null;
  childrenCount?: number | null;
  seniorCount?: number | null;
  dietary?: string | null;
  preferredContact?: string | null;
  source?: string | null;
  consent?: boolean;
  createdAt: string;
  beneficiary?: { id: string; code: string; name: string } | null;
}

export interface Household {
  id: string;
  code: string;
  name: string;
  headBeneficiaryId?: string | null;
  primaryPhone?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  size: number;
  childrenCount: number;
  seniorCount: number;
  incomeRange?: string | null;
  notes?: string | null;
  headBeneficiary?: { id: string; code: string; name: string } | null;
  members?: Array<{ id: string; name: string; age?: number | null; relation?: string | null; beneficiaryId?: string | null }>;
  _count?: { registrations: number };
}
