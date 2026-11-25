// Healthcare module reference codes — human-readable, sequential, unique.
// Mirrors src/lib/codes.ts (generateUniqueCode) so every UAR module produces
// codes in the same UAR-XXX-00001 family. The clinical agents (encounters,
// prescriptions, lab orders, referrals) import the RX/LAB/REF generators
// from here — that is the shared contract.

import { db } from "@/lib/db";
import { generateUniqueCode } from "@/lib/codes";

export const nextCampCode = () =>
  db.medicalCamp.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-CAMP",
      seed: n + 1,
      exists: (c) => db.medicalCamp.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextCampRegCode = () =>
  db.campRegistration.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-CREG",
      seed: n + 1,
      exists: (c) => db.campRegistration.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextRxCode = () =>
  db.prescription.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-RX",
      seed: n + 1,
      exists: (c) => db.prescription.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextLabCode = () =>
  db.diagnosticOrder.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-LAB",
      seed: n + 1,
      exists: (c) => db.diagnosticOrder.findUnique({ where: { code: c } }).then(Boolean),
    })
  );

export const nextRefCode = () =>
  db.medicalReferral.count().then((n) =>
    generateUniqueCode({
      prefix: "UAR-REF",
      seed: n + 1,
      exists: (c) => db.medicalReferral.findUnique({ where: { code: c } }).then(Boolean),
    })
  );
