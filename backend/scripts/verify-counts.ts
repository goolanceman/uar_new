/**
 * Cross-check: every model's row count in PostgreSQL must equal the count in
 * data-dump.json (the dump of the legacy SQLite prisma DB).
 * Run from backend/:  bunx tsx scripts/verify-counts.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const db = new PrismaClient();
const dump: Record<string, unknown[]> = JSON.parse(readFileSync("data-dump.json", "utf8"));

const schema = readFileSync("prisma/schema.prisma", "utf8");
const models = [...schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)].map((m) => ({
  name: m[1],
  table: (m[2].match(/@@map\("([^"]+)"\)/) || [])[1],
}));

async function main() {
  let mismatches = 0;
  for (const { name, table } of models) {
    const dumpCount = dump[name]?.length ?? 0;
    const tableName = table || name;
    const pg = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "${tableName}"`
    );
    const pgCount = Number(pg[0].n);
    const mark = pgCount === dumpCount ? "✓" : "✗ MISMATCH";
    if (pgCount !== dumpCount) mismatches++;
    console.log(`${mark} ${name}: sqlite=${dumpCount} postgres=${pgCount}`);
  }
  console.log(mismatches === 0 ? "\nALL 69 MODELS MATCH — data migration verified." : `\n${mismatches} mismatches!`);
  process.exit(mismatches === 0 ? 0 : 1);
}

main().finally(() => db.$disconnect());
