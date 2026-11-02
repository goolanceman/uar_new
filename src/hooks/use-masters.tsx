"use client";

import { useEffect, useState } from "react";
import { get } from "@/lib/api-client";

export interface MasterOption {
  value: string;
  label: string;
}

/**
 * MDM hook — resolves dropdown options from the Master registry
 * with graceful fallbacks so the UI never breaks if a category is empty.
 */
const FALLBACKS: Record<string, MasterOption[]> = {
  CONDITION: [
    { value: "BP", label: "Blood Pressure" },
    { value: "DIABETES", label: "Diabetes" },
    { value: "THYROID", label: "Thyroid" },
    { value: "CARDIAC", label: "Cardiac" },
    { value: "ASTHMA", label: "Asthma" },
    { value: "ARTHRITIS", label: "Arthritis" },
    { value: "OTHER", label: "Other" },
  ],
  ANIMAL_SPECIES: [
    { value: "DOG", label: "Dog" },
    { value: "CAT", label: "Cat" },
    { value: "COW", label: "Cow" },
    { value: "BIRD", label: "Bird" },
    { value: "OTHER", label: "Other" },
  ],
  CITY: [
    { value: "Bengaluru", label: "Bengaluru" },
    { value: "Mysuru", label: "Mysuru" },
    { value: "Hubballi", label: "Hubballi" },
    { value: "Mangaluru", label: "Mangaluru" },
    { value: "Davanagere", label: "Davanagere" },
  ],
  AVAILABILITY: [
    { value: "WEEKENDS", label: "Weekends" },
    { value: "EVENINGS", label: "Weekday evenings" },
    { value: "FULL_TIME", label: "Full time" },
    { value: "FLEXIBLE", label: "Flexible" },
  ],
  SKILL: [
    { value: "FIELD_OPS", label: "Field operations" },
    { value: "MEDICAL", label: "Medical / first aid" },
    { value: "TEACHING", label: "Teaching & awareness" },
    { value: "DRIVING", label: "Driving" },
    { value: "COUNSELLING", label: "Counselling" },
    { value: "ANIMAL_CARE", label: "Animal care" },
    { value: "TECH", label: "Tech & data" },
  ],
  AMBULANCE_TYPE: [
    { value: "BLS", label: "BLS — Basic Life Support" },
    { value: "ALS", label: "ALS — Advanced Life Support" },
    { value: "PTV", label: "PTV — Patient Transport" },
    { value: "NEONATAL", label: "Neonatal" },
  ],
  EMERGENCY_TYPE: [
    { value: "CARDIAC", label: "Cardiac emergency" },
    { value: "ACCIDENT", label: "Road accident / trauma" },
    { value: "MATERNITY", label: "Maternity" },
    { value: "BURN", label: "Burns" },
    { value: "RESPIRATORY", label: "Respiratory" },
    { value: "TRANSFER", label: "Hospital transfer" },
  ],
  INVENTORY_CATEGORY: [
    { value: "RATION", label: "Ration & food" },
    { value: "HYGIENE", label: "Hygiene & sanitary" },
    { value: "MEDICINE", label: "Medicine" },
    { value: "ANIMAL_FEED", label: "Animal feed" },
    { value: "EQUIPMENT", label: "Equipment" },
  ],
  DISTRIBUTION_TYPE: [
    { value: "RATION", label: "Ration kit" },
    { value: "PAD", label: "Sanitary pads" },
    { value: "MEDICINE", label: "Medicine" },
    { value: "ANIMAL_FEED", label: "Animal feed" },
    { value: "OTHER", label: "Other" },
  ],
  TASK_TYPE: [
    { value: "DISTRIBUTION", label: "Distribution drive" },
    { value: "KIT_SCAN", label: "Kit scanning" },
    { value: "INVENTORY", label: "Inventory & stocking" },
    { value: "EVENT", label: "Awareness event" },
    { value: "RESCUE", label: "Animal rescue" },
    { value: "AMBULANCE", label: "Ambulance support" },
  ],
  UNIT: [
    { value: "pcs", label: "Pieces" },
    { value: "kg", label: "Kilograms" },
    { value: "litre", label: "Litres" },
    { value: "box", label: "Boxes" },
    { value: "pack", label: "Packs" },
  ],
  BENEFICIARY_CATEGORY: [
    { value: "FAMILY", label: "Family" },
    { value: "ELDERLY", label: "Elderly" },
    { value: "CHILD", label: "Child" },
    { value: "DISABLED", label: "Differently abled" },
    { value: "PATIENT", label: "Patient" },
    { value: "DAILY_WAGE", label: "Daily wage worker" },
  ],
};

export function useMasters(category: string) {
  const [options, setOptions] = useState<MasterOption[]>(FALLBACKS[category] ?? []);
  const [loading, setLoading] = useState(true);
  const [appliedCategory, setAppliedCategory] = useState(category);

  // Adjust state during render when the requested category changes (React-endorsed pattern).
  if (appliedCategory !== category) {
    setAppliedCategory(category);
    setOptions(FALLBACKS[category] ?? []);
    setLoading(true);
  }

  useEffect(() => {
    let alive = true;
    get<MasterOption[]>(`/api/masters?category=${encodeURIComponent(category)}`)
      .then((data) => {
        if (!alive) return;
        setOptions(
          Array.isArray(data) && data.length > 0
            ? data
            : FALLBACKS[category] ?? []
        );
      })
      .catch(() => {
        if (alive) setOptions(FALLBACKS[category] ?? []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [category]);

  return { options, loading };
}

export function labelOf(
  options: MasterOption[],
  value: string | undefined | null
): string {
  if (!value) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}
