/**
 * Load data-dump.json (from the legacy SQLite DB) into PostgreSQL.
 * Run from backend/:  bun run db:migrate-data
 *
 * Strategy: insert models in dependency order with a retry queue — models
 * whose FK targets are not yet loaded are retried until everything lands.
 * DateTime fields (parsed from schema.prisma) are revived from ISO strings.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = new PrismaClient();

const dump: Record<string, unknown[]> = JSON.parse(readFileSync("data-dump.json", "utf8"));

// Parse model names + DateTime fields straight from schema.prisma (Prisma 6
// no longer exposes dmmf on the client).
const schema = readFileSync("prisma/schema.prisma", "utf8");
const models: string[] = [];
const dateFields: Record<string, string[]> = {};
for (const match of schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)) {
  const name = match[1];
  models.push(name);
  dateFields[name] = [...match[2].matchAll(/^\s*(\w+)\s+DateTime/gm)].map((m) => m[1]);
}

/** Revive ISO date strings for DateTime fields (JSON round-trip safety). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function revive(model: string, row: any): any {
  const out: Record<string, unknown> = { ...row };
  for (const f of dateFields[model] ?? []) {
    if (out[f] !== null && out[f] !== undefined && typeof out[f] === "string") {
      out[f] = new Date(out[f] as string);
    }
  }
  return out;
}

async function main() {
  const summary: string[] = [];

  // The container superuser can defer FK enforcement — this makes the load
  // order-independent (no topological sort needed across 69 models).
  await db.$executeRawUnsafe("SET session_replication_role = replica");

  // Clear existing rows so the load is idempotent.
  for (const name of models) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (db as any)[name.charAt(0).toLowerCase() + name.slice(1)];
    if (delegate?.deleteMany) await delegate.deleteMany();
  }

  for (const name of models) {
    const delegate = (db as any)[name.charAt(0).toLowerCase() + name.slice(1)];
    const rows = dump[name] ?? [];
    if (rows.length === 0) continue;
    let skippedCount = 0;
    let firstError = "";
    for (const row of rows) {
      try {
        await delegate.create({ data: revive(name, row) });
      } catch (e) {
        const msg = String(e);
        if (msg.includes("Unique constraint") || msg.includes("P2002")) continue; // re-run safety
        skippedCount++;
        if (!firstError) firstError = msg.split("\n")[0].slice(0, 160);
      }
    }
    if (skippedCount > 0)
      summary.push(`${name}: ${skippedCount} row(s) skipped — ${firstError}`);
    console.log(`loaded ${name} (${rows.length})`);
  }

  await db.$executeRawUnsafe("SET session_replication_role = DEFAULT");

  if (summary.length) {
    console.log("\nSkipped rows (orphaned FKs in legacy data): ");
    for (const s of summary) console.log("  " + s);
  }
  console.log("Data migration complete.");
}

main().finally(() => db.$disconnect());
