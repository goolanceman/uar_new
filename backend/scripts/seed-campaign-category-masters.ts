/**
 * Seed CAMPAIGN_CATEGORY master rows (MDM) — safe to run repeatedly on an
 * existing database (upsert by category+value, never deletes or reorders).
 *
 * Values mirror the live campaign.category vocabulary; labels are friendlier
 * display names for the public/mobile category chips and the admin composer.
 * Any campaign category already stored in the DB but missing from the canonical
 * list is appended automatically so no live value is orphaned in dropdowns.
 *
 * Run: npx tsx scripts/seed-campaign-category-masters.ts
 * (uses DATABASE_URL from backend/.env or the environment)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const CAMPAIGN_CATEGORY = "CAMPAIGN_CATEGORY";

// [value, label] in display order.
const ROWS: Array<[string, string]> = [
  ["GENERAL", "General"],
  ["MEDICAL", "Medical emergencies"],
  ["FOOD_DISTRIBUTION", "Food & hunger"],
  ["SANITARY_PADS", "Sanitary pads"],
  ["EDUCATION_SUPPORT", "Education"],
  ["EMERGENCY", "Disaster relief"],
  ["ANIMAL_WELFARE", "Animal welfare"],
  ["ANIMAL", "Animal rescue"],
  ["MOBILITY", "Ambulance & corridor"],
  ["AWARENESS", "Awareness"],
  ["SAFETY", "Safety"],
  ["COMMUNITY_DEVELOPMENT", "Community development"],
  ["CHILD_WELFARE", "Child welfare"],
  ["OTHER", "Other"],
];

function titleCase(raw: string): string {
  const text = raw.toLowerCase().replaceAll("_", " ").trim();
  return text.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

async function main() {
  let i = 0;
  for (const [value, label] of ROWS) {
    await db.master.upsert({
      where: { category_value: { category: CAMPAIGN_CATEGORY, value } },
      update: { label, sortOrder: i },
      create: { category: CAMPAIGN_CATEGORY, value, label, sortOrder: i },
    });
    i += 1;
  }

  // Catch-up: any category value already on live campaigns but not in the
  // canonical list gets a row so existing campaigns stay selectable.
  const used = await db.campaign.findMany({
    distinct: ["category"],
    select: { category: true },
  });
  const known = new Set(ROWS.map(([, value]) => value));
  for (const { category } of used) {
    if (!category || known.has(category)) continue;
    await db.master.upsert({
      where: { category_value: { category: CAMPAIGN_CATEGORY, value: category } },
      update: {},
      create: { category: CAMPAIGN_CATEGORY, value: category, label: titleCase(category), sortOrder: i },
    });
    known.add(category);
    i += 1;
    console.log(`  + added missing campaign category "${category}"`);
  }

  const total = await db.master.count({ where: { category: CAMPAIGN_CATEGORY } });
  console.log(`✓ CAMPAIGN_CATEGORY masters (${total})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
