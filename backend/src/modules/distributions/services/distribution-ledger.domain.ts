/**
 * Unified distribution ledger — read-model that merges the four separate
 * distribution accounting systems into one feed:
 *
 *   1. LEGACY            — `Distribution` rows (all legacy types)
 *   2. FOOD_PROGRAMME    — `FoodRegistration` rows hand-delivered at food events
 *   3. MEDICAL_DISPENSE  — `MedicationDispense` rows (medicines via prescription)
 *   4. PAD_DRIVE         — `PadDistribution` rows (sanitary pad drives)
 *
 * PRIVACY: unified rows never include beneficiary phone/address — only the
 * beneficiary display name and UAR-BEN code.
 */
import { db } from "@/infrastructure/database/prisma";
import { logger } from "@/infrastructure/logging/logger";
import { parseTemplateItems } from "@/modules/food/services/food.domain";

export type UnifiedSource = "FOOD_PROGRAMME" | "MEDICAL_DISPENSE" | "PAD_DRIVE" | "LEGACY";

export interface UnifiedRow {
  id: string;
  source: UnifiedSource;
  code: string | null;
  type: string;
  subtype: string | null;
  beneficiaryName: string | null;
  beneficiaryCode: string | null;
  items: string | null;
  quantity: number;
  location: string | null;
  volunteerName: string | null;
  when: string;
  refUrl: string | null;
  refLabel: string | null;
}

export interface UnifiedLedger {
  items: UnifiedRow[];
  total: number;
}

const SOURCES: UnifiedSource[] = ["FOOD_PROGRAMME", "MEDICAL_DISPENSE", "PAD_DRIVE", "LEGACY"];

const log = logger.child("distribution-ledger");

/** Legacy Distribution types that may appear in the unified `type` filter. */
const LEGACY_TYPES = [
  "FOOD",
  "SANITARY_PADS",
  "MEDICAL",
  "ANIMAL_FEED",
  "CLOTHING",
  "EDUCATION_MATERIAL",
  "CASH",
  "OTHER",
];

/** Which unified sources can produce each filtered type. */
function sourcesForTypes(types: string[]): UnifiedSource[] {
  const set = new Set<UnifiedSource>();
  for (const t of types) {
    if (t === "FOOD") set.add("FOOD_PROGRAMME");
    else if (t === "MEDICINE") set.add("MEDICAL_DISPENSE");
    else if (t === "SANITARY_PADS") {
      set.add("PAD_DRIVE");
      set.add("LEGACY");
    } else set.add("LEGACY");
  }
  return SOURCES.filter((s) => set.has(s));
}

/** Beneficiary name/code match used by every source's free-text search. */
function beneficiaryOR(term: string) {
  return {
    beneficiary: {
      is: { OR: [{ name: { contains: term } }, { code: { contains: term } }] },
    },
  };
}

/** packageSnapshot JSON ("[{name,qty,unit}]") → "Rice × 5, Oil × 1" summary. */
function snapshotSummary(snapshot: string | null): string | null {
  if (!snapshot) return null;
  const items = parseTemplateItems(snapshot);
  if (!items.length) return null;
  return items.map((i) => (i.unit ? `${i.name} ${i.unit} × ${i.qty}` : `${i.name} × ${i.qty}`)).join(", ");
}

export async function buildUnifiedLedger(sp: URLSearchParams): Promise<UnifiedLedger> {
  const q = sp.get("q")?.trim() ?? "";
  const limit = Math.min(500, Math.max(1, Math.trunc(Number(sp.get("limit")) || 50)));
  const offset = Math.max(0, Math.trunc(Number(sp.get("offset")) || 0));
  const perSource = limit + offset; // top-N per source is enough to rank the requested page globally

  // ---- resolve which sources to query ------------------------------------
  let sources = SOURCES;
  const rawTypes = (sp.get("type")?.trim() ?? "")
    .toUpperCase()
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && t !== "ALL" && (LEGACY_TYPES.includes(t) || t === "MEDICINE"));

  if (rawTypes.length) sources = sourcesForTypes(rawTypes);

  const sourceParam = sp.get("source")?.trim().toUpperCase() as UnifiedSource | null;
  if (sourceParam && SOURCES.includes(sourceParam))
    sources = sources.includes(sourceParam) ? [sourceParam] : [];
  else if (sourceParam) sources = [];

  if (!sources.length) {
    log.debug("ledger_no_sources_selected", {
      types: rawTypes.length ? rawTypes : undefined,
      source: sourceParam,
    });
    return { items: [], total: 0 };
  }

  const legacyTypes =
    rawTypes.length && rawTypes.some((t) => !["FOOD", "MEDICINE"].includes(t))
      ? rawTypes.filter((t) => LEGACY_TYPES.includes(t))
      : undefined;

  // ---- query each live source in parallel --------------------------------
  const tasks: Promise<{ rows: UnifiedRow[]; count: number }>[] = [];

  if (sources.includes("FOOD_PROGRAMME")) {
    const where = {
      status: { in: ["DISTRIBUTED", "PARTIALLY_DISTRIBUTED"] },
      ...(q
        ? {
            OR: [
              { code: { contains: q } },
              beneficiaryOR(q),
              { packageSnapshot: { contains: q } },
              { event: { is: { OR: [{ title: { contains: q } }, { venue: { contains: q } }, { city: { contains: q } }] } } },
            ],
          }
        : {}),
    };
    tasks.push(
      (async () => {
        const [rows, count] = await Promise.all([
          db.foodRegistration.findMany({
            where,
            orderBy: { updatedAt: "desc" },
            take: perSource,
            select: {
              id: true,
              code: true,
              unitsDelivered: true,
              packageSnapshot: true,
              ackByName: true,
              updatedAt: true,
              beneficiary: { select: { name: true, code: true } },
              event: { select: { code: true, title: true, venue: true, city: true, eventType: true } },
            },
          }),
          db.foodRegistration.count({ where }),
        ]);
        return {
          count,
          rows: rows.map((r) => ({
            id: r.id,
            source: "FOOD_PROGRAMME" as const,
            code: r.code,
            type: "FOOD",
            subtype: r.event.eventType,
            beneficiaryName: r.beneficiary?.name ?? null,
            beneficiaryCode: r.beneficiary?.code ?? null,
            items: snapshotSummary(r.packageSnapshot) ?? r.event.title,
            quantity: r.unitsDelivered,
            location: [r.event.venue, r.event.city].filter(Boolean).join(", ") || null,
            volunteerName: r.ackByName,
            when: r.updatedAt.toISOString(),
            refUrl: "#/admin/food",
            refLabel: `Food event ${r.event.code}`,
          })),
        };
      })()
    );
  }

  if (sources.includes("MEDICAL_DISPENSE")) {
    const where = {
      ...(q
        ? {
            OR: [
              { prescription: { is: { code: { contains: q } } } },
              beneficiaryOR(q),
              { item: { is: { medicineName: { contains: q } } } },
              { camp: { is: { title: { contains: q } } } },
            ],
          }
        : {}),
    };
    tasks.push(
      (async () => {
        const [rows, count] = await Promise.all([
          db.medicationDispense.findMany({
            where,
            orderBy: { dispensedAt: "desc" },
            take: perSource,
            select: {
              id: true,
              quantity: true,
              pharmacistName: true,
              dispensedAt: true,
              prescription: { select: { code: true } },
              beneficiary: { select: { name: true, code: true } },
              camp: { select: { title: true } },
              item: { select: { medicineName: true } },
            },
          }),
          db.medicationDispense.count({ where }),
        ]);
        return {
          count,
          rows: rows.map((r) => ({
            id: r.id,
            source: "MEDICAL_DISPENSE" as const,
            code: r.prescription?.code ?? null,
            type: "MEDICINE",
            subtype: r.item?.medicineName ?? null,
            beneficiaryName: r.beneficiary?.name ?? null,
            beneficiaryCode: r.beneficiary?.code ?? null,
            items: r.item?.medicineName ? `${r.item.medicineName} × ${r.quantity}` : null,
            quantity: r.quantity,
            location: r.camp?.title ?? null,
            volunteerName: r.pharmacistName,
            when: r.dispensedAt.toISOString(),
            refUrl: "#/admin/health",
            refLabel: r.camp ? `Camp ${r.camp.title}` : `Prescription ${r.prescription?.code ?? "dispense"}`,
          })),
        };
      })()
    );
  }

  if (sources.includes("PAD_DRIVE")) {
    const where = {
      ...(q
        ? {
            OR: [
              { area: { contains: q } },
              { schoolName: { contains: q } },
              beneficiaryOR(q),
            ],
          }
        : {}),
    };
    tasks.push(
      (async () => {
        const [rows, count] = await Promise.all([
          db.padDistribution.findMany({
            where,
            orderBy: { distributionDate: "desc" },
            take: perSource,
            select: {
              id: true,
              area: true,
              schoolName: true,
              padsDistributed: true,
              volunteerName: true,
              distributionDate: true,
              beneficiary: { select: { name: true, code: true } },
            },
          }),
          db.padDistribution.count({ where }),
        ]);
        return {
          count,
          rows: rows.map((r) => ({
            id: r.id,
            source: "PAD_DRIVE" as const,
            code: null,
            type: "SANITARY_PADS",
            subtype: null,
            beneficiaryName: r.beneficiary?.name ?? null,
            beneficiaryCode: r.beneficiary?.code ?? null,
            items: r.schoolName ? `${r.schoolName}, ${r.area}` : r.area,
            quantity: r.padsDistributed,
            location: r.area,
            volunteerName: r.volunteerName,
            when: r.distributionDate.toISOString(),
            refUrl: "#/admin/distributions",
            refLabel: "Pad drive",
          })),
        };
      })()
    );
  }

  if (sources.includes("LEGACY")) {
    const where = {
      ...(legacyTypes ? { type: { in: legacyTypes } } : {}),
      ...(q
        ? {
            OR: [
              { location: { contains: q } },
              { items: { contains: q } },
              { notes: { contains: q } },
              { beneficiary: { is: { OR: [{ name: { contains: q } }, { code: { contains: q } }, { city: { contains: q } }] } } },
            ],
          }
        : {}),
    };
    tasks.push(
      (async () => {
        const [rows, count] = await Promise.all([
          db.distribution.findMany({
            where,
            orderBy: { distributedAt: "desc" },
            take: perSource,
            select: {
              id: true,
              type: true,
              items: true,
              quantity: true,
              location: true,
              distributedAt: true,
              beneficiary: { select: { name: true, code: true } },
              volunteer: { select: { user: { select: { name: true } } } },
            },
          }),
          db.distribution.count({ where }),
        ]);
        return {
          count,
          rows: rows.map((r) => ({
            id: r.id,
            source: "LEGACY" as const,
            code: null,
            type: r.type,
            subtype: null,
            beneficiaryName: r.beneficiary?.name ?? null,
            beneficiaryCode: r.beneficiary?.code ?? null,
            items: r.items,
            quantity: r.quantity,
            location: r.location,
            volunteerName: r.volunteer?.user?.name ?? null,
            when: r.distributedAt.toISOString(),
            refUrl: "#/admin/distributions",
            refLabel: "Legacy distribution",
          })),
        };
      })()
    );
  }

  // ---- merge, sort desc by `when`, paginate in memory ---------------------
  const results = await Promise.all(tasks);
  const total = results.reduce((sum, r) => sum + r.count, 0);
  const merged = results
    .flatMap((r) => r.rows)
    .sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0))
    .slice(offset, offset + limit);

  return { items: merged, total };
}
