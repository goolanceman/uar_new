/**
 * Removes rows created by scripts/verify-food.mjs.sh so repeated E2E runs
 * start from the clean seeded demo state. Run: bun scripts/cleanup-food-e2e.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const e2eEvents = await db.foodEvent.findMany({
    where: { OR: [{ title: { startsWith: "E2E" } }, { venue: "X" }] },
    select: { id: true },
  });
  const e2eEventIds = e2eEvents.map((e) => e.id);

  // Restore reserved counters on surviving seed batches before dropping the
  // allocations, so the batch ledger is left exactly as it was found.
  const strayAllocations = await db.foodStockAllocation.findMany({
    where: { eventId: { in: e2eEventIds }, status: "RESERVED" },
  });
  for (const a of strayAllocations) {
    await db.foodBatch.update({
      where: { id: a.batchId },
      data: { quantityReserved: { decrement: a.quantity } },
    });
  }

  // registrations + check-ins tied to e2e events
  await db.foodCheckIn.deleteMany({ where: { eventId: { in: e2eEventIds } } });
  await db.foodRegistration.deleteMany({ where: { eventId: { in: e2eEventIds } } });
  await db.foodEventExpense.deleteMany({ where: { eventId: { in: e2eEventIds } } });
  await db.foodStockAllocation.deleteMany({ where: { eventId: { in: e2eEventIds } } });
  await db.foodEvent.deleteMany({ where: { id: { in: e2eEventIds } } });

  // e2e batches restore their master-item quantity, then go away
  const e2eBatches = await db.foodBatch.findMany({ where: { batchNo: { startsWith: "E2E-" } } });
  for (const b of e2eBatches) {
    const delta = b.quantityReceived - b.quantityConsumed - b.quantityWasted - b.quantityReturned;
    if (delta !== 0)
      await db.inventoryItem.update({ where: { id: b.itemId }, data: { quantity: { decrement: delta } } });
  }
  await db.foodBatch.deleteMany({ where: { batchNo: { startsWith: "E2E-" } } });

  // e2e inventory items (every E2E run created one) + their transactions
  const e2eItems = await db.inventoryItem.findMany({ where: { name: { startsWith: "E2E" } } });
  for (const item of e2eItems) {
    await db.inventoryTransaction.deleteMany({ where: { itemId: item.id } });
    await db.inventoryItem.delete({ where: { id: item.id } });
  }

  // e2e programme
  const prog = await db.foodProgramme.findFirst({ where: { title: "E2E Test Programme" } });
  if (prog) await db.foodProgramme.delete({ where: { id: prog.id } });

  // e2e applications + the beneficiaries their approvals created
  const apps = await db.beneficiaryRequest.findMany({
    where: { name: { startsWith: "E2E" } },
    select: { id: true, beneficiaryId: true },
  });
  for (const a of apps) {
    if (a.beneficiaryId) {
      const b = await db.beneficiary.findUnique({ where: { id: a.beneficiaryId } });
      if (b?.name.startsWith("E2E")) {
        await db.beneficiaryNote.deleteMany({ where: { beneficiaryId: b.id } });
        await db.beneficiary.delete({ where: { id: b.id } });
      }
    }
  }
  await db.beneficiaryRequest.deleteMany({ where: { id: { in: apps.map((a) => a.id) } } });

  // walk-in beneficiaries created by the E2E (names prefixed E2E) — after
  // event cleanup removed their registrations
  const e2eBens = await db.beneficiary.findMany({ where: { name: { startsWith: "E2E" } } });
  for (const b of e2eBens) {
    await db.beneficiaryNote.deleteMany({ where: { beneficiaryId: b.id } });
    try {
      await db.beneficiary.delete({ where: { id: b.id } });
    } catch {
      // still referenced elsewhere (e.g. a distribution) — leave for audit
    }
  }

  // e2e households + donations
  await db.householdMember.deleteMany({ where: { household: { name: { startsWith: "E2E" } } } });
  await db.household.deleteMany({ where: { name: { startsWith: "E2E" } } });
  await db.donation.deleteMany({ where: { donorEmail: { startsWith: "e2e-" } } });
  await db.donor.deleteMany({ where: { email: { startsWith: "e2e-" } } });
  await db.activityLog.deleteMany({ where: { details: { contains: "E2E" } } });

  console.log("✓ E2E food test data cleaned");
}

main().finally(() => db.$disconnect());
