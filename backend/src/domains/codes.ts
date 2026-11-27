// Shared helper for generating short, human-readable, sequential reference
// codes (e.g. UAR-DNR-00001) so related records can be cross-referenced by
// eye across admin screens, receipts, and reports — mirrors the pattern
// already used for Donation.receiptNumber, Cause.code, KitBatch.code and
// Certificate.code.

import { db } from "@/infrastructure/database/prisma";

/**
 * Generates the next unused code for a given prefix by starting from
 * `seed` (typically `count + 1`) and incrementing past any collisions.
 * Collisions are rare (only possible if rows were deleted and recreated
 * out of order) but the loop makes generation safe regardless.
 */
export async function generateUniqueCode(opts: {
  prefix: string; // e.g. "UAR-DNR"
  seed: number;
  pad?: number;
  exists: (code: string) => Promise<boolean>;
}): Promise<string> {
  const pad = opts.pad ?? 5;
  let n = Math.max(1, opts.seed);
  let code = `${opts.prefix}-${String(n).padStart(pad, "0")}`;
  while (await opts.exists(code)) {
    n += 1;
    code = `${opts.prefix}-${String(n).padStart(pad, "0")}`;
  }
  return code;
}

export const nextDonorCode = () =>
  db.donor.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-DNR",
      seed: n + 1,
      exists: (c) => db.donor.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextBeneficiaryCode = () =>
  db.beneficiary.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-BEN",
      seed: n + 1,
      exists: (c) => db.beneficiary.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextCampaignCode = () =>
  db.campaign.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-CMP",
      seed: n + 1,
      exists: (c) => db.campaign.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextVolunteerCode = () =>
  db.volunteer.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-VOL",
      seed: n + 1,
      exists: (c) => db.volunteer.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextAnimalCode = () =>
  db.animal.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-ANM",
      seed: n + 1,
      exists: (c) => db.animal.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextKitTemplateCode = () =>
  db.kitTemplate.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-KT",
      seed: n + 1,
      exists: (c) => db.kitTemplate.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextInventoryItemCode = () =>
  db.inventoryItem.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-ITM",
      seed: n + 1,
      exists: (c) => db.inventoryItem.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextFoodProgrammeCode = () =>
  db.foodProgramme.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-FSP",
      seed: n + 1,
      exists: (c) => db.foodProgramme.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextFoodEventCode = () =>
  db.foodEvent.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-FEVT",
      seed: n + 1,
      exists: (c) => db.foodEvent.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextFoodRegistrationCode = () =>
  db.foodRegistration.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-FREG",
      seed: n + 1,
      exists: (c) => db.foodRegistration.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextHouseholdCode = () =>
  db.household.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-HOU",
      seed: n + 1,
      exists: (c) => db.household.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextFoodApplicationRef = () =>
  db.beneficiaryRequest.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-FAR",
      seed: n + 1,
      exists: (c) => db.beneficiaryRequest.findUnique({ where: { refCode: c } }).then(Boolean),
    })
  );
