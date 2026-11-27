/**
 * Community interests service — the interest list (with per-interest room
 * counts) shared by the generic /api/interests router (web + mobile).
 *
 * Port of InterestController::fetchInterests (src/routes/mobile/posts.ts).
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ApiError } from "@/lib/session";
import { cached, cacheKeyPart, cacheTtl, catalogKey, invalidateCatalog } from "@/lib/cache";

const log = logger.child("community:interests");

/** GET /api/interests — interests + totalRoomOfInterest. */
export async function listInterests(skip: number, take: number) {
  return cached(catalogKey("interests", cacheKeyPart({ skip, take })), cacheTtl.catalog, () =>
    loadInterests(skip, take)
  );
}

async function loadInterests(skip: number, take: number) {
  const [interests, total] = await Promise.all([
    db.communityInterest.findMany({ orderBy: { id: "asc" }, skip, take }),
    db.communityInterest.count(),
  ]);

  const items = [];
  for (const interest of interests) {
    // Legacy does Room::where('interest_ids', id) — an exact CSV match.
    const totalRoomOfInterest = await db.communityRoom.count({
      where: { interestIds: String(interest.id) },
    });
    items.push({
      id: interest.id,
      title: interest.title,
      createdAt: interest.createdAt,
      updatedAt: interest.updatedAt,
      totalRoomOfInterest,
    });
  }
  return { items, total };
}

// ─── Admin CRUD (legacy addInterest/updateInterest/deleteInterest) ──────────
// The legacy delete removed only the row and left dangling ids in the CSV
// columns — here every reference is stripped so nothing points at a dead
// interest. Every mutation drops the interests catalog cache.

function invalidateInterests(): Promise<void> {
  return invalidateCatalog("interests");
}

/** Strip one interest id from a CSV column ("1,5,23" minus 5 → "1,23"). */
async function stripInterestId(id: number): Promise<void> {
  const strip = (csv: string | null): string | null =>
    csv === null ? null : csv.split(",").map((s) => s.trim()).filter((v) => v !== "" && v !== String(id)).join(",");

  // Prisma can't match "5" inside a CSV without matching "15" too, so rows
  // are selected with contains (a superset) and rewritten in JS.
  const users = await db.user.findMany({ where: { interestIds: { contains: String(id) } }, select: { id: true, interestIds: true } });
  for (const u of users) {
    const next = strip(u.interestIds);
    if (next !== u.interestIds) await db.user.update({ where: { id: u.id }, data: { interestIds: next } });
  }
  for (const [model, select] of [
    ["communityPost", { id: true, interestIds: true }] as const,
    ["communityReel", { id: true, interestIds: true }] as const,
    ["communityRoom", { id: true, interestIds: true }] as const,
  ] as const) {
    const rows = await (db[model] as typeof db.communityPost).findMany({
      where: { interestIds: { contains: String(id) } },
      select,
    });
    for (const r of rows) {
      const next = strip(r.interestIds);
      if (next !== r.interestIds) await (db[model] as typeof db.communityPost).update({ where: { id: r.id }, data: { interestIds: next } });
    }
  }
}

export async function addInterest(title: string) {
  const exists = await db.communityInterest.findFirst({ where: { title }, select: { id: true } });
  if (exists) {
    log.warn("interest_duplicate", { title });
    throw new ApiError(`Interest "${title}" already exists`, 409);
  }
  const row = await db.communityInterest.create({ data: { title } });
  await invalidateInterests();
  return row;
}

export async function updateInterest(id: number, title: string) {
  const row = await db.communityInterest.findUnique({ where: { id } });
  if (!row) {
    log.warn("interest_update_not_found", { interestId: id });
    throw new ApiError("Interest not found", 404);
  }
  const dup = await db.communityInterest.findFirst({ where: { title, id: { not: id } }, select: { id: true } });
  if (dup) {
    log.warn("interest_duplicate", { title });
    throw new ApiError(`Interest "${title}" already exists`, 409);
  }
  const updated = await db.communityInterest.update({ where: { id }, data: { title } });
  await invalidateInterests();
  return updated;
}

export async function deleteInterest(id: number) {
  const row = await db.communityInterest.findUnique({ where: { id } });
  if (!row) {
    log.warn("interest_delete_not_found", { interestId: id });
    throw new ApiError("Interest not found", 404);
  }
  await db.communityInterest.delete({ where: { id } });
  await stripInterestId(id);
  await invalidateInterests();
  return row;
}
